from datetime import datetime, date
from typing import List, Optional
from pydantic import BaseModel


class StockAnalysisResponse(BaseModel):
    id: int
    ticker: str
    current_price: float
    recommendation: str
    confidence: str
    rationale: str
    signal: Optional[str] = None
    news: Optional[str] = None
    earnings: Optional[str] = None
    verdict: Optional[str] = None
    support: Optional[float] = None
    resistance: Optional[float] = None
    stop_loss: Optional[float] = None
    buy_suggestion: Optional[str] = None

    model_config = {"from_attributes": True}


class DailyReportResponse(BaseModel):
    id: int
    report_date: date
    generated_at: datetime
    portfolio_summary: dict
    analyses: List[StockAnalysisResponse] = []

    model_config = {"from_attributes": True}
