from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    anthropic_api_key: str = ""
    # Railway injects DATABASE_URL as postgres:// — we normalise it below
    database_url: str = "sqlite+aiosqlite:///./portfolio.db"
    analysis_schedule_hour: int = 18  # 6 PM
    analysis_schedule_minute: int = 0

    @property
    def async_database_url(self) -> str:
        url = self.database_url
        # Railway provides postgresql:// or postgres:// — convert to async driver
        if url.startswith("postgres://"):
            url = url.replace("postgres://", "postgresql+asyncpg://", 1)
        elif url.startswith("postgresql://"):
            url = url.replace("postgresql://", "postgresql+asyncpg://", 1)
        return url


settings = Settings()
