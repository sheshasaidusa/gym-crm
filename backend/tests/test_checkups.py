import pytest
from httpx import AsyncClient

from tests.conftest import Account
from tests.helpers import days, make_member, make_plan, today
from tests.test_gym_and_staff import invite_and_accept

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 64


@pytest.fixture(autouse=True)
def local_storage(tmp_path, monkeypatch):
    from app.core import storage

    monkeypatch.setattr(storage, "_storage", storage.LocalStorage(str(tmp_path)))
    return tmp_path


async def log_checkup(client: AsyncClient, acct: Account, member_id: str, **body) -> dict:
    res = await client.post(f"/api/members/{member_id}/checkups", json=body, headers=acct.headers)
    assert res.status_code == 201, res.text
    return res.json()


async def test_record_checkup_with_bmi(client: AsyncClient, owner: Account):
    member = await make_member(client, owner, height_cm=170)
    c = await log_checkup(
        client, owner, member["id"], weight_kg=72.3, body_fat_pct=24.5, waist_cm=86
    )
    assert c["recorded_on"] == today().isoformat()
    assert c["bmi"] == 25.0  # 72.3 / 1.7^2
    assert c["height_cm"] == 170
    assert c["recorded_by"]["name"] == "Owner"

    detail = (await client.get(f"/api/members/{member['id']}", headers=owner.headers)).json()
    assert detail["last_checkup_on"] == today().isoformat()


async def test_height_in_checkup_updates_profile(client: AsyncClient, owner: Account):
    member = await make_member(client, owner)
    c = await log_checkup(client, owner, member["id"], weight_kg=80, height_cm=180)
    assert c["bmi"] == 24.7
    detail = (await client.get(f"/api/members/{member['id']}", headers=owner.headers)).json()
    assert detail["height_cm"] == 180


async def test_validation(client: AsyncClient, owner: Account):
    member = await make_member(client, owner)
    url = f"/api/members/{member['id']}/checkups"
    h = owner.headers
    assert (await client.post(url, json={"notes": "only notes"}, headers=h)).status_code == 422
    assert (await client.post(url, json={"weight_kg": 5}, headers=h)).status_code == 422
    res = await client.post(url, json={"weight_kg": 70, "recorded_on": days(2)}, headers=h)
    assert res.status_code == 422
    await log_checkup(client, owner, member["id"], weight_kg=70)
    assert (await client.post(url, json={"weight_kg": 71}, headers=h)).status_code == 409


async def test_history_order_update_and_delete(client: AsyncClient, owner: Account):
    member = await make_member(client, owner, height_cm=160)
    first = await log_checkup(client, owner, member["id"], weight_kg=70, recorded_on=days(-14))
    await log_checkup(client, owner, member["id"], weight_kg=68, recorded_on=days(-7))
    await log_checkup(client, owner, member["id"], weight_kg=66.5)

    rows = (await client.get(f"/api/members/{member['id']}/checkups", headers=owner.headers)).json()
    assert [r["weight_kg"] for r in rows] == [66.5, 68, 70]

    res = await client.patch(
        f"/api/checkups/{first['id']}",
        json={"weight_kg": 71, "notes": "fixed"},
        headers=owner.headers,
    )
    assert res.json()["weight_kg"] == 71 and res.json()["bmi"] == 27.7
    res = await client.patch(
        f"/api/checkups/{first['id']}",
        json={"recorded_on": today().isoformat()},
        headers=owner.headers,
    )
    assert res.status_code == 409  # that date is taken

    assert (
        await client.delete(f"/api/checkups/{first['id']}", headers=owner.headers)
    ).status_code == 204
    rows = (await client.get(f"/api/members/{member['id']}/checkups", headers=owner.headers)).json()
    assert len(rows) == 2


async def test_only_recorder_or_manager_can_change(client: AsyncClient, owner: Account):
    coach = await invite_and_accept(client, owner, "coach@a.com", "trainer")
    coach2 = await invite_and_accept(client, owner, "coach2@a.com", "trainer")
    member = await make_member(client, owner, trainer_id=coach.user_id)
    c = await log_checkup(client, coach, member["id"], weight_kg=70)

    # Another trainer can't even see this member's check-ups, let alone change them.
    res = await client.patch(
        f"/api/checkups/{c['id']}", json={"weight_kg": 50}, headers=coach2.headers
    )
    assert res.status_code == 404
    res = await client.get(f"/api/members/{member['id']}/checkups", headers=coach2.headers)
    assert res.status_code == 404
    res = await client.patch(
        f"/api/checkups/{c['id']}", json={"weight_kg": 69}, headers=coach.headers
    )
    assert res.status_code == 200
    assert (
        await client.delete(f"/api/checkups/{c['id']}", headers=owner.headers)
    ).status_code == 204


async def test_photos(client: AsyncClient, owner: Account, local_storage):
    member = await make_member(client, owner)
    c = await log_checkup(client, owner, member["id"], weight_kg=70)
    url = f"/api/checkups/{c['id']}/photos"

    res = await client.post(
        url, files={"file": ("front.png", PNG, "image/png")}, headers=owner.headers
    )
    assert res.status_code == 201
    (photo,) = res.json()["photos"]
    img = await client.get(photo["url"], headers=owner.headers)
    assert img.status_code == 200 and img.headers["content-type"] == "image/png"
    assert img.content == PNG
    assert len(list(local_storage.rglob("*.png"))) == 1

    # The declared type is ignored: content decides.
    fake = await client.post(
        url,
        files={"file": ("x.jpg", b"<script>alert(1)</script>", "image/jpeg")},
        headers=owner.headers,
    )
    assert fake.status_code == 415

    for _ in range(3):
        await client.post(url, files={"file": ("p.jpg", JPEG, "image/jpeg")}, headers=owner.headers)
    res = await client.post(
        url, files={"file": ("p.jpg", JPEG, "image/jpeg")}, headers=owner.headers
    )
    assert res.status_code == 409  # max 4

    res = await client.delete(photo["url"], headers=owner.headers)
    assert len(res.json()["photos"]) == 3
    assert list(local_storage.rglob("*.png")) == []

    # Deleting the check-up removes its files too.
    await client.delete(f"/api/checkups/{c['id']}", headers=owner.headers)
    assert list(local_storage.rglob("*.*")) == []


async def test_deleting_member_removes_photo_files(
    client: AsyncClient, owner: Account, local_storage
):
    member = await make_member(client, owner)
    c = await log_checkup(client, owner, member["id"], weight_kg=70)
    await client.post(
        f"/api/checkups/{c['id']}/photos",
        files={"file": ("p.png", PNG, "image/png")},
        headers=owner.headers,
    )
    await client.delete(f"/api/members/{member['id']}", headers=owner.headers)
    assert list(local_storage.rglob("*.*")) == []


async def test_due_list(client: AsyncClient, owner: Account):
    coach = await invite_and_accept(client, owner, "coach@a.com", "trainer")
    plan = await make_plan(client, owner)
    p = {"plan_id": plan["id"]}

    never = await make_member(client, owner, phone="9000000001", name="Never Checked", membership=p)
    stale = await make_member(
        client, owner, phone="9000000002", name="Stale Sam", membership=p, trainer_id=coach.user_id
    )
    fresh = await make_member(client, owner, phone="9000000003", name="Fresh Fay", membership=p)
    await make_member(client, owner, phone="9000000004", name="No Plan Nia")  # not a running member

    await log_checkup(client, owner, stale["id"], weight_kg=82, recorded_on=days(-10))
    await log_checkup(client, owner, fresh["id"], weight_kg=60, recorded_on=days(-3))

    res = (await client.get("/api/checkups/due", headers=owner.headers)).json()
    assert [i["member_name"] for i in res["items"]] == ["Never Checked", "Stale Sam"]
    stale_item = res["items"][1]
    assert stale_item["days_since"] == 10 and stale_item["last_weight_kg"] == 82
    assert stale_item["trainer"]["name"] == "Staff"
    assert res["items"][0]["last_checkup_on"] is None

    mine = (await client.get("/api/checkups/due?scope=mine", headers=coach.headers)).json()
    assert [i["member_name"] for i in mine["items"]] == ["Stale Sam"]

    # A longer interval makes Stale Sam not due.
    await client.patch("/api/gym", json={"checkup_interval_days": 14}, headers=owner.headers)
    res = (await client.get("/api/checkups/due", headers=owner.headers)).json()
    assert [i["member_name"] for i in res["items"]] == ["Never Checked"]
    assert never["id"] == res["items"][0]["member_id"]


async def test_checkups_are_isolated(client: AsyncClient, owner: Account, other_owner: Account):
    member = await make_member(client, owner)
    c = await log_checkup(client, owner, member["id"], weight_kg=70)
    res = await client.post(
        f"/api/checkups/{c['id']}/photos",
        files={"file": ("p.png", PNG, "image/png")},
        headers=owner.headers,
    )
    photo_url = res.json()["photos"][0]["url"]
    h = other_owner.headers

    assert (await client.get(f"/api/members/{member['id']}/checkups", headers=h)).status_code == 404
    res = await client.post(
        f"/api/members/{member['id']}/checkups", json={"weight_kg": 50}, headers=h
    )
    assert res.status_code == 404
    assert (
        await client.patch(f"/api/checkups/{c['id']}", json={"weight_kg": 50}, headers=h)
    ).status_code == 404
    assert (await client.delete(f"/api/checkups/{c['id']}", headers=h)).status_code == 404
    assert (await client.get(photo_url, headers=h)).status_code == 404
    assert (await client.delete(photo_url, headers=h)).status_code == 404
    res = await client.post(
        f"/api/checkups/{c['id']}/photos", files={"file": ("p.png", PNG, "image/png")}, headers=h
    )
    assert res.status_code == 404
    assert (await client.get("/api/checkups/due", headers=h)).json()["total"] == 0
    # And photos need a login at all.
    client.cookies.clear()
    assert (await client.get(photo_url)).status_code == 401
