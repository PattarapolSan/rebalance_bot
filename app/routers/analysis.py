import json
from datetime import date
from typing import List
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.models.analysis import DailyReport, StockAnalysis
from app.schemas.analysis import DailyReportResponse, StockAnalysisResponse

router = APIRouter(prefix="/api/v1/analysis", tags=["analysis"])

# Simple in-memory run state
_analysis_state: dict = {"running": False, "message": "idle"}


def _set_state(running: bool, message: str):
    _analysis_state["running"] = running
    _analysis_state["message"] = message


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


@router.get("/history")
async def list_reports(db: AsyncSession = Depends(get_db)):
    reports = (await db.execute(
        select(DailyReport.id, DailyReport.report_date, DailyReport.generated_at)
        .order_by(DailyReport.report_date.desc())
    )).all()
    return [{"id": r.id, "date": str(r.report_date), "generated_at": r.generated_at} for r in reports]


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


@router.get("/status")
async def analysis_status():
    return _analysis_state


async def _run_with_status():
    _set_state(True, "Fetching market prices…")
    try:
        from app.services.scheduler import run_daily_analysis
        # Monkey-patch scheduler to update message at key steps
        import app.routers.analysis as _self
        _self._analysis_state["message"] = "Claude is searching the web for each stock…"
        await run_daily_analysis(force=True)
        _set_state(False, "done")
    except Exception as e:
        _set_state(False, f"error: {e}")


@router.post("/trigger", status_code=202)
async def trigger_analysis(background_tasks: BackgroundTasks):
    if _analysis_state["running"]:
        return {"message": "Analysis already running"}
    _set_state(True, "Starting…")
    background_tasks.add_task(_run_with_status)
    return {"message": "Analysis triggered"}
