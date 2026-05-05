import pandas as pd
import numpy as np


def compute(history_df: pd.DataFrame) -> dict:
    """Compute quant signals from OHLCV DataFrame returned by yfinance."""
    if history_df.empty or len(history_df) < 20:
        return {}

    close = history_df["Close"].squeeze()
    volume = history_df["Volume"].squeeze()

    # RSI-14
    delta = close.diff()
    gain = delta.clip(lower=0).ewm(span=14, adjust=False).mean()
    loss = (-delta.clip(upper=0)).ewm(span=14, adjust=False).mean()
    rs = gain / loss.replace(0, np.nan)
    rsi = 100 - (100 / (1 + rs))

    # SMA crossover
    sma_20 = close.rolling(20).mean()
    sma_50 = close.rolling(50).mean() if len(close) >= 50 else pd.Series([np.nan] * len(close))
    sma_cross = "bullish" if (not pd.isna(sma_50.iloc[-1]) and sma_20.iloc[-1] > sma_50.iloc[-1]) else "bearish"

    # Volume ratio (today vs 20-day avg)
    vol_avg = volume.rolling(20).mean()
    vol_ratio = volume.iloc[-1] / vol_avg.iloc[-1] if vol_avg.iloc[-1] > 0 else 1.0

    # 52-week high/low
    lookback = min(252, len(close))
    high_52w = close.iloc[-lookback:].max()
    low_52w = close.iloc[-lookback:].min()

    # Price vs SMA
    price_vs_sma20 = ((close.iloc[-1] - sma_20.iloc[-1]) / sma_20.iloc[-1] * 100) if not pd.isna(sma_20.iloc[-1]) else None

    return {
        "rsi_14": round(float(rsi.iloc[-1]), 2) if not pd.isna(rsi.iloc[-1]) else None,
        "sma_20": round(float(sma_20.iloc[-1]), 4) if not pd.isna(sma_20.iloc[-1]) else None,
        "sma_50": round(float(sma_50.iloc[-1]), 4) if not pd.isna(sma_50.iloc[-1]) else None,
        "sma_cross": sma_cross,
        "volume_ratio": round(float(vol_ratio), 2),
        "price_52w_high": round(float(high_52w), 4),
        "price_52w_low": round(float(low_52w), 4),
        "price_vs_sma20_pct": round(float(price_vs_sma20), 2) if price_vs_sma20 is not None else None,
    }
