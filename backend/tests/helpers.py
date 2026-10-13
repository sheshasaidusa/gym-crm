import uuid
from datetime import date, timedelta

from httpx import AsyncClient

from app.core.dates import today_in
from tests.conftest import Account


def today() -> date:
    # New gyms default to Asia/Kolkata.
    return today_in("Asia/Kolkata")


def days(n: int) -> str:
    return (today() + timedelta(days=n)).isoformat()


async def make_plan(client: AsyncClient, acct: Account, **overrides) -> dict:
    body = {
        "name": "Monthly",
        "duration_value": 1,
        "duration_unit": "month",
        "price": 3000,
        "joining_fee": 500,
        "tax_pct": 18,
        "max_freeze_days": 15,
        "services": ["Gym", "Cardio"],
        **overrides,
    }
    res = await client.post("/api/plans", json=body, headers=acct.headers)
    assert res.status_code == 201, res.text
    return res.json()


async def make_member(client: AsyncClient, acct: Account, phone="9876543210", **overrides) -> dict:
    body = {"name": "Ravi Kumar", "phone": phone, **overrides}
    res = await client.post("/api/members", json=body, headers=acct.headers)
    assert res.status_code == 201, res.text
    return res.json()


async def make_staff(
    client: AsyncClient,
    inviter: Account,
    role: str,
    email: str | None = None,
    branch_id: str | None = None,
) -> Account:
    """Invites someone into inviter's gym and accepts on their behalf. Password: staffpass1."""
    email = email or f"{role}-{uuid.uuid4().hex[:6]}@a.com"
    body = {"email": email, "role": role, **({"branch_id": branch_id} if branch_id else {})}
    inv = await client.post("/api/invites", json=body, headers=inviter.headers)
    assert inv.status_code == 201, inv.text
    token = inv.json()["url"].rsplit("/", 1)[-1]
    accepted = await client.post(
        f"/api/auth/invites/{token}/accept", json={"name": role.title(), "password": "staffpass1"}
    )
    assert accepted.status_code == 200, accepted.text
    client.cookies.clear()
    data = accepted.json()
    acct = Account(token=data["access_token"], gym_id=data["gym"]["id"], user_id=data["user"]["id"])
    acct.email = email  # type: ignore[attr-defined]
    return acct
