"""AI analysis using Claude with built-in web search. Single-call architecture."""
import json
import logging
import re
import anthropic
from app.config import settings

MODEL = "claude-sonnet-4-6"

WEB_SEARCH_TOOL = {"type": "web_search_20260209", "name": "web_search"}

_client: anthropic.AsyncAnthropic | None = None

# Debug + cost tracking
_last_run: dict = {"status": "never", "stop_reason": None, "text_preview": "", "error": None}
_cost_log: list[dict] = []   # last 30 entries

# Sonnet 4.6 pricing (per million tokens, as of 2026)
_PRICE_IN  = 3.00   # $ per 1M input tokens
_PRICE_OUT = 15.00  # $ per 1M output tokens

def _record_cost(label: str, usage):
    """Log token usage and estimated cost from a response.usage object."""
    if not hasattr(usage, "input_tokens"):
        return
    inp = usage.input_tokens or 0
    out = usage.output_tokens or 0
    cost = (inp * _PRICE_IN + out * _PRICE_OUT) / 1_000_000
    entry = {"label": label, "input": inp, "output": out, "cost_usd": round(cost, 5)}
    _cost_log.append(entry)
    if len(_cost_log) > 30:
        _cost_log.pop(0)
    logging.info(f"[cost] {label}: in={inp} out={out} ~${cost:.4f}")


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


SINGLE_STOCK_SYSTEM_PROMPT = """You are a quantitative equity analyst. Analyse ONE stock using live web data.

Steps:
1. Search "[TICKER] RSI SMA technical analysis" — get RSI, SMA50, trend direction
2. Search "[TICKER] stock news" — get recent headlines

Output a single JSON object (nothing else):
{
  "ticker": "AAPL",
  "action": "buy_more" | "hold" | "sell",
  "confidence": "high" | "medium" | "low",
  "rationale": "2-4 sentences citing specific RSI/SMA values and news found",
  "support": 178.50,
  "resistance": 195.00,
  "stop_loss": 172.00,
  "buy_suggestion": null
}

Rules:
- Output ONLY the JSON object — no markdown, no prose
- Quote actual values from search — never fabricate
- RSI <30 oversold, RSI >70 overbought; price vs SMA50 = trend
- Large unrealised gain (>50%) → consider profit-taking
- support/resistance from recent highs/lows; stop_loss null if not determinable
- If action is "sell", set buy_suggestion to a specific ticker (e.g. "VOO") the investor should rotate into instead — search for a better alternative in the same sector or a safer ETF. Otherwise buy_suggestion must be null.
- If previous support/resistance levels are provided, note if current levels have shifted significantly (mention in rationale)"""

ADVISOR_SYSTEM_PROMPT = """You are a quantitative portfolio advisor. Output ONLY a single JSON object — no prose, no markdown.

Steps:
1. Review the user's current portfolio for concentration and gaps
2. Search the web for current price, RSI, SMA, and news for each stock you plan to recommend
3. If the user listed stocks of interest, search those first

Output format (strict JSON, nothing else):
{
  "snapshot": "1-2 sentences on current allocation and key risk",
  "suggestions": [
    {
      "ticker": "AMZN",
      "allocate_usd": 225,
      "current_price": 290.50,
      "rationale": "1-2 sentences with specific data from search",
      "support": 270.00,
      "resistance": 310.00,
      "stop_loss": 255.00
    }
  ],
  "allocation_note": "1 sentence on how budget changes the portfolio balance"
}

Rules:
- Output ONLY the JSON — no markdown, no explanation outside it
- 2-4 suggestions that fit within the budget total
- support/resistance/stop_loss from recent highs/lows — null if not determinable
- Never suggest tickers already in the portfolio unless adding more is clearly justified
- Risk guidelines: low=ETFs/dividend blue-chips, medium=large-cap growth+sector ETFs, high=small/mid-cap growth"""


async def _analyze_one(client, position: dict, prev_levels: dict | None = None,
                       portfolio_tickers: list[str] | None = None) -> dict | None:
    """Analyse a single stock. Returns dict or None on failure."""
    ticker = position.get("ticker", "?").upper()
    prev_line = ""
    if prev_levels:
        parts = []
        if prev_levels.get("support") is not None:
            parts.append(f"Support ${prev_levels['support']:.2f}")
        if prev_levels.get("resistance") is not None:
            parts.append(f"Resistance ${prev_levels['resistance']:.2f}")
        if prev_levels.get("stop_loss") is not None:
            parts.append(f"Stop Loss ${prev_levels['stop_loss']:.2f}")
        if parts:
            prev_line = f"\nPrevious analysis levels: {', '.join(parts)}. Note if these levels have changed."
    others = [t for t in (portfolio_tickers or []) if t != ticker]
    portfolio_line = f"\nExisting portfolio (already held): {', '.join(others)}. If recommending a buy_suggestion, avoid these tickers unless adding more is clearly justified — prefer something that diversifies." if others else ""
    user_msg = (
        f"Analyse {ticker}. Current price: ${position.get('current_price', 0):.2f}, "
        f"unrealised gain: {position.get('gain_loss_pct', 0):.1f}%.{prev_line}{portfolio_line}\n"
        "Search for RSI/SMA and recent news, then output the JSON object."
    )
    try:
        response = await client.messages.create(
            model=MODEL,
            max_tokens=1500,
            system=[{"type": "text", "text": SINGLE_STOCK_SYSTEM_PROMPT,
                     "cache_control": {"type": "ephemeral"}}],
            tools=[WEB_SEARCH_TOOL],
            messages=[{"role": "user", "content": user_msg}],
        )
    except Exception as e:
        logging.error(f"[{ticker}] API error: {e}")
        return None

    all_text = "\n".join(b.text for b in response.content if hasattr(b, "text"))
    _record_cost(f"daily/{ticker}", response.usage)
    logging.info(f"[{ticker}] stop={response.stop_reason} len={len(all_text)}")

    # Extract JSON object {...}
    start = all_text.find("{")
    end = all_text.rfind("}")
    if start == -1 or end == -1:
        # Fallback: try array syntax
        start = all_text.find("[")
        end = all_text.rfind("]")
    if start == -1 or end == -1:
        logging.error(f"[{ticker}] no JSON found: {all_text[:200]}")
        return None

    raw = all_text[start:end + 1]
    # Unwrap single-element array if Claude returned [{...}]
    if raw.startswith("["):
        raw = raw.strip()[1:-1].strip()

    try:
        result = json.loads(raw)
        # Handle array-of-one
        if isinstance(result, list):
            result = result[0] if result else None
        if result:
            result["ticker"] = ticker
        return result
    except json.JSONDecodeError:
        logging.error(f"[{ticker}] JSON parse failed: {raw[:200]}")
        return None


async def run_daily_report(positions_data: list[dict], progress_cb=None, ticker_done_cb=None,
                           prev_levels_map: dict | None = None,
                           portfolio_tickers: list[str] | None = None) -> list[dict]:
    """
    Parallel per-stock analysis — one API call per ticker, all running concurrently.
    Scales to any number of stocks, never hits token limits.
    prev_levels_map: {ticker: {support, resistance, stop_loss}} from last report.
    """
    import asyncio
    client = get_client()

    positions = [{k: v for k, v in p.items() if k != "history_df"} for p in positions_data]

    all_tickers = portfolio_tickers or [p.get("ticker", "").upper() for p in positions]

    async def _tracked(p):
        ticker = p.get("ticker", "?").upper()
        prev = (prev_levels_map or {}).get(ticker)
        result = await _analyze_one(client, p, prev_levels=prev, portfolio_tickers=all_tickers)
        if ticker_done_cb:
            ticker_done_cb(ticker)
        return result

    tasks = [_tracked(p) for p in positions]
    raw_results = await asyncio.gather(*tasks)

    results = [r for r in raw_results if r is not None]
    failed = len(positions) - len(results)

    _last_run.update({
        "status": f"ok:{len(results)} stocks" + (f" ({failed} failed)" if failed else ""),
        "stop_reason": "parallel",
        "text_preview": f"{len(results)}/{len(positions)} succeeded",
        "error": None,
    })
    logging.info(f"[daily_report] {len(results)}/{len(positions)} stocks analysed")
    return results


async def run_advisor(
    portfolio: list[dict],
    budget_usd: float,
    risk_level: str,
    sector_preference: str | None,
    notes: str | None,
    stocks_of_interest: list[str] | None,
) -> dict:
    """Call advisor and return parsed JSON dict with suggestions."""
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
        "Search the web for current data on stocks you plan to recommend, then output the JSON object."
    )

    response = await client.messages.create(
        model=MODEL,
        max_tokens=4096,
        system=[{"type": "text", "text": ADVISOR_SYSTEM_PROMPT, "cache_control": {"type": "ephemeral"}}],
        tools=[WEB_SEARCH_TOOL],
        messages=[{"role": "user", "content": user_message}],
    )
    _record_cost("advisor", response.usage)

    all_text = "\n".join(b.text for b in response.content if hasattr(b, "text"))
    start = all_text.find("{")
    end = all_text.rfind("}")
    if start == -1 or end == -1:
        logging.error(f"[advisor] no JSON in response: {all_text[:300]}")
        return {"error": "No structured response received. Please try again."}

    try:
        return json.loads(all_text[start:end + 1])
    except json.JSONDecodeError as e:
        logging.error(f"[advisor] JSON parse error: {e} — {all_text[start:start+300]}")
        return {"error": "Failed to parse advisor response. Please try again."}
