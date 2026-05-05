"""AI analysis using Claude with built-in web search for news — no external news API needed."""
import json
from typing import AsyncIterator
import anthropic
from app.config import settings

MODEL = "claude-opus-4-6"

# Web search tool — Claude fetches its own news
WEB_SEARCH_TOOL = {"type": "web_search_20250305"}

_client: anthropic.AsyncAnthropic | None = None


def get_client() -> anthropic.AsyncAnthropic:
    global _client
    if _client is None:
        _client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
    return _client


DAILY_SYSTEM_PROMPT = """You are a quantitative equity analyst. Your job is to produce \
grounded, evidence-based recommendations — never guess or fabricate data.

STRICT RULES — follow these exactly:
1. Use web_search to fetch real recent news before analysing each stock. Search: "[TICKER] stock news"
2. Base your rationale ONLY on: (a) the quant signals provided in the user message, \
   (b) news you actually retrieved via web_search. Do NOT invent price targets, earnings figures, \
   or news you did not retrieve.
3. If web search returns no useful results, state "no significant news found" — do not fabricate headlines.
4. Quote specific signal values in your rationale (e.g. "RSI at 34", "20-day SMA crossed above 50-day").
5. Call record_recommendation for EVERY ticker in the input — no omissions.

Signal interpretation guide:
- RSI <30 = statistically oversold (potential mean-reversion entry)
- RSI >70 = statistically overbought (elevated reversal risk)
- SMA cross bullish (SMA20 > SMA50) = medium-term uptrend
- SMA cross bearish = medium-term downtrend
- Volume ratio >1.5 = above-average conviction; <0.5 = low conviction move
- Large unrealised gain (>50%) = consider partial profit-taking

Confidence levels:
- high: multiple signals aligned + corroborating news
- medium: signals mixed or news ambiguous
- low: insufficient data or conflicting signals"""

ADVISOR_SYSTEM_PROMPT = """You are a quantitative portfolio advisor. Your suggestions must be \
grounded in real, verifiable data — never hallucinate prices, earnings, or news.

STRICT RULES:
1. Search the web for current price and recent news for every stock you plan to recommend \
   before including it. Do not suggest a stock you have not searched.
2. Only cite facts you actually retrieved. If you cannot find data, say so explicitly.
3. Do not invent specific price targets or earnings forecasts unless retrieved from a source.
4. Reference the user's actual portfolio data provided — do not assume positions they don't have.

Risk level guidelines:
- low: Broad index ETFs (VTI, VOO, SCHD), dividend blue-chips, bonds (BND). Capital preservation focus.
- medium: Established growth companies (large/mid-cap), sector ETFs, balance of yield + growth.
- high: High-growth small/mid-cap, sector bets, concentrated positions. Volatility accepted.

Response format:
1. Portfolio snapshot: 2-3 sentences on current allocation and risk profile
2. 2-4 buy suggestions: each with ticker, exact $ amount from budget, and 2-sentence rationale \
   citing specific data you retrieved (price, trend, catalyst)
3. One-sentence allocation note

Always specify exact dollar amounts from the stated budget. Do not pad with generic disclaimers."""

WATCHLIST_SYSTEM_PROMPT = """You are a quantitative timing analyst. Determine whether now is \
a good entry point for a stock using hard data — no guessing.

STRICT RULES:
1. Always run web_search for "[TICKER] stock news" before responding.
2. Only reference quant signals from the provided data. Do not invent signal values.
3. If data is insufficient to make a confident call, return signal "wait" with an honest explanation.
4. Do not fabricate price targets — only set entry_price_target if you can justify it from \
   the signals (e.g. near SMA20 support) or a retrieved source.

Respond ONLY in this JSON format (no prose outside the JSON):
{
  "signal": "buy" | "wait" | "avoid",
  "reason": "2-3 sentences citing specific RSI/SMA values and any news found",
  "entry_price_target": number or null
}"""


async def run_daily_report(positions_data: list[dict]) -> list[dict]:
    """Analyze all positions using web search + quant signals."""
    client = get_client()

    record_tool = {
        "name": "record_recommendation",
        "description": "Record a recommendation for a stock position",
        "input_schema": {
            "type": "object",
            "properties": {
                "ticker": {"type": "string"},
                "action": {"type": "string", "enum": ["buy_more", "hold", "sell"]},
                "confidence": {"type": "string", "enum": ["high", "medium", "low"]},
                "rationale": {"type": "string"},
            },
            "required": ["ticker", "action", "confidence", "rationale"],
        },
    }

    # Strip out raw DataFrames / non-serializable fields before sending to Claude
    payload = [
        {k: v for k, v in p.items() if k != "history_df"}
        for p in positions_data
    ]

    user_message = (
        "Search for recent news on each stock, then call record_recommendation for every ticker:\n\n"
        + json.dumps(payload, indent=2)
    )

    recommendations = []
    messages = [{"role": "user", "content": user_message}]

    # Agentic loop — handles web_search + record_recommendation tool use
    while True:
        response = await client.messages.create(
            model=MODEL,
            max_tokens=8192,
            system=[
                {
                    "type": "text",
                    "text": DAILY_SYSTEM_PROMPT,
                    "cache_control": {"type": "ephemeral"},
                }
            ],
            tools=[WEB_SEARCH_TOOL, record_tool],
            messages=messages,
        )

        messages.append({"role": "assistant", "content": response.content})

        tool_results = []
        for block in response.content:
            if block.type == "tool_use":
                if block.name == "record_recommendation":
                    recommendations.append(block.input)
                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": "Recorded.",
                    })
                # web_search results are handled automatically by the API

        if response.stop_reason == "end_turn":
            break

        if tool_results:
            messages.append({"role": "user", "content": tool_results})
        elif response.stop_reason != "tool_use":
            break

    return recommendations


async def run_advisor_stream(
    portfolio: list[dict],
    budget_usd: float,
    risk_level: str,
    sector_preference: str | None,
    notes: str | None,
) -> AsyncIterator[str]:
    """Stream advisor response, Claude searches web for market context."""
    client = get_client()

    user_message = (
        f"Current portfolio:\n{json.dumps(portfolio, indent=2)}\n\n"
        f"Investment request:\n"
        f"- Budget: ${budget_usd:,.2f}\n"
        f"- Risk level: {risk_level}\n"
        f"- Sector preference: {sector_preference or 'none'}\n"
        f"- Notes: {notes or 'none'}\n\n"
        "Search the web for current market conditions and any specific stocks you plan to suggest, "
        "then provide investment recommendations."
    )

    async with client.messages.stream(
        model=MODEL,
        max_tokens=2048,
        system=[
            {
                "type": "text",
                "text": ADVISOR_SYSTEM_PROMPT,
                "cache_control": {"type": "ephemeral"},
            }
        ],
        tools=[WEB_SEARCH_TOOL],
        messages=[{"role": "user", "content": user_message}],
    ) as stream:
        async for text in stream.text_stream:
            yield text


async def run_watchlist_check(ticker: str, signals: dict, current_price: float) -> dict:
    """Check if now is a good time to buy, Claude searches web for news."""
    client = get_client()

    user_message = (
        f"Stock: {ticker}\n"
        f"Current price: ${current_price}\n"
        f"Quant signals: {json.dumps(signals, indent=2)}\n\n"
        f"Search for recent news on {ticker}, then respond in the JSON format specified."
    )

    messages = [{"role": "user", "content": user_message}]

    # Allow one round of web search before final answer
    while True:
        response = await client.messages.create(
            model=MODEL,
            max_tokens=1024,
            system=[
                {
                    "type": "text",
                    "text": WATCHLIST_SYSTEM_PROMPT,
                    "cache_control": {"type": "ephemeral"},
                }
            ],
            tools=[WEB_SEARCH_TOOL],
            messages=messages,
        )

        messages.append({"role": "assistant", "content": response.content})

        if response.stop_reason == "end_turn":
            break
        elif response.stop_reason != "tool_use":
            break

    # Extract last text block
    text = ""
    for block in response.content:
        if hasattr(block, "text"):
            text = block.text

    if "```" in text:
        text = text.split("```")[1]
        if text.startswith("json"):
            text = text[4:]
    try:
        return json.loads(text.strip())
    except json.JSONDecodeError:
        return {"signal": "wait", "reason": text.strip(), "entry_price_target": None}
