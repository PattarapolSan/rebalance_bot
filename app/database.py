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
