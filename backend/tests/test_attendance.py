"""Attendance: desk check-in, scanner punches, devices and the numbers built on them."""

import uuid
from datetime import UTC, date, datetime, timedelta

from httpx import AsyncClient

from app.modules.attendance.models import Attendance, AttendanceSource
from tests.conftest import Account
from tests.helpers import days, make_member, make_plan, make_staff, today
from tests.test_member_app import activate, link


async def check_in(client: AsyncClient, acct: Account, member_id: str):
    return await client.post("/api/attendance", json={"member_id": member_id}, headers=acct.headers)


async def make_device(client: AsyncClient, acct: Account, name="Front door") -> dict:
    res = await client.post("/api/devices", json={"name": name}, headers=acct.headers)
    assert res.status_code == 201, res.text
    return res.json()


def punch(user_id: str, at: str, ref: str) -> dict:
    return {"user_id": user_id, "at": at, "ref": ref}


async def send(client: AsyncClient, key: str, *punches: dict):
    return await client.post(
        "/api/attendance/punches", json={"punches": list(punches)}, headers={"X-Device-Key": key}
    )


# --- Front desk ---------------------------------------------------------------------------


async def test_check_in_is_idempotent_and_warns(client: AsyncClient, owner: Account):
    desk = await make_staff(client, owner, "front_desk")
    plan = await make_plan(client, owner, price=1000, tax_pct=0, joining_fee=0)
    fine = await make_member(
        client,
        owner,
        phone="9000000001",
        membership={"plan_id": plan["id"], "start_date": days(-2)},
    )
    expired = await make_member(
        client,
        owner,
        phone="9000000002",
        name="Expired Ed",
        membership={"plan_id": plan["id"], "start_date": days(-60)},
    )
    nobody = await make_member(client, owner, phone="9000000003", name="No Plan Nia")

    first = (await check_in(client, desk, fine["id"])).json()
    assert first["already"] is False and first["warning"] is None
    again = (await check_in(client, desk, fine["id"])).json()
    assert again["already"] is True and again["id"] == first["id"]

    assert "expired on" in (await check_in(client, desk, expired["id"])).json()["warning"]
    assert (await check_in(client, desk, nobody["id"])).json()["warning"] == "No membership on file"

    listing = (await client.get("/api/attendance", headers=desk.headers)).json()
    assert listing["total"] == 3 and listing["date"] == today().isoformat()
    assert {i["source"] for i in listing["items"]} == {"desk"}


async def test_undo_only_today(client: AsyncClient, owner: Account, sessions):
    member = await make_member(client, owner)
    visit = (await check_in(client, owner, member["id"])).json()
    assert (
        await client.delete(f"/api/attendance/{visit['id']}", headers=owner.headers)
    ).status_code == 204
    assert (await client.get("/api/attendance", headers=owner.headers)).json()["total"] == 0

    async with sessions() as db:
        old = Attendance(
            gym_id=uuid.UUID(owner.gym_id),
            member_id=uuid.UUID(member["id"]),
            checked_in_at=datetime.now(UTC) - timedelta(days=3),
            local_date=today() - timedelta(days=3),
            source=AttendanceSource.DESK,
        )
        db.add(old)
        await db.commit()
        old_id = str(old.id)
    res = await client.delete(f"/api/attendance/{old_id}", headers=owner.headers)
    assert res.status_code == 409


async def test_who_can_check_in(client: AsyncClient, owner: Account):
    trainer = await make_staff(client, owner, "trainer")
    sales = await make_staff(client, owner, "sales")
    manager = await make_staff(client, owner, "manager")
    member = await make_member(client, owner, trainer_id=trainer.user_id)
    for acct in (trainer, sales):
        assert (await check_in(client, acct, member["id"])).status_code == 403
        assert (await client.get("/api/attendance", headers=acct.headers)).status_code == 403
    assert (await check_in(client, manager, member["id"])).status_code == 200
    # Trainers can still see their own client's history, but not someone else's.
    hist = await client.get(f"/api/members/{member['id']}/attendance", headers=trainer.headers)
    assert hist.status_code == 200 and hist.json()["visits_30d"] == 1
    stranger = await make_member(client, owner, phone="9000000009")
    res = await client.get(f"/api/members/{stranger['id']}/attendance", headers=trainer.headers)
    assert res.status_code == 404


async def test_branch_bound_desk_only_checks_in_their_branch(client: AsyncClient, owner: Account):
    a = (
        await client.post("/api/branches", json={"name": "Branch A"}, headers=owner.headers)
    ).json()
    b = (
        await client.post("/api/branches", json={"name": "Branch B"}, headers=owner.headers)
    ).json()
    desk = await make_staff(client, owner, "front_desk", branch_id=a["id"])
    mine = await make_member(client, owner, phone="9000000001", branch_id=a["id"])
    theirs = await make_member(client, owner, phone="9000000002", branch_id=b["id"])
    assert (await check_in(client, desk, mine["id"])).status_code == 200
    assert (await check_in(client, desk, theirs["id"])).status_code == 404


async def test_history_and_streak(client: AsyncClient, owner: Account, sessions):
    member = await make_member(client, owner)
    async with sessions() as db:
        for ago in (0, 8, 15, 40):  # this week, last week, the week before, then a gap
            d = today() - timedelta(days=ago)
            db.add(
                Attendance(
                    gym_id=uuid.UUID(owner.gym_id),
                    member_id=uuid.UUID(member["id"]),
                    checked_in_at=datetime.now(UTC) - timedelta(days=ago),
                    local_date=d,
                    source=AttendanceSource.DESK,
                )
            )
        await db.commit()
    hist = (
        await client.get(f"/api/members/{member['id']}/attendance", headers=owner.headers)
    ).json()
    assert len(hist["dates"]) == 4 and hist["visits_30d"] == 3
    assert hist["last_visit"] == today().isoformat()
    assert hist["streak_weeks"] == 3
    assert hist["dates"] == sorted(hist["dates"], reverse=True)


# --- Devices and punches ------------------------------------------------------------------


async def test_device_lifecycle_and_key_shown_once(client: AsyncClient, owner: Account):
    desk = await make_staff(client, owner, "front_desk")
    assert (
        await client.post("/api/devices", json={"name": "X1"}, headers=desk.headers)
    ).status_code == 403
    device = await make_device(client, owner)
    assert device["api_key"].startswith("dev_") and device["last_seen_at"] is None

    listing = (await client.get("/api/devices", headers=owner.headers)).json()
    assert [d["name"] for d in listing] == ["Front door"]
    assert "api_key" not in listing[0] and device["api_key"] not in str(listing)

    member = await make_member(client, owner, device_user_id="42")
    ok = await send(client, device["api_key"], punch("42", datetime.now(UTC).isoformat(), "p1"))
    assert ok.status_code == 200
    assert (await client.get("/api/devices", headers=owner.headers)).json()[0]["last_seen_at"]

    # Rotating invalidates the old key at once.
    rotated = (
        await client.post(f"/api/devices/{device['id']}/rotate-key", headers=owner.headers)
    ).json()
    assert rotated["api_key"] != device["api_key"]
    stamp = datetime.now(UTC).isoformat()
    assert (await send(client, device["api_key"], punch("42", stamp, "p2"))).status_code == 401
    assert (await send(client, rotated["api_key"], punch("42", stamp, "p2"))).status_code == 200

    # Turning it off stops it too; deleting keeps the visits.
    await client.patch(
        f"/api/devices/{device['id']}", json={"is_active": False}, headers=owner.headers
    )
    assert (await send(client, rotated["api_key"], punch("42", stamp, "p3"))).status_code == 401
    assert (
        await client.delete(f"/api/devices/{device['id']}", headers=owner.headers)
    ).status_code == 204
    assert (
        await client.get(f"/api/members/{member['id']}/attendance", headers=owner.headers)
    ).json()["visits_30d"] == 1


async def test_punches_idempotent_and_unknown_ids(client: AsyncClient, owner: Account):
    device = await make_device(client, owner)
    key = device["api_key"]
    asha = await make_member(client, owner, phone="9000000001", device_user_id="7")
    await make_member(client, owner, phone="9000000002", device_user_id="8")
    now = datetime.now(UTC)

    res = await send(
        client,
        key,
        punch("7", now.isoformat(), "a1"),
        punch("7", (now + timedelta(minutes=5)).isoformat(), "a2"),  # same day: duplicate
        punch("8", now.isoformat(), "b1"),
        punch("99", now.isoformat(), "z1"),
        punch("99", now.isoformat(), "z2"),
    )
    assert res.json() == {"created": 2, "duplicates": 1, "unknown_user_ids": ["99"]}

    # Re-sending the whole batch changes nothing.
    again = await send(
        client, key, punch("7", now.isoformat(), "a1"), punch("8", now.isoformat(), "b1")
    )
    assert again.json() == {"created": 0, "duplicates": 2, "unknown_user_ids": []}
    listing = (await client.get("/api/attendance", headers=owner.headers)).json()
    assert listing["total"] == 2 and {i["source"] for i in listing["items"]} == {"device"}
    assert asha["id"] in {i["member_id"] for i in listing["items"]}


async def test_punch_day_follows_the_gym_time_zone(client: AsyncClient, owner: Account):
    device = await make_device(client, owner)
    member = await make_member(client, owner, device_user_id="5")
    # 19:00 UTC on the 12th is 00:30 on the 13th in Kolkata (the default zone).
    res = await send(client, device["api_key"], punch("5", "2026-10-12T19:00:00+00:00", "x1"))
    assert res.json()["created"] == 1
    day = (await client.get("/api/attendance?date=2026-10-13", headers=owner.headers)).json()
    assert [i["member_id"] for i in day["items"]] == [member["id"]]
    assert (await client.get("/api/attendance?date=2026-10-12", headers=owner.headers)).json()[
        "total"
    ] == 0


async def test_punch_validation(client: AsyncClient, owner: Account):
    device = await make_device(client, owner)
    key = device["api_key"]
    stamp = datetime.now(UTC).isoformat()
    # No key, wrong key, a staff token: all refused.
    assert (
        await client.post("/api/attendance/punches", json={"punches": [punch("1", stamp, "r")]})
    ).status_code == 401
    assert (await send(client, "dev_nope", punch("1", stamp, "r"))).status_code == 401
    res = await client.post(
        "/api/attendance/punches", json={"punches": [punch("1", stamp, "r")]}, headers=owner.headers
    )
    assert res.status_code == 401
    # A device key doesn't open staff routes.
    assert (await client.get("/api/members", headers={"X-Device-Key": key})).status_code == 401
    # Times need a UTC offset; batches are capped and non-empty.
    assert (await send(client, key, punch("1", "2026-10-12T19:00:00", "r"))).status_code == 422
    assert (
        await client.post(
            "/api/attendance/punches", json={"punches": []}, headers={"X-Device-Key": key}
        )
    ).status_code == 422
    many = [punch("1", stamp, f"r{i}") for i in range(501)]
    assert (await send(client, key, *many)).status_code == 422


async def test_devices_are_per_gym(client: AsyncClient, owner: Account, other_owner: Account):
    mine = await make_device(client, owner)
    await make_member(client, owner, phone="9000000001", device_user_id="7")
    theirs = await make_member(client, other_owner, phone="9000000001", device_user_id="7")
    stamp = datetime.now(UTC).isoformat()
    # Gym A's scanner only ever matches gym A's members, even with the same device number.
    assert (await send(client, mine["api_key"], punch("7", stamp, "r1"))).json()["created"] == 1
    assert (await client.get("/api/attendance", headers=other_owner.headers)).json()["total"] == 0
    assert theirs["id"]
    # Nor can gym B manage or see gym A's device.
    assert (await client.get("/api/devices", headers=other_owner.headers)).json() == []
    for call in (
        client.post(f"/api/devices/{mine['id']}/rotate-key", headers=other_owner.headers),
        client.patch(
            f"/api/devices/{mine['id']}", json={"name": "Mine now"}, headers=other_owner.headers
        ),
        client.delete(f"/api/devices/{mine['id']}", headers=other_owner.headers),
    ):
        assert (await call).status_code == 404


async def test_device_number_is_unique_per_gym(
    client: AsyncClient, owner: Account, other_owner: Account
):
    a = await make_member(client, owner, phone="9000000001", device_user_id="12")
    res = await client.post(
        "/api/members",
        json={"name": "Second Person", "phone": "9000000002", "device_user_id": "12"},
        headers=owner.headers,
    )
    assert res.status_code == 409 and "12" in res.json()["detail"]
    b = await make_member(client, owner, phone="9000000003")
    res = await client.patch(
        f"/api/members/{b['id']}", json={"device_user_id": "12"}, headers=owner.headers
    )
    assert res.status_code == 409
    # Blank clears it; another gym may reuse the number.
    res = await client.patch(
        f"/api/members/{a['id']}", json={"device_user_id": " "}, headers=owner.headers
    )
    assert res.json()["device_user_id"] is None
    await make_member(client, other_owner, phone="9000000001", device_user_id="12")
    assert (
        await client.patch(
            f"/api/members/{b['id']}", json={"device_user_id": "12"}, headers=owner.headers
        )
    ).status_code == 200


# --- What the numbers feed ----------------------------------------------------------------


async def test_dashboards_use_attendance(client: AsyncClient, owner: Account, sessions):
    coach = await make_staff(client, owner, "trainer")
    desk = await make_staff(client, owner, "front_desk")
    plan = await make_plan(client, owner, price=1000, tax_pct=0, joining_fee=0)
    ms = {"plan_id": plan["id"], "start_date": days(-20)}
    regular = await make_member(
        client, owner, phone="9000000001", name="Regular", membership=ms, trainer_id=coach.user_id
    )
    quiet = await make_member(
        client, owner, phone="9000000002", name="Quiet", membership=ms, trainer_id=coach.user_id
    )

    # Nobody records visits yet: the boards say so instead of calling everyone "at risk".
    board = (await client.get("/api/dashboard/trainer", headers=coach.headers)).json()
    assert board["attendance_tracked"] is False and board["at_risk"] == 0
    assert (await client.get("/api/analytics", headers=owner.headers)).json()[
        "absent_14_days"
    ] is None

    assert (await check_in(client, desk, regular["id"])).status_code == 200
    async with sessions() as db:  # Quiet last came 20 days ago
        db.add(
            Attendance(
                gym_id=uuid.UUID(owner.gym_id),
                member_id=uuid.UUID(quiet["id"]),
                checked_in_at=datetime.now(UTC) - timedelta(days=20),
                local_date=today() - timedelta(days=20),
                source=AttendanceSource.DESK,
            )
        )
        await db.commit()

    board = (await client.get("/api/dashboard/trainer", headers=coach.headers)).json()
    assert board["attendance_tracked"] is True and board["visits_7d"] == 1
    assert board["at_risk"] == 1 and [m["name"] for m in board["at_risk_list"]] == ["Quiet"]
    assert board["at_risk_list"][0]["days"] == 20
    assert (await client.get("/api/dashboard/desk", headers=desk.headers)).json()[
        "checkins_today"
    ] == 1
    assert (await client.get("/api/analytics", headers=owner.headers)).json()["absent_14_days"] == 1
    staff = (await client.get("/api/analytics/staff", headers=owner.headers)).json()
    (row,) = [t for t in staff["trainers"] if t["user_id"] == coach.user_id]
    assert row["visits_per_client_week"] is not None and row["visits_per_client_week"] > 0


async def test_member_sees_their_own_visits(client: AsyncClient, owner: Account):
    member = await make_member(client, owner)
    await check_in(client, owner, member["id"])
    await activate(client, await link(client, owner, member["id"]))
    hist = (await client.get("/api/m/attendance")).json()
    assert hist["dates"] == [today().isoformat()] and hist["streak_weeks"] == 1
    # There is no member-side check-in: they can't mark themselves present.
    assert (await client.post("/api/m/attendance")).status_code in (404, 405)
    assert date.fromisoformat(hist["last_visit"]) == today()
