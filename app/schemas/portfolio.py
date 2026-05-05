from datetime import datetime
from typing import Optional
from pydantic import BaseModel, field_validator


class PositionCreate(BaseModel):
    ticker: str
    quantity: float
    entry_price: float
    notes: str = ""

    @field_validator("ticker")
    @classmethod
    def ticker_upper(cls, v: str) -> str:
        return v.upper().strip()

    @field_validator("quantity", "entry_price")
    @classmethod
    def must_be_positive(cls, v: float) -> float:
        if v <= 0:
            raise ValueError("must be positive")
        return v


class PositionUpdate(BaseModel):
    quantity: Optional[float] = None
    entry_price: Optional[float] = None
    notes: Optional[str] = None


class PositionResponse(BaseModel):
    id: int
    ticker: str
    quantity: float
    entry_price: float
    notes: str
    created_at: datetime
    updated_at: datetime
    # Computed fields (added at query time)
    current_price: Optional[float] = None
    current_value: Optional[float] = None
    cost_basis: Optional[float] = None
    gain_loss: Optional[float] = None
    gain_loss_pct: Optional[float] = None

    model_config = {"from_attributes": True}
