import pytest

from app.core.config import Settings


@pytest.mark.parametrize(
    ("given", "expected"),
    [
        ("postgres://u:p@h:5432/db", "postgresql+asyncpg://u:p@h:5432/db"),
        ("postgresql://u:p@h/db?sslmode=require", "postgresql+asyncpg://u:p@h/db?ssl=require"),
        ("postgresql+asyncpg://u:p@h/db", "postgresql+asyncpg://u:p@h/db"),
        ("sqlite+aiosqlite:///./dev.db", "sqlite+aiosqlite:///./dev.db"),
    ],
)
def test_database_url_gets_async_driver(given, expected):
    assert Settings(database_url=given).database_url == expected


def test_production_refuses_unsafe_settings():
    from app.core.config import check_production

    assert check_production(Settings(environment="development")) == []
    with pytest.raises(RuntimeError) as exc:
        check_production(Settings(environment="production", scheduler="inprocess"))
    message = str(exc.value)
    for bit in ("JWT_SECRET", "COOKIE_SECURE", "Postgres", "SCHEDULER"):
        assert bit in message
    ok = Settings(
        environment="production",
        jwt_secret="x" * 40,
        cookie_secure=True,
        database_url="postgres://u:p@h/db",
        scheduler="celery",
        storage_provider="s3",
        email_provider="resend",
    )
    assert check_production(ok) == []
    assert "STORAGE" in check_production(ok.model_copy(update={"storage_provider": "local"}))[0]
