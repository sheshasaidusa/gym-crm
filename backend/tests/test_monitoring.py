import logging

from httpx import AsyncClient

from app.core.monitoring import _scrub, redact


async def test_request_id_and_security_headers(client: AsyncClient):
    res = await client.get("/api/health")
    assert len(res.headers["x-request-id"]) == 32
    assert res.headers["x-content-type-options"] == "nosniff"
    assert res.headers["x-frame-options"] == "DENY"
    echoed = await client.get("/api/health", headers={"X-Request-ID": "abc-123"})
    assert echoed.headers["x-request-id"] == "abc-123"


async def test_readiness_checks_the_database(client: AsyncClient):
    res = await client.get("/api/health/ready")
    assert res.status_code == 200 and res.json() == {"status": "ok"}


async def test_access_log_hides_tokens(client: AsyncClient, caplog):
    logger = logging.getLogger("gym_crm")
    logger.propagate = True  # let caplog see it
    try:
        with caplog.at_level(logging.INFO, logger="gym_crm.access"):
            await client.get("/api/public/p/Zx9_secretTokenValue1234567890")
    finally:
        logger.propagate = False
    line = next(r for r in caplog.records if r.name == "gym_crm.access")
    assert line.path == "/api/public/p/:token" and line.status == 404
    assert "secretToken" not in caplog.text


def test_redact_keeps_ids_and_words():
    assert redact("/api/members/0b8a3f7e-1234-4cde-8f00-1234567890ab") == (
        "/api/members/0b8a3f7e-1234-4cde-8f00-1234567890ab"
    )
    assert redact("/api/auth/invites/abcdefghijklmnopqrstuvwxyz0/accept") == (
        "/api/auth/invites/:token/accept"
    )
    assert redact("/api/finance/summary") == "/api/finance/summary"


def test_sentry_scrub_drops_personal_data():
    event = {
        "request": {
            "url": "https://gym.example/api/public/p/Zx9_secretTokenValue1234567890",
            "data": {"name": "Asha", "medical_notes": "Asthma"},
            "cookies": {"access_token": "x"},
            "query_string": "q=asha",
            "headers": {"Authorization": "Bearer x", "User-Agent": "test"},
        }
    }
    req = _scrub(event, None)["request"]
    assert "data" not in req and "cookies" not in req and "query_string" not in req
    assert req["url"].endswith("/p/:token")
    assert req["headers"] == {"Authorization": "[removed]", "User-Agent": "test"}
