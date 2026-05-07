from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.models.settings import AppSetting

router = APIRouter(prefix="/api/v1/settings", tags=["settings"])

MODELS = {
    "sonnet": "claude-sonnet-4-6",
    "haiku":  "claude-haiku-4-5-20251001",
}
# Rough cost per run (8 stocks, 2 web searches each)
MODEL_COST_HINT = {
    "sonnet": "~$0.80/run",
    "haiku":  "~$0.10/run",
}


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
    model_key = await _get(db, "analysis_model", "sonnet")
    if model_key not in MODELS:
        model_key = "sonnet"
    return {
        "analysis_enabled": enabled == "true",
        "analysis_model": model_key,
        "analysis_model_id": MODELS[model_key],
        "analysis_model_cost_hint": MODEL_COST_HINT[model_key],
    }


@router.post("/analysis_enabled")
async def set_analysis_enabled(body: dict, db: AsyncSession = Depends(get_db)):
    enabled = bool(body.get("enabled", True))
    await _set(db, "analysis_enabled", "true" if enabled else "false")
    return {"analysis_enabled": enabled}


@router.post("/analysis_model")
async def set_analysis_model(body: dict, db: AsyncSession = Depends(get_db)):
    model_key = body.get("model", "sonnet")
    if model_key not in MODELS:
        model_key = "sonnet"
    await _set(db, "analysis_model", model_key)
    return {"analysis_model": model_key, "analysis_model_id": MODELS[model_key], "analysis_model_cost_hint": MODEL_COST_HINT[model_key]}
