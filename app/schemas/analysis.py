from datetime import datetime, date
from typing import List, Optional
from pydantic import BaseModel


class StockAnalysisResponse(BaseModel):
    id: int
    ticker: str
    current_price: float
    rsi_14: Optional[float]
    sma_20: Optional[float]
    sma_50: Optional[float]
    volume_ratio: Optional[float]
    sma_cross: Optional[str]
    news_headlines: List[str] = []
    recommendation: str
    rationale: str
    confidence: str

    model_config = {"from_attributes": True}


class DailyReportResponse(BaseModel):
    id: int
    report_date: date
    generated_at: datetime
    portfolio_summary: dict
    analyses: List[StockAnalysisResponse] = []

    model_config = {"from_attributes": True}
