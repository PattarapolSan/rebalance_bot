from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.models.portfolio import Position
from app.schemas.advisor import AdvisorRequest
from app.services import market_data, ai_analysis

router = APIRouter(prefix="/api/v1/advisor", tags=["advisor"])


@router.post("")
async def get_advice(body: AdvisorRequest, db: AsyncSession = Depends(get_db)):
    positions = (await db.execute(select(Position))).scalars().all()
    tickers = [p.ticker for p in positions]
    quotes = await market_data.get_quotes_batch(tickers) if tickers else {}

    portfolio = []
    for pos in positions:
        q = quotes.get(pos.ticker, {})
        current_price = q.get("price") or 0
        portfolio.append({
            "ticker": pos.ticker,
            "quantity": pos.quantity,
            "entry_price": pos.entry_price,
            "current_price": current_price,
            "current_value": round(current_price * pos.quantity, 2),
            "gain_loss_pct": round(
                (current_price - pos.entry_price) / pos.entry_price * 100, 2
            ) if pos.entry_price else 0,
            "sector": q.get("sector"),
            "company_name": q.get("name", pos.ticker),
        })

    async def event_stream():
        full_text = []
        async for chunk in ai_analysis.run_advisor_stream(
            portfolio=portfolio,
            budget_usd=body.budget_usd,
            risk_level=body.risk_level,
            sector_preference=body.sector_preference,
            notes=body.notes,
        ):
            yield f"data: {chunk}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")
