from functools import lru_cache
from typing import Literal

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "Gym CRM API"
    environment: str = "development"

    # SQLite for local dev without Docker; use postgresql+asyncpg://... in production.
    database_url: str = "sqlite+aiosqlite:///./dev.db"

    jwt_secret: str = "change-me-in-production-please-use-a-long-random-string"
    jwt_algorithm: str = "HS256"
    access_token_minutes: int = 30
    refresh_token_days: int = 14
    invite_token_days: int = 7

    # Background jobs. "inprocess" runs the scheduler inside the API (local dev, single
    # instance); "celery" expects a Celery worker + beat (production); "off" disables it.
    scheduler: Literal["inprocess", "celery", "off"] = "inprocess"
    redis_url: str = "redis://localhost:6379/0"

    # Email. "console" prints messages to the server log instead of sending them.
    email_provider: Literal["console", "smtp", "resend"] = "console"
    email_from_address: str = "reminders@example.com"
    smtp_host: str = "localhost"
    smtp_port: int = 587
    smtp_username: str | None = None
    smtp_password: str | None = None
    smtp_starttls: bool = True
    resend_api_key: str | None = None

    # File storage for uploads (progress photos). "local" writes to storage_dir;
    # "s3" works with AWS S3 or any S3-compatible store (Cloudflare R2, MinIO).
    storage_provider: Literal["local", "s3"] = "local"
    storage_dir: str = "./uploads"
    s3_bucket: str | None = None
    s3_region: str | None = None
    s3_endpoint_url: str | None = None
    s3_access_key_id: str | None = None
    s3_secret_access_key: str | None = None

    # AI plan generation (Anthropic). ANTHROPIC_API_KEY is read by the SDK; leave unset to
    # disable generation (the UI explains how to enable it).
    anthropic_api_key: str | None = None
    ai_model: str = "claude-opus-5-5"
    ai_effort: Literal["low", "medium", "high"] = "medium"
    ai_monthly_plan_limit: int = 100  # per gym

    cookie_secure: bool = False
    cors_origins: list[str] = ["http://localhost:3000"]
    frontend_url: str = "http://localhost:3000"

    @field_validator("database_url")
    @classmethod
    def _use_async_driver(cls, v: str) -> str:
        # Hosts such as Render hand out plain postgres:// or postgresql:// URLs.
        for prefix in ("postgres://", "postgresql://"):
            if v.startswith(prefix):
                return "postgresql+asyncpg://" + v[len(prefix) :]
        return v

    @property
    def is_sqlite(self) -> bool:
        return self.database_url.startswith("sqlite")


_DEV_SECRET = Settings.model_fields["jwt_secret"].default


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    if s.environment == "production" and (s.jwt_secret == _DEV_SECRET or len(s.jwt_secret) < 32):
        raise RuntimeError("Set a strong JWT_SECRET (32+ chars) in production")
    return s


settings = get_settings()
