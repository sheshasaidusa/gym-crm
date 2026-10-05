import uuid

from httpx import AsyncClient
from sqlalchemy import update
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.modules.gyms.models import Gym
from tests.conftest import Account, make_owner
from tests.test_gym_and_staff import invite_and_accept

PROFILE = "/api/gym/profile"
COMPLETE = "/api/gym/onboarding/complete"


async def audit_actions(client: AsyncClient, acct: Account) -> list[str]:
    res = await client.get("/api/audit", headers=acct.headers)
    assert res.status_code == 200, res.text
    return [e["action"] for e in res.json()["items"]]


async def test_new_gym_starts_not_onboarded(client: AsyncClient):
    res = await client.post(
        "/api/auth/signup",
        json={
            "name": "Owen",
            "email": "new@a.com",
            "password": "supersecret1",
            "gym_name": "New Gym",
        },
    )
    gym = res.json()["gym"]
    assert gym["profile"] is None
    assert gym["onboarding_completed_at"] is None
    me = (await client.get("/api/auth/me")).json()
    assert me["gym"]["onboarding_completed_at"] is None


async def test_profile_patches_merge(client: AsyncClient, owner: Account):
    h = owner.headers
    first = await client.patch(
        PROFILE, json={"city": "  Pune  ", "size": "large", "floors": 2, "last_step": 3}, headers=h
    )
    assert first.status_code == 200, first.text
    assert first.json()["profile"]["city"] == "Pune"

    # A later step must not erase earlier answers.
    second = await client.patch(
        PROFILE,
        json={"zones": ["studio", "cardio", "studio"], "hours": "24_7", "facilities": ["parking"]},
        headers=h,
    )
    profile = second.json()["profile"]
    assert profile["size"] == "large" and profile["floors"] == 2 and profile["last_step"] == 3
    assert profile["zones"] == ["cardio", "studio"]  # deduplicated, canonical order
    assert profile["hours"] == "24_7"

    # Lists are replaced as a whole, and an explicit null clears a field.
    third = await client.patch(PROFILE, json={"zones": ["weights"], "city": None}, headers=h)
    profile = third.json()["profile"]
    assert profile["zones"] == ["weights"]
    assert profile["city"] is None
    assert profile["size"] == "large"

    stored = (await client.get("/api/gym", headers=h)).json()["profile"]
    assert stored == profile
    assert (await client.get("/api/auth/me", headers=h)).json()["gym"]["profile"] == profile


async def test_trainers_are_normalised(client: AsyncClient, owner: Account):
    res = await client.patch(
        PROFILE,
        json={"trainers": [{"name": " Aarav ", "email": "Aarav@Gym.com", "speciality": "weights"}]},
        headers=owner.headers,
    )
    assert res.status_code == 200, res.text
    assert res.json()["profile"]["trainers"] == [
        {"name": "Aarav", "email": "aarav@gym.com", "role": "trainer", "speciality": "weights"}
    ]
    desk = await client.patch(
        PROFILE,
        json={"trainers": [{"name": "Riya", "email": "riya@gym.com", "role": "front_desk"}]},
        headers=owner.headers,
    )
    assert desk.json()["profile"]["trainers"][0]["role"] == "front_desk"
    owner_role = await client.patch(
        PROFILE,
        json={"trainers": [{"name": "Sam", "email": "sam@gym.com", "role": "owner"}]},
        headers=owner.headers,
    )
    assert owner_role.status_code == 422


async def test_profile_validation(client: AsyncClient, owner: Account):
    h = owner.headers
    bad = [
        {"floors": 4},
        {"floors": 0},
        {"size": "huge"},
        {"zones": ["sauna"]},
        {"hours": "always"},
        {"staff_count": 100},
        {"last_step": 6},
        {"trainers": [{"name": "A", "email": "not-an-email"}]},
        {"trainers": [{"name": "A" * 41, "email": "a@b.com"}]},
        {"trainers": [{"name": "A", "email": f"t{i}@b.com"} for i in range(13)]},
    ]
    for body in bad:
        res = await client.patch(PROFILE, json=body, headers=h)
        assert res.status_code == 422, body
    # Nothing was saved by the rejected requests.
    assert (await client.get("/api/gym", headers=h)).json()["profile"] is None


async def test_only_the_owner_can_change_onboarding(client: AsyncClient, owner: Account):
    manager = await invite_and_accept(client, owner, "mgr@a.com", "manager")
    trainer = await invite_and_accept(client, owner, "coach@a.com", "trainer")
    for staff in (manager, trainer):
        assert (
            await client.patch(PROFILE, json={"city": "X"}, headers=staff.headers)
        ).status_code == 403
        assert (await client.post(COMPLETE, headers=staff.headers)).status_code == 403
    assert (await client.patch(PROFILE, json={"city": "X"})).status_code == 401
    assert (await client.get("/api/gym", headers=owner.headers)).json()["profile"] is None


async def test_gyms_are_isolated(client: AsyncClient, owner: Account, other_owner: Account):
    await client.patch(PROFILE, json={"city": "Pune"}, headers=owner.headers)
    await client.post(COMPLETE, headers=owner.headers)
    other = (await client.get("/api/gym", headers=other_owner.headers)).json()
    assert other["profile"] is None
    assert other["onboarding_completed_at"] is None


async def test_complete_is_idempotent_and_audited_once(client: AsyncClient, owner: Account):
    h = owner.headers
    # Saving steps does not touch the audit trail.
    for step in (2, 3, 4):
        await client.patch(PROFILE, json={"last_step": step}, headers=h)
    assert "gym.onboarded" not in await audit_actions(client, owner)

    first = await client.post(COMPLETE, headers=h)
    assert first.status_code == 200, first.text
    stamp = first.json()["onboarding_completed_at"]
    assert stamp is not None

    second = await client.post(COMPLETE, headers=h)
    assert second.json()["onboarding_completed_at"] == stamp
    assert (await audit_actions(client, owner)).count("gym.onboarded") == 1


async def test_timestamp_cannot_be_set_through_settings(client: AsyncClient, owner: Account):
    res = await client.patch(
        "/api/gym", json={"onboarding_completed_at": "2020-01-01T00:00:00Z"}, headers=owner.headers
    )
    assert res.status_code == 200
    assert res.json()["onboarding_completed_at"] is None


async def test_corrupt_profile_does_not_break_login(
    client: AsyncClient, sessions: async_sessionmaker, owner: Account
):
    async with sessions() as db:
        await db.execute(
            update(Gym)
            .where(Gym.id == uuid.UUID(owner.gym_id))
            .values(profile={"size": "gigantic", "floors": 99})
        )
        await db.commit()
    me = await client.get("/api/auth/me", headers=owner.headers)
    assert me.status_code == 200
    assert me.json()["gym"]["profile"] is None
    login = await client.post(
        "/api/auth/login", json={"email": "owner@a.com", "password": "supersecret1"}
    )
    assert login.status_code == 200


async def test_signup_twice_with_same_email_is_rejected(client: AsyncClient):
    await make_owner(client, "dup@a.com")
    res = await client.post(
        "/api/auth/signup",
        json={
            "name": "Owen",
            "email": "dup@a.com",
            "password": "supersecret1",
            "gym_name": "Again",
        },
    )
    assert res.status_code == 409
