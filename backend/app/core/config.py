import logging
from functools import lru_cache
from typing import Literal

from pydantic import AliasChoices, Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "dunamis API"
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

    # Error monitoring. Leave SENTRY_DSN unset to disable. No personal data is sent.
    sentry_dsn: str | None = None
    sentry_traces_sample_rate: float = 0.0
    # The deployed version (git commit), shown in Sentry. Render sets RENDER_GIT_COMMIT.
    release: str | None = Field(None, validation_alias=AliasChoices("RELEASE", "RENDER_GIT_COMMIT"))
    log_level: str = "INFO"
    log_json: bool = False  # one JSON object per line, for log collectors

    # How many proxies in front of the API append to X-Forwarded-For (used for rate limits).
    # 1 = just the Next.js server; 2 = a load balancer in front of Next.js (Render, most PaaS).
    trusted_proxy_hops: int = 1

    cookie_secure: bool = False
    cors_origins: list[str] = ["http://localhost:3000"]
    frontend_url: str = "http://localhost:3000"

    @field_validator("database_url")
    @classmethod
    def _async_driver(cls, url: str) -> str:
        """Hosts hand out postgres://... URLs; the app needs the asyncpg driver, which
        spells the SSL option `ssl` rather than libpq's `sslmode`."""
        for prefix in ("postgres://", "postgresql://"):
            if url.startswith(prefix):
                url = "postgresql+asyncpg://" + url[len(prefix) :]
        if url.startswith("postgresql+asyncpg://"):
            url = url.replace("sslmode=", "ssl=")
        return url

    @property
    def is_sqlite(self) -> bool:
        return self.database_url.startswith("sqlite")


_DEV_SECRET = Settings.model_fields["jwt_secret"].default


def check_production(s: Settings) -> list[str]:
    """Refuses to start production with settings that would leak sessions or lose data.
    Returns warnings for things that are allowed but probably unintended."""
    if s.environment != "production":
        return []
    problems = []
    if s.jwt_secret == _DEV_SECRET or len(s.jwt_secret) < 32:
        problems.append("set a strong JWT_SECRET (32+ characters)")
    if not s.cookie_secure:
        problems.append("set COOKIE_SECURE=true (production must be served over HTTPS)")
    if s.is_sqlite:
        problems.append("use Postgres for DATABASE_URL (SQLite is for local development)")
    if s.scheduler == "inprocess":
        problems.append('set SCHEDULER=celery (and run the worker) or "off"')
    if problems:
        raise RuntimeError("Production settings need fixing: " + "; ".join(problems))
    warnings = []
    if s.storage_provider == "local":
        warnings.append(
            "STORAGE_PROVIDER=local: uploads are lost on redeploy unless STORAGE_DIR is a "
            "persistent disk. Use S3 or R2."
        )
    if s.email_provider == "console":
        warnings.append("EMAIL_PROVIDER=console: reminder emails are only printed to the log.")
    return warnings


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    for warning in check_production(s):
        logging.getLogger("gym_crm").warning(warning)
    return s


settings = get_settings()
