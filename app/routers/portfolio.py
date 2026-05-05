from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.models.portfolio import Position
from app.schemas.portfolio import PositionCreate, PositionUpdate, PositionResponse
from app.services import market_data

router = APIRouter(prefix="/api/v1/portfolio", tags=["portfolio"])


@router.get("", response_model=List[PositionResponse])
async def list_positions(db: AsyncSession = Depends(get_db)):
    positions = (await db.execute(select(Position))).scalars().all()
    tickers = [p.ticker for p in positions]
    if not tickers:
        return []

    quotes = await market_data.get_quotes_batch(tickers)
    result = []
    for pos in positions:
        q = quotes.get(pos.ticker, {})
        current_price = q.get("price") or 0
        current_value = current_price * pos.quantity
        cost_basis = pos.entry_price * pos.quantity
        gain_loss = current_value - cost_basis
        gain_loss_pct = (gain_loss / cost_basis * 100) if cost_basis else 0

        r = PositionResponse.model_validate(pos)
        r.current_price = current_price
        r.current_value = round(current_value, 2)
        r.cost_basis = round(cost_basis, 2)
        r.gain_loss = round(gain_loss, 2)
        r.gain_loss_pct = round(gain_loss_pct, 2)
        result.append(r)
    return result


@router.post("", response_model=PositionResponse, status_code=201)
async def add_position(body: PositionCreate, db: AsyncSession = Depends(get_db)):
    existing = (await db.execute(
        select(Position).where(Position.ticker == body.ticker)
    )).scalar_one_or_none()
    
    if existing:
        # Merge logic: Weighted average cost
        total_qty = existing.quantity + body.quantity
        total_cost = (existing.quantity * existing.entry_price) + (body.quantity * body.entry_price)
        new_avg_cost = total_cost / total_qty
        
        existing.quantity = total_qty
        existing.entry_price = new_avg_cost
        if body.notes:
            existing.notes = f"{existing.notes} | {body.notes}" if existing.notes else body.notes
            
        await db.commit()
        await db.refresh(existing)
        # We need to manually calculate the response fields or refetch
        # For simplicity, we just return the updated existing as PositionResponse
        return await update_position_response(existing, db)

    pos = Position(**body.model_dump())
    db.add(pos)
    await db.commit()
    await db.refresh(pos)
    return await update_position_response(pos, db)

async def update_position_response(pos: Position, db: AsyncSession):
    # Helper to return formatted response with live quotes
    quotes = await market_data.get_quotes_batch([pos.ticker])
    q = quotes.get(pos.ticker, {})
    current_price = q.get("price") or 0
    current_value = current_price * pos.quantity
    cost_basis = pos.entry_price * pos.quantity
    gain_loss = current_value - cost_basis
    gain_loss_pct = (gain_loss / cost_basis * 100) if cost_basis else 0

    r = PositionResponse.model_validate(pos)
    r.current_price = current_price
    r.current_value = round(current_value, 2)
    r.cost_basis = round(cost_basis, 2)
    r.gain_loss = round(gain_loss, 2)
    r.gain_loss_pct = round(gain_loss_pct, 2)
    return r


@router.put("/{position_id}", response_model=PositionResponse)
async def update_position(position_id: int, body: PositionUpdate, db: AsyncSession = Depends(get_db)):
    pos = await db.get(Position, position_id)
    if not pos:
        raise HTTPException(status_code=404, detail="Position not found")

    for field, value in body.model_dump(exclude_none=True).items():
        setattr(pos, field, value)
    await db.commit()
    await db.refresh(pos)
    return PositionResponse.model_validate(pos)


@router.delete("/{position_id}", status_code=204)
async def delete_position(position_id: int, db: AsyncSession = Depends(get_db)):
    pos = await db.get(Position, position_id)
    if not pos:
        raise HTTPException(status_code=404, detail="Position not found")
    await db.delete(pos)
    await db.commit()


@router.get("/{position_id}/history")
async def position_history(position_id: int, db: AsyncSession = Depends(get_db)):
    pos = await db.get(Position, position_id)
    if not pos:
        raise HTTPException(status_code=404, detail="Position not found")

    hist = await market_data.get_history(pos.ticker, "1mo")
    if hist.empty:
        return {"ticker": pos.ticker, "history": []}

    history = [
        {"date": str(idx.date()), "close": round(float(row["Close"]), 4)}
        for idx, row in hist.iterrows()
    ]
    return {"ticker": pos.ticker, "history": history}
