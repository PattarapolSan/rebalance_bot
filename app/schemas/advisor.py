from typing import Literal, Optional
from pydantic import BaseModel, field_validator


class AdvisorRequest(BaseModel):
    budget_usd: float
    risk_level: Literal["low", "medium", "high"] = "medium"
    sector_preference: Optional[str] = None
    notes: Optional[str] = None
    stocks_of_interest: Optional[list[str]] = None

    @field_validator("stocks_of_interest")
    @classmethod
    def uppercase_tickers(cls, v):
        if v:
            return [t.upper().strip() for t in v if t.strip()]
        return v
