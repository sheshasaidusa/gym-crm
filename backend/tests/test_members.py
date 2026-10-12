from datetime import date, timedelta

from httpx import AsyncClient

from app.core.dates import DurationUnit, membership_end
from tests.conftest import Account
from tests.helpers import days, make_member, make_plan, today
from tests.test_gym_and_staff import invite_and_accept


async def test_onboard_member_with_membership(client: AsyncClient, owner: Account):
    plan = await make_plan(client, owner)
    staff = (await client.get("/api/staff", headers=owner.headers)).json()
    member = await make_member(
        client,
        owner,
        phone="+91 98765-43210",
        email="ravi@example.com",
        goals=["weight_loss", "strength", "weight_loss"],
        diet_pref="veg",
        tags=["Morning", "morning", "VIP"],
        trainer_id=staff[0]["user_id"],
        membership={"plan_id": plan["id"], "discount": 500},
    )
    assert member["phone"] == "+919876543210"
    assert member["tags"] == ["morning", "vip"]
    assert member["goals"] == ["weight_loss", "strength"]  # duplicates dropped, order kept
    assert member["trainer"]["name"] == "Owner"
    assert member["status"] == "active"
    assert member["preview_url"].startswith("http://localhost:3000/p/")

    (ms,) = member["memberships"]
    assert ms["start_date"] == today().isoformat()
    assert ms["end_date"] == membership_end(today(), 1, DurationUnit.MONTH).isoformat()
    # (3000 - 500 discount + 500 joining fee) * 1.18 tax
    assert ms["total"] == 3540
    assert member["current_membership"]["id"] == ms["id"]


async def test_renewal_starts_after_current_and_skips_joining_fee(
    client: AsyncClient, owner: Account
):
    plan = await make_plan(client, owner)
    member = await make_member(client, owner, membership={"plan_id": plan["id"]})
    first_end = date.fromisoformat(member["memberships"][0]["end_date"])

    res = await client.post(
        f"/api/members/{member['id']}/memberships",
        json={"plan_id": plan["id"]},
        headers=owner.headers,
    )
    assert res.status_code == 201
    renewed = res.json()
    newest = renewed["memberships"][0]
    assert newest["start_date"] == (first_end + timedelta(days=1)).isoformat()
    assert newest["joining_fee"] == 0
    assert newest["status"] == "upcoming"
    # The running membership still describes the member.
    assert renewed["status"] == "active"
    assert renewed["current_membership"]["id"] == member["memberships"][0]["id"]


async def test_overlapping_membership_rejected(client: AsyncClient, owner: Account):
    plan = await make_plan(client, owner)
    member = await make_member(client, owner, membership={"plan_id": plan["id"]})
    res = await client.post(
        f"/api/members/{member['id']}/memberships",
        json={"plan_id": plan["id"], "start_date": days(5)},
        headers=owner.headers,
    )
    assert res.status_code == 409
    assert "Overlaps" in res.json()["detail"]


async def test_discount_cannot_exceed_price(client: AsyncClient, owner: Account):
    plan = await make_plan(client, owner)
    res = await client.post(
        "/api/members",
        json={
            "name": "Asha",
            "phone": "9000000001",
            "membership": {"plan_id": plan["id"], "discount": 5000},
        },
        headers=owner.headers,
    )
    assert res.status_code == 422


async def test_duplicate_phone_rejected(client: AsyncClient, owner: Account):
    await make_member(client, owner, phone="9876543210")
    res = await client.post(
        "/api/members", json={"name": "Other", "phone": "98765 43210"}, headers=owner.headers
    )
    assert res.status_code == 409
    other = await make_member(client, owner, phone="9000000000", name="Other")
    res = await client.patch(
        f"/api/members/{other['id']}", json={"phone": "9876543210"}, headers=owner.headers
    )
    assert res.status_code == 409


async def test_update_member(client: AsyncClient, owner: Account):
    member = await make_member(client, owner)
    res = await client.patch(
        f"/api/members/{member['id']}",
        json={"medical_notes": "Knee injury", "height_cm": 175, "email": ""},
        headers=owner.headers,
    )
    assert res.status_code == 200
    body = res.json()
    assert body["medical_notes"] == "Knee injury"
    assert body["height_cm"] == 175
    assert body["email"] is None
    assert body["name"] == "Ravi Kumar"


async def test_freeze_extends_and_shifts_renewal_then_unfreeze(client: AsyncClient, owner: Account):
    plan = await make_plan(client, owner, max_freeze_days=10)
    member = await make_member(client, owner, membership={"plan_id": plan["id"]})
    mid = member["memberships"][0]["id"]
    end = date.fromisoformat(member["memberships"][0]["end_date"])
    renewed = (
        await client.post(
            f"/api/members/{member['id']}/memberships",
            json={"plan_id": plan["id"]},
            headers=owner.headers,
        )
    ).json()
    renewal_start = date.fromisoformat(renewed["memberships"][0]["start_date"])

    res = await client.post(
        f"/api/memberships/{mid}/freeze", json={"days": 7}, headers=owner.headers
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["status"] == "frozen"
    current = next(m for m in body["memberships"] if m["id"] == mid)
    assert current["end_date"] == (end + timedelta(days=7)).isoformat()
    assert current["frozen_days"] == 7
    renewal = next(m for m in body["memberships"] if m["id"] != mid)
    assert renewal["start_date"] == (renewal_start + timedelta(days=7)).isoformat()

    # Only 3 freeze days left on this plan.
    res = await client.post(f"/api/memberships/{mid}/unfreeze", headers=owner.headers)
    assert res.status_code == 200
    body = res.json()
    current = next(m for m in body["memberships"] if m["id"] == mid)
    # Froze today and unfroze today: all 7 days are given back.
    assert current["end_date"] == end.isoformat()
    assert current["frozen_days"] == 0
    assert body["status"] == "active"
    renewal = next(m for m in body["memberships"] if m["id"] != mid)
    assert renewal["start_date"] == renewal_start.isoformat()

    res = await client.post(
        f"/api/memberships/{mid}/freeze", json={"days": 11}, headers=owner.headers
    )
    assert res.status_code == 422


async def test_freeze_not_allowed_when_plan_has_no_freeze_days(client: AsyncClient, owner: Account):
    plan = await make_plan(client, owner, max_freeze_days=0)
    member = await make_member(client, owner, membership={"plan_id": plan["id"]})
    res = await client.post(
        f"/api/memberships/{member['memberships'][0]['id']}/freeze",
        json={"days": 1},
        headers=owner.headers,
    )
    assert res.status_code == 409


async def test_cancel_membership(client: AsyncClient, owner: Account):
    plan = await make_plan(client, owner)
    member = await make_member(client, owner, membership={"plan_id": plan["id"]})
    mid = member["memberships"][0]["id"]
    res = await client.post(f"/api/memberships/{mid}/cancel", headers=owner.headers)
    body = res.json()
    assert body["memberships"][0]["status"] == "cancelled"
    assert body["status"] == "none"
    assert (
        await client.post(f"/api/memberships/{mid}/cancel", headers=owner.headers)
    ).status_code == 409


async def test_list_statuses_counts_search_and_sort(client: AsyncClient, owner: Account):
    month = await make_plan(client, owner)
    week = await make_plan(client, owner, name="Week pass", duration_value=1, duration_unit="week")

    async def member(name: str, phone: str, **membership):
        return await make_member(
            client, owner, name=name, phone=phone, membership=membership or None
        )

    await member("Active Anil", "9000000001", plan_id=month["id"])
    await member("Expiring Esha", "9000000002", plan_id=week["id"], start_date=days(-3))
    await member("Expired Eva", "9000000003", plan_id=week["id"], start_date=days(-30))
    await member("Upcoming Uma", "9000000004", plan_id=month["id"], start_date=days(10))
    await make_member(client, owner, name="New Nina", phone="9000000005")

    def names(res) -> list[str]:
        return [m["name"] for m in res.json()["items"]]

    h = owner.headers
    counts = (await client.get("/api/members/counts", headers=h)).json()
    assert counts == {
        "all": 5,
        "active": 2,
        "expiring": 1,
        "frozen": 0,
        "upcoming": 1,
        "expired": 1,
        "none": 1,
    }

    res = await client.get("/api/members?status=active&sort=name", headers=h)
    assert names(res) == ["Active Anil", "Expiring Esha"]
    assert res.json()["total"] == 2
    assert names(await client.get("/api/members?status=expiring", headers=h)) == ["Expiring Esha"]
    assert names(await client.get("/api/members?status=expired", headers=h)) == ["Expired Eva"]
    assert names(await client.get("/api/members?status=none", headers=h)) == ["New Nina"]

    # List status agrees with the detail view for every member.
    for item in (await client.get("/api/members?page_size=100", headers=h)).json()["items"]:
        detail = (await client.get(f"/api/members/{item['id']}", headers=h)).json()
        assert detail["status"] == item["status"], item["name"]

    assert names(await client.get("/api/members?q=esha", headers=h)) == ["Expiring Esha"]
    assert names(await client.get("/api/members?q=0000003", headers=h)) == ["Expired Eva"]

    ending = names(await client.get("/api/members?sort=ending", headers=h))
    assert ending[0] == "Expired Eva" and ending[-1] == "New Nina"

    page = (await client.get("/api/members?page=2&page_size=2&sort=name", headers=h)).json()
    assert page["total"] == 5 and [m["name"] for m in page["items"]] == [
        "Expiring Esha",
        "New Nina",
    ]


async def test_tag_filter(client: AsyncClient, owner: Account):
    await make_member(client, owner, phone="9000000001", name="Vip One", tags=["vip"])
    await make_member(client, owner, phone="9000000002", name="Not Vip", tags=["vipish"])
    res = await client.get("/api/members?tag=vip", headers=owner.headers)
    assert [m["name"] for m in res.json()["items"]] == ["Vip One"]


async def test_role_permissions(client: AsyncClient, owner: Account):
    plan = await make_plan(client, owner)
    trainer = await invite_and_accept(client, owner, "coach@a.com", "trainer")
    desk = await invite_and_accept(client, owner, "desk@a.com", "front_desk")

    # Front desk onboards and sells; trainers only view.
    member = await make_member(client, desk, membership={"plan_id": plan["id"]})
    assert (
        await client.get(f"/api/members/{member['id']}", headers=trainer.headers)
    ).status_code == 200
    res = await client.post(
        "/api/members", json={"name": "Nope", "phone": "9111111111"}, headers=trainer.headers
    )
    assert res.status_code == 403

    # Cancelling and deleting need a manager.
    mid = member["memberships"][0]["id"]
    assert (
        await client.post(f"/api/memberships/{mid}/cancel", headers=desk.headers)
    ).status_code == 403
    assert (
        await client.delete(f"/api/members/{member['id']}", headers=desk.headers)
    ).status_code == 403
    assert (
        await client.delete(f"/api/members/{member['id']}", headers=owner.headers)
    ).status_code == 204


async def test_regenerate_preview_link(client: AsyncClient, owner: Account):
    member = await make_member(client, owner)
    res = await client.post(f"/api/members/{member['id']}/preview-link", headers=owner.headers)
    assert res.json()["preview_url"] != member["preview_url"]


async def test_more_than_three_goals_is_rejected(client: AsyncClient, owner: Account):
    r = await client.post(
        "/api/members",
        json={
            "name": "Kiran",
            "phone": "9000011111",
            "goals": ["weight_loss", "strength", "endurance", "flexibility"],
        },
        headers=owner.headers,
    )
    assert r.status_code == 422
    assert "up to 3 goals" in r.text
