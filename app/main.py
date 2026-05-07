from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from app.database import init_db
from app.services.scheduler import start_scheduler, stop_scheduler
from app.routers import portfolio, analysis, advisor, settings


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    start_scheduler()
    yield
    stop_scheduler()


app = FastAPI(title="Rebalance Bot", lifespan=lifespan)

app.include_router(portfolio.router)
app.include_router(analysis.router)
app.include_router(advisor.router)
app.include_router(settings.router)


@app.get("/api/v1/health")
async def health():
    return {"status": "ok"}


@app.get("/api/v1/market/quote/{ticker}")
async def quote(ticker: str):
    from app.services import market_data
    return await market_data.get_quote(ticker.upper())


@app.get("/api/v1/market/search")
async def search(q: str):
    from app.services import market_data
    return await market_data.search_ticker(q)


# Serve static frontend — must be last
app.mount("/", StaticFiles(directory="static", html=True), name="static")
