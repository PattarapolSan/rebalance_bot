from datetime import datetime, date
from sqlalchemy import Float, Integer, String, DateTime, Date, ForeignKey, Text, func
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base


class DailyReport(Base):
    __tablename__ = "daily_reports"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    report_date: Mapped[date] = mapped_column(Date, unique=True, nullable=False)
    generated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    portfolio_summary: Mapped[str] = mapped_column(Text, default="")  # JSON


class StockAnalysis(Base):
    __tablename__ = "stock_analyses"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    report_id: Mapped[int] = mapped_column(Integer, ForeignKey("daily_reports.id", ondelete="CASCADE"), nullable=False)
    ticker: Mapped[str] = mapped_column(String(10), nullable=False)
    current_price: Mapped[float] = mapped_column(Float, nullable=False)
    recommendation: Mapped[str] = mapped_column(String(20), nullable=False)  # buy_more | hold | sell
    confidence: Mapped[str] = mapped_column(String(10), default="medium")
    rationale: Mapped[str] = mapped_column(Text, default="")
    support: Mapped[float] = mapped_column(Float, nullable=True)
    resistance: Mapped[float] = mapped_column(Float, nullable=True)
    stop_loss: Mapped[float] = mapped_column(Float, nullable=True)
    buy_suggestion: Mapped[str] = mapped_column(String(20), nullable=True)
