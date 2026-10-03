import os

# Tests drive jobs explicitly; never start the background scheduler.
os.environ["SCHEDULER"] = "off"
os.environ["EMAIL_PROVIDER"] = "console"

from collections.abc import AsyncIterator
from dataclasses import dataclass

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.core.db import Base, get_db, get_sessionmaker
from app.main import app


@pytest.fixture(autouse=True)
def _reset_rate_limits():
    from app.core.ratelimit import RateLimiter

    RateLimiter.reset_all()


@pytest.fixture
async def sessions() -> AsyncIterator[async_sessionmaker]:
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with engine.begin() as conn:
        await conn.exec_driver_sql("PRAGMA foreign_keys=ON")
        await conn.run_sync(Base.metadata.create_all)
    yield async_sessionmaker(engine, expire_on_commit=False)
    await engine.dispose()


@pytest.fixture
async def client(sessions: async_sessionmaker) -> AsyncIterator[AsyncClient]:
    async def override_get_db():
        async with sessions() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_sessionmaker] = lambda: sessions
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()


@dataclass
class Account:
    token: str
    gym_id: str
    user_id: str

    @property
    def headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.token}"}


async def make_owner(client: AsyncClient, email: str, gym_name: str = "Iron Temple") -> Account:
    res = await client.post(
        "/api/auth/signup",
        json={"name": "Owner", "email": email, "password": "supersecret1", "gym_name": gym_name},
    )
    assert res.status_code == 201, res.text
    data = res.json()
    client.cookies.clear()
    return Account(token=data["access_token"], gym_id=data["gym"]["id"], user_id=data["user"]["id"])


@pytest.fixture
async def owner(client: AsyncClient) -> Account:
    return await make_owner(client, "owner@a.com", "Gym A")


@pytest.fixture
async def other_owner(client: AsyncClient) -> Account:
    return await make_owner(client, "owner@b.com", "Gym B")
