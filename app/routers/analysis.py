import asyncio
import json
from datetime import date
from typing import List
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.models.analysis import DailyReport, StockAnalysis
from app.schemas.analysis import DailyReportResponse, StockAnalysisResponse

router = APIRouter(prefix="/api/v1/analysis", tags=["analysis"])

# In-memory state + subscriber queues for SSE push
_analysis_state: dict = {"running": False, "message": "idle", "tickers": [], "done": []}
_subscribers: list[asyncio.Queue] = []


def _set_state(running: bool, message: str):
    _analysis_state["running"] = running
    _analysis_state["message"] = message
    _push({**_analysis_state})


def _set_tickers(tickers: list[str]):
    _analysis_state["tickers"] = tickers
    _analysis_state["done"] = []
    _push({**_analysis_state})


def _ticker_done(ticker: str):
    if ticker not in _analysis_state["done"]:
        _analysis_state["done"].append(ticker)
    _analysis_state["message"] = f"{len(_analysis_state['done'])}/{len(_analysis_state['tickers'])} complete"
    _push({**_analysis_state})


def _push(data: dict):
    """Push a state update to all connected SSE clients."""
    dead = []
    for q in _subscribers:
        try:
            q.put_nowait(data)
        except asyncio.QueueFull:
            dead.append(q)
    for q in dead:
        _subscribers.remove(q)


def _build_report_response(report: DailyReport, analyses: list[StockAnalysis]) -> DailyReportResponse:
    summary = {}
    try:
        summary = json.loads(report.portfolio_summary) if report.portfolio_summary else {}
    except Exception:
        pass

    stock_responses = []
    for a in analyses:
        stock_responses.append(StockAnalysisResponse(
            id=a.id,
            ticker=a.ticker,
            current_price=a.current_price,
            recommendation=a.recommendation,
            confidence=a.confidence,
            rationale=a.rationale,
            support=a.support,
            resistance=a.resistance,
            stop_loss=a.stop_loss,
        ))

    return DailyReportResponse(
        id=report.id,
        report_date=report.report_date,
        generated_at=report.generated_at,
        portfolio_summary=summary,
        analyses=stock_responses,
    )


@router.get("/latest", response_model=DailyReportResponse)
async def get_latest_report(db: AsyncSession = Depends(get_db)):
    report = (await db.execute(
        select(DailyReport).order_by(DailyReport.report_date.desc()).limit(1)
    )).scalar_one_or_none()
    if not report:
        raise HTTPException(status_code=404, detail="No reports yet")

    analyses = (await db.execute(
        select(StockAnalysis).where(StockAnalysis.report_id == report.id)
    )).scalars().all()

    return _build_report_response(report, list(analyses))


@router.get("/latest-levels")
async def latest_levels(db: AsyncSession = Depends(get_db)):
    """Return the most recent support/resistance/stop_loss + recommendation for each ticker."""
    report = (await db.execute(
        select(DailyReport).order_by(DailyReport.report_date.desc()).limit(1)
    )).scalar_one_or_none()
    if not report:
        return {}
    analyses = (await db.execute(
        select(StockAnalysis).where(StockAnalysis.report_id == report.id)
    )).scalars().all()
    return {
        a.ticker: {
            "recommendation": a.recommendation,
            "confidence": a.confidence,
            "support": a.support,
            "resistance": a.resistance,
            "stop_loss": a.stop_loss,
            "buy_suggestion": getattr(a, "buy_suggestion", None),
        }
        for a in analyses
    }


@router.get("/schedule")
async def get_schedule():
    from app.config import settings
    return {
        "hour": settings.analysis_schedule_hour,
        "minute": settings.analysis_schedule_minute,
        "timezone": "Asia/Bangkok",
    }


@router.get("/history")
async def list_reports(db: AsyncSession = Depends(get_db)):
    reports = (await db.execute(
        select(DailyReport.id, DailyReport.report_date, DailyReport.generated_at)
        .order_by(DailyReport.report_date.desc())
    )).all()
    return [{"id": r.id, "date": str(r.report_date), "generated_at": r.generated_at} for r in reports]


@router.get("/status")
async def analysis_status():
    from app.services.ai_analysis import _last_run, _cost_log
    total_cost = round(sum(e["cost_usd"] for e in _cost_log), 4)
    response = {**_analysis_state, "last_run": _last_run,
                "cost_log": _cost_log[-10:], "total_cost_usd": total_cost}
    if _analysis_state["message"] == "done":
        _analysis_state["message"] = "idle"
    return response


@router.get("/stream")
async def analysis_stream():
    """SSE endpoint — pushes state updates as analysis progresses."""
    q: asyncio.Queue = asyncio.Queue(maxsize=50)
    _subscribers.append(q)
    # Send current state immediately so client knows if already running
    await q.put({**_analysis_state})

    async def event_generator():
        try:
            while True:
                try:
                    data = await asyncio.wait_for(q.get(), timeout=25)
                    yield f"data: {json.dumps(data)}\n\n"
                    if not data.get("running") and data.get("message") in ("done", "idle"):
                        break
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"  # prevent proxy timeout
        finally:
            if q in _subscribers:
                _subscribers.remove(q)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/{report_date}", response_model=DailyReportResponse)
async def get_report_by_date(report_date: date, db: AsyncSession = Depends(get_db)):
    report = (await db.execute(
        select(DailyReport).where(DailyReport.report_date == report_date)
    )).scalar_one_or_none()
    if not report:
        raise HTTPException(status_code=404, detail=f"No report for {report_date}")

    analyses = (await db.execute(
        select(StockAnalysis).where(StockAnalysis.report_id == report.id)
    )).scalars().all()

    return _build_report_response(report, list(analyses))


async def _run_with_status():
    _set_state(True, "Fetching market prices…")
    try:
        from app.services.scheduler import run_daily_analysis
        await run_daily_analysis(force=True, progress_cb=_set_state,
                                 tickers_cb=_set_tickers, ticker_done_cb=_ticker_done)
        _set_state(False, "done")
    except Exception as e:
        _set_state(False, f"error: {str(e)[:120]}")


@router.post("/trigger", status_code=202)
async def trigger_analysis(background_tasks: BackgroundTasks, db: AsyncSession = Depends(get_db)):
    from app.models.settings import AppSetting
    setting = (await db.execute(
        select(AppSetting).where(AppSetting.key == "analysis_enabled")
    )).scalar_one_or_none()
    if setting and setting.value == "false":
        return {"message": "Analysis is disabled", "disabled": True}
    if _analysis_state["running"]:
        return {"message": "Analysis already running"}
    _set_state(True, "Starting…")
    background_tasks.add_task(_run_with_status)
    return {"message": "Analysis triggered"}
