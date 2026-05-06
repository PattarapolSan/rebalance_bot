import asyncio
from typing import Optional
import yfinance as yf
import pandas as pd


def _get_quote_sync(ticker: str) -> dict:
    t = yf.Ticker(ticker)
    # fast_info is reliable; fall back to a 5-day download if needed
    price = 0.0
    name = ticker
    market_cap = None
    try:
        fi = t.fast_info
        price = float(fi.last_price or fi.previous_close or 0)
        market_cap = getattr(fi, "market_cap", None)
        name = ticker  # fast_info has no display name
    except Exception:
        pass

    if price == 0:
        try:
            df = yf.download(ticker, period="5d", auto_adjust=True, progress=False)
            if not df.empty:
                price = float(df["Close"].iloc[-1])
        except Exception:
            pass

    # Try to get display name and extra fields from info (best-effort, non-blocking)
    try:
        info = t.info
        name = info.get("longName") or info.get("shortName") or ticker
        if price == 0:
            price = float(info.get("currentPrice") or info.get("regularMarketPrice") or info.get("previousClose") or 0)
        market_cap = market_cap or info.get("marketCap")
    except Exception:
        pass

    return {
        "ticker": ticker.upper(),
        "price": price,
        "name": name,
        "market_cap": market_cap,
    }


def _get_history_sync(ticker: str, period: str = "3mo") -> pd.DataFrame:
    t = yf.Ticker(ticker)
    df = t.history(period=period)
    return df


async def get_quote(ticker: str) -> dict:
    return await asyncio.to_thread(_get_quote_sync, ticker)


async def get_history(ticker: str, period: str = "3mo") -> pd.DataFrame:
    return await asyncio.to_thread(_get_history_sync, ticker, period)


async def get_quotes_batch(tickers: list[str]) -> dict[str, dict]:
    results = await asyncio.gather(*[get_quote(t) for t in tickers], return_exceptions=True)
    out = {}
    for ticker, result in zip(tickers, results):
        if isinstance(result, Exception):
            out[ticker] = {"ticker": ticker, "price": 0, "error": str(result)}
        else:
            out[ticker] = result
    return out


def _search_ticker_sync(query: str) -> list[dict]:
    """Basic ticker search using yfinance."""
    try:
        t = yf.Ticker(query)
        info = t.info
        if info.get("symbol"):
            return [{
                "ticker": info["symbol"],
                "name": info.get("longName") or info.get("shortName", query),
                "exchange": info.get("exchange", ""),
            }]
    except Exception:
        pass
    return []


async def search_ticker(query: str) -> list[dict]:
    return await asyncio.to_thread(_search_ticker_sync, query.upper())
