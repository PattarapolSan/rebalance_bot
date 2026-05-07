"""AI analysis using Claude with built-in web search. Single-call architecture."""
import json
import logging
import re
from typing import AsyncIterator
import anthropic
from app.config import settings

MODEL = "claude-sonnet-4-6"

WEB_SEARCH_TOOL = {"type": "web_search_20260209", "name": "web_search"}

_client: anthropic.AsyncAnthropic | None = None

# Debug: store last daily report run info
_last_run: dict = {"status": "never", "stop_reason": None, "text_preview": "", "error": None}


def get_client() -> anthropic.AsyncAnthropic:
    global _client
    if _client is None:
        if not settings.anthropic_api_key:
            logging.error("ANTHROPIC_API_KEY is missing!")
        _client = anthropic.AsyncAnthropic(
            api_key=settings.anthropic_api_key,
            default_headers={"anthropic-beta": "prompt-caching-2024-07-31"},
        )
    return _client


DAILY_SYSTEM_PROMPT = """You are a quantitative equity analyst. Produce grounded, \
evidence-based recommendations — never fabricate data.

For EACH ticker:
1. Search "[TICKER] RSI technical analysis" to get current RSI, SMA, trend
2. Search "[TICKER] stock news" for recent headlines
3. Include your findings in the rationale — quote actual values retrieved

Then output a JSON array (and nothing else) in this exact format:
[
  {
    "ticker": "AAPL",
    "action": "buy_more" | "hold" | "sell",
    "confidence": "high" | "medium" | "low",
    "rationale": "2-4 sentences citing specific RSI/SMA values and news",
    "support": 178.50,
    "resistance": 195.00,
    "stop_loss": 172.00
  },
  ...
]

Rules:
- Output ONLY the JSON array — no markdown, no prose before or after
- Include every ticker from the input — no omissions
- If search returns nothing useful, say so in the rationale; do not fabricate
- RSI <30 = oversold, RSI >70 = overbought; price vs SMA50 = trend direction
- Large unrealised gain (>50%) = consider profit-taking
- support/resistance: key price levels from technicals or recent highs/lows you found
- stop_loss: suggested exit level to limit downside (null if not determinable)"""

ADVISOR_SYSTEM_PROMPT = """You are a quantitative portfolio advisor. \
Suggest specific investments grounded in real, current data.

Rules:
- Search the web for current price, technicals, and news for every stock you recommend
- Only cite facts you actually retrieved — no invented price targets or earnings
- Reference the user's actual portfolio — account for existing positions and concentration
- If the user listed stocks they are interested in, prioritise analysing those first

Risk guidelines:
- low: Broad ETFs (VTI, VOO, SCHD), dividend blue-chips. Capital preservation.
- medium: Established large/mid-cap growth, sector ETFs. Balance of yield + growth.
- high: High-growth small/mid-cap, concentrated bets. Volatility accepted.

Format:
1. Portfolio snapshot (2-3 sentences on allocation and risk)
2. 2-4 buy suggestions: ticker, exact $ from budget, 2-sentence rationale with data
3. One-sentence allocation note

Specify exact dollar amounts. No generic disclaimers."""


async def run_daily_report(positions_data: list[dict]) -> list[dict]:
    """
    Single API call — Claude searches web internally and returns JSON.
    No tool loop needed: web_search is server-side, JSON is the only output format.
    """
    client = get_client()

    payload = [{k: v for k, v in p.items() if k != "history_df"} for p in positions_data]

    user_message = (
        "Search for technical indicators and recent news for each stock, "
        "then return your analysis as a JSON array.\n\n"
        + json.dumps(payload, indent=2)
    )

    try:
        response = await client.messages.create(
            model=MODEL,
            max_tokens=16000,
            system=[{"type": "text", "text": DAILY_SYSTEM_PROMPT, "cache_control": {"type": "ephemeral"}}],
            tools=[WEB_SEARCH_TOOL],
            messages=[{"role": "user", "content": user_message}],
        )
    except Exception as e:
        _last_run.update({"status": "api_error", "error": str(e), "stop_reason": None, "text_preview": ""})
        logging.error(f"Daily report API error: {e}")
        return []

    # Collect all text blocks from the response
    all_text = "\n".join(
        block.text for block in response.content if hasattr(block, "text")
    )
    block_types = [type(b).__name__ for b in response.content]
    logging.info(f"[daily_report] stop_reason={response.stop_reason} text_len={len(all_text)} blocks={block_types}")

    _last_run.update({
        "stop_reason": response.stop_reason,
        "text_preview": all_text[:600],
        "block_types": str(block_types),
        "error": None,
    })

    # Try to extract a JSON array: look for the first '[' ... last ']'
    def _extract_json_array(s: str) -> str:
        if "```" in s:
            m = re.search(r"```(?:json)?\s*([\s\S]*?)```", s)
            if m:
                return m.group(1).strip()
        start = s.find("[")
        end = s.rfind("]")
        if start != -1 and end != -1 and end > start:
            return s[start:end + 1]
        return s.strip()

    text = _extract_json_array(all_text)

    try:
        results = json.loads(text)
        for r in results:
            r["ticker"] = r.get("ticker", "").upper()
        _last_run["status"] = f"ok:{len(results)} stocks"
        logging.info(f"[daily_report] parsed {len(results)} results")
        return results
    except json.JSONDecodeError:
        _last_run["status"] = f"json_parse_failed"
        _last_run["error"] = f"Extracted: {text[:300]}"
        logging.error(f"[daily_report] JSON parse failed. text: {text[:500]}")
        return []


async def run_advisor_stream(
    portfolio: list[dict],
    budget_usd: float,
    risk_level: str,
    sector_preference: str | None,
    notes: str | None,
    stocks_of_interest: list[str] | None,
) -> AsyncIterator[str]:
    """Stream advisor response. Web search is server-side — one streaming call."""
    client = get_client()

    interest_line = ""
    if stocks_of_interest:
        interest_line = f"- Stocks I'm specifically interested in: {', '.join(s.upper() for s in stocks_of_interest)}\n"

    user_message = (
        f"Current portfolio:\n{json.dumps(portfolio, indent=2)}\n\n"
        f"Investment request:\n"
        f"- Budget: ${budget_usd:,.2f}\n"
        f"- Risk level: {risk_level}\n"
        f"- Sector preference: {sector_preference or 'none'}\n"
        f"{interest_line}"
        f"- Notes: {notes or 'none'}\n\n"
        "Search the web for current data on any stocks you plan to recommend, then advise."
    )

    try:
        async with client.messages.stream(
            model=MODEL,
            max_tokens=2048,
            system=[{"type": "text", "text": ADVISOR_SYSTEM_PROMPT, "cache_control": {"type": "ephemeral"}}],
            tools=[WEB_SEARCH_TOOL],
            messages=[{"role": "user", "content": user_message}],
        ) as stream:
            async for text in stream.text_stream:
                yield text
    except Exception as e:
        logging.error(f"Advisor stream error: {e}")
        yield f"\n\n[Error: {str(e)}]"
