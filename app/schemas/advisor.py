from typing import Literal, Optional
from pydantic import BaseModel


class AdvisorRequest(BaseModel):
    budget_usd: float
    risk_level: Literal["low", "medium", "high"] = "medium"
    sector_preference: Optional[str] = None
    notes: Optional[str] = None
