from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.models.settings import AppSetting

router = APIRouter(prefix="/api/v1/settings", tags=["settings"])


async def _get(db: AsyncSession, key: str, default: str) -> str:
    row = (await db.execute(select(AppSetting).where(AppSetting.key == key))).scalar_one_or_none()
    return row.value if row else default


async def _set(db: AsyncSession, key: str, value: str):
    row = (await db.execute(select(AppSetting).where(AppSetting.key == key))).scalar_one_or_none()
    if row:
        row.value = value
    else:
        db.add(AppSetting(key=key, value=value))
    await db.commit()


@router.get("")
async def get_settings(db: AsyncSession = Depends(get_db)):
    enabled = await _get(db, "analysis_enabled", "true")
    return {"analysis_enabled": enabled == "true"}


@router.post("/analysis_enabled")
async def set_analysis_enabled(body: dict, db: AsyncSession = Depends(get_db)):
    enabled = bool(body.get("enabled", True))
    await _set(db, "analysis_enabled", "true" if enabled else "false")
    return {"analysis_enabled": enabled}
