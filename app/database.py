from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase

from app.config import settings

engine = create_async_engine(settings.async_database_url, echo=False)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncSession:
    async with AsyncSessionLocal() as session:
        yield session


async def init_db():
    async with engine.begin() as conn:
        from app.models import portfolio, analysis  # noqa: F401
        await conn.run_sync(Base.metadata.create_all)
        await _fix_fk_cascade(conn)
        await _add_key_level_columns(conn)


async def _add_key_level_columns(conn):
    """Add support/resistance/stop_loss columns and clean up old NOT NULL columns (idempotent)."""
    from sqlalchemy import text
    if "postgresql" not in settings.async_database_url:
        return
    for col in ("support", "resistance", "stop_loss"):
        await conn.execute(text(f"""
            DO $$ BEGIN
                ALTER TABLE stock_analyses ADD COLUMN IF NOT EXISTS {col} DOUBLE PRECISION;
            END $$;
        """))
    await conn.execute(text("""
        DO $$ BEGIN
            ALTER TABLE stock_analyses ADD COLUMN IF NOT EXISTS buy_suggestion VARCHAR(20);
        END $$;
    """))
    for col in ("signal", "news", "earnings", "verdict"):
        await conn.execute(text(f"""
            DO $$ BEGIN
                ALTER TABLE stock_analyses ADD COLUMN IF NOT EXISTS {col} TEXT;
            END $$;
        """))
    # Drop NOT NULL constraints on old columns that are no longer populated
    for col in ("news_headlines", "rsi_14", "sma_20", "sma_50", "volume_ratio", "sma_cross"):
        await conn.execute(text(f"""
            DO $$ BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name='stock_analyses' AND column_name='{col}'
                ) THEN
                    ALTER TABLE stock_analyses ALTER COLUMN {col} DROP NOT NULL;
                END IF;
            END $$;
        """))


async def _fix_fk_cascade(conn):
    """Ensure stock_analyses.report_id has ON DELETE CASCADE (idempotent)."""
    from sqlalchemy import text
    # Only applies to Postgres — SQLite handles this differently
    url = settings.async_database_url
    if "postgresql" not in url:
        return
    await conn.execute(text("""
        DO $$
        BEGIN
            -- Drop old constraint if it exists without CASCADE
            IF EXISTS (
                SELECT 1 FROM information_schema.table_constraints
                WHERE constraint_name = 'stock_analyses_report_id_fkey'
                AND table_name = 'stock_analyses'
            ) THEN
                ALTER TABLE stock_analyses
                    DROP CONSTRAINT stock_analyses_report_id_fkey;
            END IF;
            -- Re-add with ON DELETE CASCADE
            ALTER TABLE stock_analyses
                ADD CONSTRAINT stock_analyses_report_id_fkey
                FOREIGN KEY (report_id) REFERENCES daily_reports(id)
                ON DELETE CASCADE;
        END $$;
    """))
