"""Member app: activation links, phone + PIN login, lockout, token isolation, own-data views."""

import uuid
from datetime import timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import select, update

from app.core.db import utcnow
from app.modules.ai_plans.models import AIPlan, PlanStatus
from app.modules.member_app.models import MemberAccount
from tests.conftest import Account, make_owner
from tests.helpers import days, make_member, make_plan, make_staff
from tests.test_ai_plans import sample_plan
from tests.test_checkups import PNG, local_storage  # noqa: F401  (autouse fixture)

PIN = "4829"


def token_of(url: str) -> str:
    return url.rsplit("/", 1)[-1]


async def link(client: AsyncClient, acct: Account, member_id: str) -> str:
    res = await client.post(f"/api/members/{member_id}/app-access/link", headers=acct.headers)
    assert res.status_code == 200, res.text
    return token_of(res.json()["url"])


async def activate(client: AsyncClient, token: str, pin: str = PIN):
    return await client.post("/api/m/activate", json={"token": token, "pin": pin})


async def login(client: AsyncClient, phone: str, pin: str = PIN, **extra):
    return await client.post("/api/m/auth/login", json={"phone": phone, "pin": pin, **extra})


async def activated_member(client: AsyncClient, owner: Account, **overrides) -> dict:
    """A member with a plan and an activated app account; the client keeps their cookies."""
    plan = await make_plan(client, owner, price=1000, tax_pct=0, joining_fee=0)
    member = await make_member(
        client,
        owner,
        name="Asha Rao",
        membership={"plan_id": plan["id"], "start_date": days(-5)},
        **overrides,
    )
    res = await activate(client, await link(client, owner, member["id"]))
    assert res.status_code == 200, res.text
    return member


# --- Activation ---------------------------------------------------------------------------


async def test_activation_link_flow(client: AsyncClient, owner: Account):
    member = await make_member(client, owner, name="Asha Rao")
    assert (
        await client.get(f"/api/members/{member['id']}/app-access", headers=owner.headers)
    ).json() == {
        "status": "none",
        "activated_at": None,
        "last_login_at": None,
        "link_expires_at": None,
        "locked": False,
    }
    token = await link(client, owner, member["id"])
    status = (
        await client.get(f"/api/members/{member['id']}/app-access", headers=owner.headers)
    ).json()
    assert status["status"] == "invited" and status["link_expires_at"]

    preview = await client.get(f"/api/m/activate/{token}")
    assert preview.status_code == 200 and preview.json()["first_name"] == "Asha"
    assert preview.headers["cache-control"] == "no-store"

    for weak in ("1234", "0000", "4321", "1212", "12", "12345678", "abcd"):
        assert (await activate(client, token, weak)).status_code == 422, weak

    res = await activate(client, token)
    assert res.status_code == 200 and res.json()["gym_name"] == "Gym A"
    assert "m_access" in res.cookies and "m_refresh" in res.cookies
    # The PIN is never returned or stored in clear.
    assert PIN not in res.text

    # A link works once.
    assert (await activate(client, token, "7391")).status_code == 404
    assert (await client.get(f"/api/m/activate/{token}")).status_code == 404
    status = (
        await client.get(f"/api/members/{member['id']}/app-access", headers=owner.headers)
    ).json()
    assert status["status"] == "active" and status["activated_at"]


async def test_expired_link(client: AsyncClient, owner: Account, sessions):
    member = await make_member(client, owner)
    token = await link(client, owner, member["id"])
    async with sessions() as db:
        await db.execute(
            update(MemberAccount).values(activation_expires_at=utcnow() - timedelta(minutes=1))
        )
        await db.commit()
    assert (await client.get(f"/api/m/activate/{token}")).status_code == 404
    assert (await activate(client, token)).status_code == 404
    status = (
        await client.get(f"/api/members/{member['id']}/app-access", headers=owner.headers)
    ).json()
    assert status["status"] == "none"  # nothing live; send a new link


async def test_garbage_links(client: AsyncClient):
    assert (await client.get("/api/m/activate/" + "x" * 43)).status_code == 404
    assert (await activate(client, "x" * 43)).status_code == 404


# --- Login and lockout --------------------------------------------------------------------


async def test_login_with_any_phone_spelling(client: AsyncClient, owner: Account):
    member = await activated_member(client, owner, phone="+919876543210")
    client.cookies.clear()
    for phone in ("+919876543210", "9876543210", "98765 43210", "919876543210"):
        res = await login(client, phone)
        assert res.status_code == 200, phone
        client.cookies.clear()
    assert (await login(client, "9000000000")).status_code == 401  # unknown number
    assert (await login(client, member["phone"], "7391")).status_code == 401  # wrong PIN


async def test_lockout_and_new_link_unlocks(client: AsyncClient, owner: Account):
    member = await activated_member(client, owner, phone="9876543210")
    client.cookies.clear()
    for _ in range(5):
        assert (await login(client, "9876543210", "7391")).status_code == 401
    # Even the right PIN is refused during the pause.
    res = await login(client, "9876543210")
    assert res.status_code == 429 and "15 minutes" in res.json()["detail"]
    status = (
        await client.get(f"/api/members/{member['id']}/app-access", headers=owner.headers)
    ).json()
    assert status["locked"] is True

    # Staff can fix it by sending a new link.
    res = await activate(client, await link(client, owner, member["id"]), "7391")
    assert res.status_code == 200
    client.cookies.clear()
    assert (await login(client, "9876543210", "7391")).status_code == 200


async def test_ten_wrong_pins_need_a_new_link(client: AsyncClient, owner: Account, sessions):
    await activated_member(client, owner, phone="9876543210")
    client.cookies.clear()
    async with sessions() as db:  # skip the pause between the 5th and 6th attempt
        await db.execute(update(MemberAccount).values(failed_attempts=9))
        await db.commit()
    assert (await login(client, "9876543210", "7391")).status_code == 401
    res = await login(client, "9876543210")
    assert res.status_code == 429 and "new link" in res.json()["detail"]


async def test_same_phone_in_two_gyms(client: AsyncClient, owner: Account, other_owner: Account):
    for acct in (owner, other_owner):
        member = await make_member(client, acct, phone="9876543210")
        assert (await activate(client, await link(client, acct, member["id"]))).status_code == 200
    client.cookies.clear()
    res = await login(client, "9876543210")
    assert res.status_code == 409
    assert sorted(g["name"] for g in res.json()["gyms"]) == ["Gym A", "Gym B"]
    res = await login(client, "9876543210", gym_id=owner.gym_id)
    assert res.status_code == 200 and res.json()["gym_name"] == "Gym A"


async def test_refresh_and_logout(client: AsyncClient, owner: Account):
    await activated_member(client, owner)
    assert (await client.get("/api/m/me")).status_code == 200
    assert (await client.post("/api/m/auth/refresh")).status_code == 200
    await client.post("/api/m/auth/logout")
    assert (await client.get("/api/m/me")).status_code == 401
    res = await client.post("/api/m/auth/refresh")
    assert res.status_code == 401


# --- Token isolation ----------------------------------------------------------------------


async def test_member_and_staff_tokens_do_not_mix(client: AsyncClient, owner: Account):
    await activated_member(client, owner)
    member_access = client.cookies["m_access"]

    # A member can't reach staff routes, with the cookie or as a bearer token.
    assert (await client.get("/api/members")).status_code == 401
    bearer = {"Authorization": f"Bearer {member_access}"}
    assert (await client.get("/api/members", headers=bearer)).status_code == 401
    assert (await client.get("/api/auth/me", headers=bearer)).status_code == 401

    # And a staff token is no good for the member app.
    client.cookies.clear()
    assert (await client.get("/api/m/me", headers=owner.headers)).status_code == 401
    assert (await client.get("/api/m/plan", headers=owner.headers)).status_code == 401


async def test_new_link_and_disable_sign_the_member_out(client: AsyncClient, owner: Account):
    member = await activated_member(client, owner)
    assert (await client.get("/api/m/me")).status_code == 200
    old_cookies = dict(client.cookies)

    # A new link resets the PIN: the old session dies at once.
    token = await link(client, owner, member["id"])
    assert (await client.get("/api/m/me")).status_code == 401
    assert (await client.post("/api/m/auth/refresh")).status_code == 401
    assert (await login(client, member["phone"])).status_code == 401  # old PIN is gone

    assert (await activate(client, token, "7391")).status_code == 200
    assert (await client.get("/api/m/me")).status_code == 200

    res = await client.delete(f"/api/members/{member['id']}/app-access", headers=owner.headers)
    assert res.status_code == 204
    assert (await client.get("/api/m/me")).status_code == 401
    assert (await login(client, member["phone"], "7391")).status_code == 401
    status = (
        await client.get(f"/api/members/{member['id']}/app-access", headers=owner.headers)
    ).json()
    assert status["status"] == "disabled"
    assert old_cookies  # (kept only to show the old session existed)

    # Sending a link again re-enables access.
    assert (await activate(client, await link(client, owner, member["id"]))).status_code == 200


# --- Own data -----------------------------------------------------------------------------


async def test_member_sees_their_own_data(client: AsyncClient, owner: Account, sessions):
    coach = await make_staff(client, owner, "trainer")
    res = await client.patch("/api/auth/me", json={"phone": "+919800011122"}, headers=coach.headers)
    assert res.status_code == 200, res.text
    member = await activated_member(client, owner, trainer_id=coach.user_id)

    for weight, on in ((82, days(-20)), (80.5, days(-2))):
        res = await client.post(
            f"/api/members/{member['id']}/checkups",
            json={"weight_kg": weight, "recorded_on": on},
            headers=owner.headers,
        )
        assert res.status_code == 201, res.text
    async with sessions() as db:
        db.add(
            AIPlan(
                gym_id=uuid.UUID(owner.gym_id),
                member_id=uuid.UUID(member["id"]),
                version=1,
                status=PlanStatus.PUBLISHED,
                title="Plan",
                content=sample_plan().model_dump(),
                published_at=utcnow(),
            )
        )
        await db.commit()

    me = (await client.get("/api/m/me")).json()
    assert me["first_name"] == "Asha" and me["gym"]["name"] == "Gym A"
    assert me["trainer_name"] == "Trainer" and me["trainer_phone"] == "+919800011122"
    assert me["membership"]["status"] == "active" and me["has_plan"] is True
    assert me["progress"]["weight_change_kg"] == -1.5
    assert me["next_checkup_on"] > days(0)  # checked up two days ago, so not due yet
    # Nothing internal leaks (ids, other members, money).
    for secret in (member["id"], owner.gym_id, "price", "balance"):
        assert secret not in str(me)

    plan = (await client.get("/api/m/plan")).json()
    assert plan["plan"]["summary"] == "A simple full-body start."
    history = (await client.get("/api/m/checkups")).json()
    assert [c["weight_kg"] for c in history] == [80.5, 82]  # newest first


async def test_member_with_nothing_yet(client: AsyncClient, owner: Account):
    member = await make_member(client, owner)
    await activate(client, await link(client, owner, member["id"]))
    me = (await client.get("/api/m/me")).json()
    assert me["membership"] is None and me["progress"] is None and me["has_plan"] is False
    assert me["trainer_name"] is None and me["next_checkup_on"] == days(0)
    assert (await client.get("/api/m/plan")).json() == {"plan": None, "updated_at": None}
    assert (await client.get("/api/m/checkups")).json() == []


async def test_photo_ownership(client: AsyncClient, owner: Account):
    mine = await make_member(client, owner, phone="9000000001")
    theirs = await make_member(client, owner, phone="9000000002")
    photos = {}
    for key, member in (("mine", mine), ("theirs", theirs)):
        c = (
            await client.post(
                f"/api/members/{member['id']}/checkups",
                json={"weight_kg": 70},
                headers=owner.headers,
            )
        ).json()
        res = await client.post(
            f"/api/checkups/{c['id']}/photos",
            files={"file": ("p.png", PNG, "image/png")},
            headers=owner.headers,
        )
        photos[key] = res.json()["photos"][0]["id"]

    await activate(client, await link(client, owner, mine["id"]))
    own = await client.get(f"/api/m/checkup-photos/{photos['mine']}")
    assert own.status_code == 200 and own.content == PNG
    assert (await client.get(f"/api/m/checkup-photos/{photos['theirs']}")).status_code == 404
    listing = (await client.get("/api/m/checkups")).json()
    assert listing[0]["photos"] == [f"/api/m/checkup-photos/{photos['mine']}"]


async def test_other_gyms_members_cannot_see_each_other(
    client: AsyncClient, owner: Account, other_owner: Account
):
    a = await make_member(client, owner, phone="9000000001", name="Gym A Member")
    await activate(client, await link(client, owner, a["id"]))
    assert (await client.get("/api/m/me")).json()["member_name"] == "Gym A Member"
    # Staff of another gym can't touch the member's app access.
    for call in (
        client.get(f"/api/members/{a['id']}/app-access", headers=other_owner.headers),
        client.post(f"/api/members/{a['id']}/app-access/link", headers=other_owner.headers),
        client.delete(f"/api/members/{a['id']}/app-access", headers=other_owner.headers),
    ):
        assert (await call).status_code == 404


# --- Who on staff can issue links ---------------------------------------------------------


async def test_who_can_send_links(client: AsyncClient, owner: Account):
    coach = await make_staff(client, owner, "trainer")
    other_coach = await make_staff(client, owner, "trainer")
    desk = await make_staff(client, owner, "front_desk")
    sales = await make_staff(client, owner, "sales")
    mine = await make_member(client, owner, phone="9000000001", trainer_id=coach.user_id)
    theirs = await make_member(client, owner, phone="9000000002", trainer_id=other_coach.user_id)

    url = "/api/members/{}/app-access/link"
    assert (await client.post(url.format(mine["id"]), headers=coach.headers)).status_code == 200
    # A trainer can't touch someone else's client; looks like a missing member.
    assert (await client.post(url.format(theirs["id"]), headers=coach.headers)).status_code == 404
    assert (await client.post(url.format(theirs["id"]), headers=desk.headers)).status_code == 200
    assert (await client.post(url.format(mine["id"]), headers=sales.headers)).status_code == 403

    audit = (await client.get("/api/audit", headers=owner.headers)).json()
    assert sum(1 for e in audit["items"] if e["action"] == "member.app_link") == 2


async def test_pin_hash_is_never_exposed(client: AsyncClient, owner: Account, sessions):
    member = await activated_member(client, owner)
    full = (await client.get(f"/api/members/{member['id']}", headers=owner.headers)).text
    async with sessions() as db:
        (account,) = (await db.scalars(select(MemberAccount))).all()
    assert account.pin_hash and account.pin_hash not in full
    assert "pin" not in full.lower().replace("pinned", "")


@pytest.mark.parametrize("make", [make_owner])
async def test_staff_login_unaffected(client: AsyncClient, make):
    # Smoke check that the staff login still sets staff cookies only.
    await make(client, "x@y.com")
    res = await client.post(
        "/api/auth/login", json={"email": "x@y.com", "password": "supersecret1"}
    )
    assert res.status_code == 200
    assert "access_token" in res.cookies and "m_access" not in res.cookies
