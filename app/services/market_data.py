import asyncio
from typing import Optional
import yfinance as yf
import pandas as pd


def _get_quote_sync(ticker: str) -> dict:
    t = yf.Ticker(ticker)
    info = t.info
    price = info.get("currentPrice") or info.get("regularMarketPrice") or info.get("previousClose", 0)
    return {
        "ticker": ticker.upper(),
        "price": float(price or 0),
        "name": info.get("longName") or info.get("shortName", ticker),
        "market_cap": info.get("marketCap"),
        "pe_ratio": info.get("trailingPE"),
        "52w_high": info.get("fiftyTwoWeekHigh"),
        "52w_low": info.get("fiftyTwoWeekLow"),
        "sector": info.get("sector"),
        "industry": info.get("industry"),
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
