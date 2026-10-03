from httpx import AsyncClient

from tests.conftest import Account


async def test_signup_creates_gym_branch_and_owner(client: AsyncClient):
    res = await client.post(
        "/api/auth/signup",
        json={
            "name": "Asha",
            "email": "Asha@Example.com",
            "password": "supersecret1",
            "gym_name": "Flex Fitness",
        },
    )
    assert res.status_code == 201
    body = res.json()
    assert body["user"]["email"] == "asha@example.com"
    assert body["gym"]["name"] == "Flex Fitness"
    assert body["role"] == "owner"
    assert body["gym"]["reminder_offsets"] == [7, 3, 1, 0, -3]
    assert "access_token" in res.cookies

    branches = await client.get("/api/branches")  # authenticated through the cookie
    assert [b["name"] for b in branches.json()] == ["Main branch"]


async def test_duplicate_signup_rejected(client: AsyncClient, owner: Account):
    res = await client.post(
        "/api/auth/signup",
        json={
            "name": "Xavi",
            "email": "owner@a.com",
            "password": "supersecret1",
            "gym_name": "Dup",
        },
    )
    assert res.status_code == 409


async def test_login_wrong_password(client: AsyncClient, owner: Account):
    res = await client.post(
        "/api/auth/login", json={"email": "owner@a.com", "password": "nope1234"}
    )
    assert res.status_code == 401
    res = await client.post(
        "/api/auth/login", json={"email": "ghost@a.com", "password": "nope1234"}
    )
    assert res.status_code == 401


async def test_login_me_refresh_logout(client: AsyncClient, owner: Account):
    res = await client.post(
        "/api/auth/login", json={"email": "OWNER@a.com", "password": "supersecret1"}
    )
    assert res.status_code == 200
    me = await client.get("/api/auth/me")
    assert me.status_code == 200
    assert me.json()["gym"]["id"] == owner.gym_id

    refreshed = await client.post("/api/auth/refresh")
    assert refreshed.status_code == 200
    assert refreshed.json()["access_token"]

    await client.post("/api/auth/logout")
    assert (await client.get("/api/auth/me")).status_code == 401


async def test_requires_auth(client: AsyncClient):
    assert (await client.get("/api/gym")).status_code == 401
    bad = {"Authorization": "Bearer not-a-token"}
    assert (await client.get("/api/gym", headers=bad)).status_code == 401


async def test_refresh_token_cannot_be_used_as_access(client: AsyncClient, owner: Account):
    res = await client.post(
        "/api/auth/login", json={"email": "owner@a.com", "password": "supersecret1"}
    )
    refresh = res.json()["refresh_token"]
    client.cookies.clear()
    res = await client.get("/api/gym", headers={"Authorization": f"Bearer {refresh}"})
    assert res.status_code == 401


async def test_failed_refresh_clears_cookies(client: AsyncClient, owner: Account):
    client.cookies.set("refresh_token", "garbage")
    res = await client.post("/api/auth/refresh")
    assert res.status_code == 401
    cleared = [c for c in res.headers.get_list("set-cookie") if c.startswith("refresh_token=")]
    assert cleared and "Max-Age=0" in cleared[0]


async def test_refresh_after_removal_from_gym(client: AsyncClient, owner: Account):
    other = await client.post(
        "/api/auth/signup",
        json={"name": "Two", "email": "two@a.com", "password": "supersecret1", "gym_name": "G2"},
    )
    refresh = other.json()["refresh_token"]
    client.cookies.clear()
    # Token for a gym the caller isn't staff of -> session ends instead of erroring.
    import jwt as pyjwt

    from app.core.config import settings

    payload = pyjwt.decode(refresh, settings.jwt_secret, algorithms=["HS256"])
    payload["gym"] = owner.gym_id
    forged_scope = pyjwt.encode(payload, settings.jwt_secret, algorithm="HS256")
    res = await client.post("/api/auth/refresh", json={"refresh_token": forged_scope})
    assert res.status_code == 401


async def test_login_is_rate_limited_per_account(client: AsyncClient, owner):
    bad = {"email": "owner@a.com", "password": "wrong-password"}
    for _ in range(10):
        assert (await client.post("/api/auth/login", json=bad)).status_code == 401
    res = await client.post("/api/auth/login", json=bad)
    assert res.status_code == 429 and "15 minutes" in res.json()["detail"]
    assert int(res.headers["retry-after"]) > 0
    # Even the right password waits; other accounts are unaffected.
    good = {"email": "OWNER@a.com", "password": "supersecret1"}
    assert (await client.post("/api/auth/login", json=good)).status_code == 429
    other = {"email": "nobody@a.com", "password": "x" * 10}
    assert (await client.post("/api/auth/login", json=other)).status_code == 401


def test_client_ip_only_trusts_our_proxies(monkeypatch):
    from starlette.requests import Request

    from app.core import ratelimit

    def req(xff):
        headers = [(b"x-forwarded-for", xff.encode())] if xff else []
        return Request({"type": "http", "headers": headers, "client": ("10.0.0.9", 1)})

    monkeypatch.setattr(ratelimit.settings, "trusted_proxy_hops", 1)
    # The client made up "1.1.1.1"; our proxy appended the real address.
    assert ratelimit.client_ip(req("1.1.1.1, 203.0.113.7")) == "203.0.113.7"
    monkeypatch.setattr(ratelimit.settings, "trusted_proxy_hops", 2)
    assert ratelimit.client_ip(req("1.1.1.1, 203.0.113.7, 10.1.1.1")) == "203.0.113.7"
    monkeypatch.setattr(ratelimit.settings, "trusted_proxy_hops", 0)
    assert ratelimit.client_ip(req("1.1.1.1")) == "10.0.0.9"
    assert ratelimit.client_ip(req(None)) == "10.0.0.9"
