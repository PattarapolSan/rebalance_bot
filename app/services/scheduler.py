import json
from datetime import date, datetime, timedelta
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from app.config import settings

scheduler = AsyncIOScheduler()

# Threshold that forces a run even on a "skip" day
PRICE_MOVE_THRESHOLD_PCT = 5.0   # any stock moved ±5% since last report → run


async def _should_skip(db, positions, quotes) -> tuple[bool, str]:
    """
    Return (skip, reason).
    Skip only if:
      - A report already ran within the last 24 hours, AND
      - No position has moved more than PRICE_MOVE_THRESHOLD_PCT since that report, AND
      - No new positions were added since that report.
    """
    from app.models.analysis import DailyReport, StockAnalysis
    from sqlalchemy import select

    # Find last report
    last_report = (await db.execute(
        select(DailyReport).order_by(DailyReport.report_date.desc()).limit(1)
    )).scalar_one_or_none()

    if last_report is None:
        return False, "no previous report"

    days_since = (date.today() - last_report.report_date).days
    if days_since == 0:
        return True, "already ran today"

    if days_since >= 2:
        return False, f"last ran {days_since} days ago"

    # Last report was yesterday — check if anything interesting happened
    last_analyses = {
        a.ticker: a
        for a in (await db.execute(
            select(StockAnalysis).where(StockAnalysis.report_id == last_report.id)
        )).scalars().all()
    }

    last_tickers = set(last_analyses.keys())
    current_tickers = {p.ticker for p in positions}

    # New position added since last report
    new_positions = current_tickers - last_tickers
    if new_positions:
        return False, f"new position(s) added: {', '.join(new_positions)}"

    # Check price moves and RSI extremes
    for pos in positions:
        q = quotes.get(pos.ticker, {})
        current_price = q.get("price", 0)
        last = last_analyses.get(pos.ticker)
        if not last or not last.current_price or current_price == 0:
            continue

        move_pct = abs(current_price - last.current_price) / last.current_price * 100
        if move_pct >= PRICE_MOVE_THRESHOLD_PCT:
            return False, f"{pos.ticker} moved {move_pct:.1f}% since last report"

    return True, "portfolio stable — skipping to save cost"


async def run_daily_analysis(force: bool = False, progress_cb=None, tickers_cb=None, ticker_done_cb=None):
    """
    Scheduled analysis job. Skips if portfolio is stable and ran yesterday,
    unless force=True (e.g. triggered manually from the UI).
    """
    from app.database import AsyncSessionLocal
    from app.models.portfolio import Position
    from app.models.analysis import DailyReport, StockAnalysis
    from app.services import market_data, ai_analysis
    from sqlalchemy import select

    async with AsyncSessionLocal() as db:
        # Check if analysis is enabled
        from app.models.settings import AppSetting
        setting = (await db.execute(
            select(AppSetting).where(AppSetting.key == "analysis_enabled")
        )).scalar_one_or_none()
        if setting and setting.value == "false":
            print("[scheduler] Analysis disabled — skipping")
            return

        positions = (await db.execute(select(Position))).scalars().all()
        if not positions:
            return

        tickers = [p.ticker for p in positions]
        quotes = await market_data.get_quotes_batch(tickers)

        if not force:
            skip, reason = await _should_skip(db, positions, quotes)
            if skip:
                print(f"[scheduler] Skipping analysis: {reason}")
                return
            print(f"[scheduler] Running analysis: {reason}")

        positions_data = []
        portfolio_value = 0.0
        portfolio_cost = 0.0

        for pos in positions:
            q = quotes.get(pos.ticker, {})
            current_price = q.get("price", 0)
            current_value = current_price * pos.quantity
            cost_basis = pos.entry_price * pos.quantity
            gain_loss = current_value - cost_basis
            portfolio_value += current_value
            portfolio_cost += cost_basis

            positions_data.append({
                "ticker": pos.ticker,
                "quantity": pos.quantity,
                "entry_price": pos.entry_price,
                "current_price": current_price,
                "current_value": current_value,
                "gain_loss": gain_loss,
                "gain_loss_pct": round((gain_loss / cost_basis * 100), 2) if cost_basis else 0,
                "company_name": q.get("name", pos.ticker),
            })

        if tickers_cb:
            tickers_cb([p["ticker"] for p in positions_data])
        if progress_cb:
            progress_cb(True, f"Analysing {len(positions_data)} stocks…")

        # Fetch previous analysis levels to give Claude historical context
        prev_report = (await db.execute(
            select(DailyReport).order_by(DailyReport.report_date.desc()).limit(1)
        )).scalar_one_or_none()
        prev_levels_map: dict = {}
        if prev_report:
            prev_analyses = (await db.execute(
                select(StockAnalysis).where(StockAnalysis.report_id == prev_report.id)
            )).scalars().all()
            prev_levels_map = {
                a.ticker: {"support": a.support, "resistance": a.resistance, "stop_loss": a.stop_loss}
                for a in prev_analyses
                if a.support is not None or a.resistance is not None
            }

        recommendations = await ai_analysis.run_daily_report(
            positions_data, progress_cb=progress_cb, ticker_done_cb=ticker_done_cb,
            prev_levels_map=prev_levels_map,
            portfolio_tickers=[p["ticker"] for p in positions_data],
        )
        rec_map = {r["ticker"]: r for r in recommendations}

        today = date.today()
        existing = (await db.execute(
            select(DailyReport).where(DailyReport.report_date == today)
        )).scalar_one_or_none()
        if existing:
            await db.delete(existing)
            await db.flush()

        portfolio_summary = {
            "total_value": round(portfolio_value, 2),
            "total_cost": round(portfolio_cost, 2),
            "total_gain_loss": round(portfolio_value - portfolio_cost, 2),
            "total_gain_loss_pct": round(
                (portfolio_value - portfolio_cost) / portfolio_cost * 100, 2
            ) if portfolio_cost else 0,
        }

        report = DailyReport(
            report_date=today,
            generated_at=datetime.now(),
            portfolio_summary=json.dumps(portfolio_summary),
        )
        db.add(report)
        await db.flush()

        for pd_item in positions_data:
            ticker = pd_item["ticker"]
            rec = rec_map.get(ticker, {
                "action": "hold", "confidence": "low", "rationale": "No analysis available."
            })
            db.add(StockAnalysis(
                report_id=report.id,
                ticker=ticker,
                current_price=pd_item["current_price"],
                recommendation=rec.get("action", "hold"),
                rationale=rec.get("verdict") or rec.get("rationale", ""),
                confidence=rec.get("confidence", "medium"),
                signal=rec.get("signal"),
                news=rec.get("news"),
                earnings=rec.get("earnings"),
                verdict=rec.get("verdict"),
                support=rec.get("support"),
                resistance=rec.get("resistance"),
                stop_loss=rec.get("stop_loss"),
                buy_suggestion=rec.get("buy_suggestion"),
            ))

        await db.commit()
        print(f"[scheduler] Analysis complete for {len(positions_data)} positions")


def start_scheduler():
    scheduler.add_job(
        run_daily_analysis,
        CronTrigger(
            hour=settings.analysis_schedule_hour,
            minute=settings.analysis_schedule_minute,
            timezone="Asia/Bangkok",
        ),
        id="daily_analysis",
        replace_existing=True,
    )
    scheduler.start()


def stop_scheduler():
    scheduler.shutdown(wait=False)
