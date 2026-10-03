import uuid
from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import update

from app.modules.analytics.service import checkup_progress, month_key, on_track, shift_month
from app.modules.leads.models import Lead, LeadStage
from app.modules.members.models import Goal
from tests.conftest import Account
from tests.helpers import make_member, make_plan, today
from tests.test_gym_and_staff import invite_and_accept


def test_month_helpers():
    from datetime import date

    assert shift_month(date(2026, 1, 31), -1) == date(2025, 12, 1)
    assert shift_month(date(2026, 11, 15), 2) == date(2027, 1, 1)
    assert month_key(date(2026, 3, 9)) == "2026-03"


class Row:
    def __init__(self, member_id, weight=None, fat=None, muscle=None, waist=None, goal=None):
        self.member_id = member_id
        self.weight_kg, self.body_fat_pct, self.muscle_mass_kg, self.waist_cm = (
            weight,
            fat,
            muscle,
            waist,
        )
        self.goal = goal


def test_on_track_rules():
    assert on_track(Goal.WEIGHT_LOSS, Row(1, weight=80), Row(1, weight=78))
    assert not on_track(Goal.WEIGHT_LOSS, Row(1, weight=80), Row(1, weight=81))
    assert on_track(Goal.WEIGHT_LOSS, Row(1, fat=25), Row(1, fat=24))  # no weights: body fat
    assert on_track(Goal.MUSCLE_GAIN, Row(1, muscle=30, weight=70), Row(1, muscle=31, weight=69))
    assert on_track(Goal.STRENGTH, Row(1, weight=70), Row(1, weight=72))
    assert on_track(None, Row(1, waist=90), Row(1, waist=88))
    assert not on_track(Goal.GENERAL_FITNESS, Row(1, weight=70), Row(1, weight=69))  # unknown


def test_checkup_progress_first_vs_last():
    rows = [
        Row("a", weight=80, goal=Goal.WEIGHT_LOSS),
        Row("a", weight=79, goal=Goal.WEIGHT_LOSS),
        Row("a", weight=77, goal=Goal.WEIGHT_LOSS),
        Row("b", weight=60, fat=20, goal=Goal.MUSCLE_GAIN),
        Row("b", weight=59, fat=21, goal=Goal.MUSCLE_GAIN),
        Row("c", weight=90),  # only one check-up
    ]
    p = checkup_progress(rows)
    assert (p.members_tracked, p.on_track) == (2, 1)
    assert p.avg_weight_change == -2.0  # (-3 + -1) / 2
    assert p.avg_body_fat_change == 1.0
    assert [(g.goal, g.members, g.on_track) for g in p.by_goal] == [
        (Goal.WEIGHT_LOSS, 1, 1),
        (Goal.MUSCLE_GAIN, 1, 0),
    ]


async def get(client: AsyncClient, acct: Account, **params) -> dict:
    res = await client.get("/api/analytics", params=params, headers=acct.headers)
    assert res.status_code == 200, res.text
    return res.json()


async def renew(client, acct, member_id, plan_id, start):
    res = await client.post(
        f"/api/members/{member_id}/memberships",
        json={"plan_id": plan_id, "start_date": start.isoformat()},
        headers=acct.headers,
    )
    assert res.status_code == 201, res.text
    return res.json()


async def pay(client, acct, member_id, amount, paid_on, membership_id=None):
    body = {"amount": amount, "paid_on": paid_on.isoformat(), "membership_id": membership_id}
    res = await client.post(f"/api/members/{member_id}/payments", json=body, headers=acct.headers)
    assert res.status_code == 201, res.text


async def test_analytics_end_to_end(client: AsyncClient, owner: Account, sessions):
    t = today()
    this_month, last_month, two_back = shift_month(t, 0), shift_month(t, -1), shift_month(t, -2)
    monthly = await make_plan(client, owner, name="Monthly", price=1000, tax_pct=0, joining_fee=0)
    quarterly = await make_plan(
        client, owner, name="Quarterly", duration_value=3, price=3000, tax_pct=0, joining_fee=0
    )

    # A: three back-to-back monthly memberships (renewed twice), on one now.
    a = await make_member(
        client,
        owner,
        phone="9000000001",
        name="Asha",
        goal="weight_loss",
        joined_on=two_back.isoformat(),
        membership={"plan_id": monthly["id"], "start_date": two_back.isoformat()},
    )
    second = await renew(client, owner, a["id"], monthly["id"], last_month)
    await renew(client, owner, a["id"], monthly["id"], this_month)
    second_id = next(
        m["id"] for m in second["memberships"] if m["start_date"] == last_month.isoformat()
    )
    await pay(client, owner, a["id"], 1000, last_month, second_id)

    # B: one month two months ago, never came back.
    await make_member(
        client,
        owner,
        phone="9000000002",
        name="Bala",
        joined_on=two_back.isoformat(),
        membership={"plan_id": monthly["id"], "start_date": two_back.isoformat()},
    )
    # C: joined today on a quarterly plan, paid in full, plus a PT payment.
    c = await make_member(
        client,
        owner,
        phone="9000000003",
        name="Chitra",
        goal="muscle_gain",
        membership={"plan_id": quarterly["id"], "start_date": t.isoformat()},
    )
    await pay(client, owner, c["id"], 3000, t, c["memberships"][0]["id"])
    await pay(client, owner, c["id"], 200, t)
    await client.post(
        "/api/expenses", json={"category": "rent", "amount": 300}, headers=owner.headers
    )

    # Check-ups: A lost 2 kg; C has only one.
    for day, kg in ((10, 80), (0, 78)):
        await client.post(
            f"/api/members/{a['id']}/checkups",
            json={"weight_kg": kg, "recorded_on": (t - timedelta(days=day)).isoformat()},
            headers=owner.headers,
        )
    await client.post(
        f"/api/members/{c['id']}/checkups", json={"weight_kg": 70}, headers=owner.headers
    )

    # Leads: 2 Instagram (one converted), 1 walk-in (lost), 1 from long ago (outside the period).
    ids = []
    for i, source in enumerate(["instagram", "instagram", "walk_in", "website"]):
        res = await client.post(
            "/api/leads",
            json={"name": f"Lead {i}", "phone": f"91000000{i:02d}", "source": source},
            headers=owner.headers,
        )
        ids.append(uuid.UUID(res.json()["id"]))
    now = datetime.now(UTC)
    async with sessions() as db:
        await db.execute(
            update(Lead)
            .where(Lead.id == ids[0])
            .values(stage=LeadStage.CONVERTED, created_at=now - timedelta(days=4), converted_at=now)
        )
        await db.execute(update(Lead).where(Lead.id == ids[2]).values(stage=LeadStage.LOST))
        await db.execute(
            update(Lead).where(Lead.id == ids[3]).values(created_at=now - timedelta(days=200))
        )
        await db.commit()

    data = await get(client, owner, months=3)
    assert data["period_start"] == two_back.isoformat()
    k = data["kpis"]
    assert (k["active_members"], k["active_last_month"]) == (2, 1)
    assert (k["new_this_month"], k["new_last_month"]) == (1, 0)
    assert k["renewal_rate"] == pytest.approx(66.7)  # A renewed twice, B didn't
    assert (k["revenue_this_month"], k["revenue_last_month"]) == (3200, 1000)
    assert k["lead_conversion_rate"] == pytest.approx(33.3)

    months = {m["month"]: m for m in data["members"]}
    assert list(months) == [month_key(two_back), month_key(last_month), month_key(this_month)]
    first = months[month_key(two_back)]
    assert (first["new"], first["renewed"], first["churned"], first["renewal_rate"]) == (
        2,
        1,
        1,
        50,
    )
    assert (months[month_key(last_month)]["renewed"], months[month_key(last_month)]["churned"]) == (
        1,
        0,
    )
    assert months[month_key(this_month)]["active"] == 2
    assert sum(m["checkups"] for m in data["members"]) == 3

    fin = {f["month"]: f for f in data["finance"]}
    assert fin[month_key(this_month)] == {
        "month": month_key(this_month),
        "revenue": 3200,
        "expenses": 300,
        "profit": 2900,
    }
    assert data["revenue_by_plan"] == [
        {"plan": "Quarterly", "amount": 3000},
        {"plan": "Monthly", "amount": 1000},
        {"plan": "Other payments", "amount": 200},
    ]
    assert {p["plan"]: p["members"] for p in data["active_by_plan"]} == {
        "Monthly": 1,
        "Quarterly": 1,
    }
    assert data["upcoming"] == {"expiring_30_days": 1, "renewal_value": 1000}  # A's current month

    leads = data["leads"]
    assert (leads["total"], leads["converted"], leads["lost"]) == (3, 1, 1)
    assert leads["avg_days_to_convert"] == pytest.approx(4.0)
    assert leads["by_source"][0] == {"source": "instagram", "leads": 2, "converted": 1}
    assert {s["stage"]: s["leads"] for s in leads["by_stage"]}["new"] == 1

    progress = data["checkups"]
    assert (progress["members_tracked"], progress["on_track"], progress["avg_weight_change"]) == (
        1,
        1,
        -2.0,
    )


async def test_branch_filter(client: AsyncClient, owner: Account, other_owner: Account):
    plan = await make_plan(client, owner, price=1000, tax_pct=0, joining_fee=0)
    await make_member(client, owner, membership={"plan_id": plan["id"]})
    await client.post(
        "/api/leads", json={"name": "Lead", "phone": "9100000000"}, headers=owner.headers
    )
    branch = (
        await client.post("/api/branches", json={"name": "Second"}, headers=owner.headers)
    ).json()

    everything = await get(client, owner)
    assert everything["kpis"]["active_members"] == 1
    empty = await get(client, owner, branch_id=branch["id"])
    assert empty["kpis"]["active_members"] == 0
    assert empty["kpis"]["revenue_this_month"] == 0
    assert empty["leads"]["total"] == 1  # leads are gym-wide

    other_branch = (await client.get("/api/branches", headers=other_owner.headers)).json()[0]
    res = await client.get(
        "/api/analytics", params={"branch_id": other_branch["id"]}, headers=owner.headers
    )
    assert res.status_code == 404
    assert (await client.get("/api/analytics?months=30", headers=owner.headers)).status_code == 422


async def test_roles_and_isolation(client: AsyncClient, owner: Account, other_owner: Account):
    plan = await make_plan(client, owner)
    await make_member(client, owner, membership={"plan_id": plan["id"]})
    for role in ("trainer", "front_desk"):
        staff = await invite_and_accept(client, owner, f"{role}@a.com", role)
        assert (await client.get("/api/analytics", headers=staff.headers)).status_code == 403
    manager = await invite_and_accept(client, owner, "m@a.com", "manager")
    assert (await get(client, manager))["kpis"]["active_members"] == 1
    other = await get(client, other_owner)
    assert other["kpis"]["active_members"] == 0 and other["revenue_by_plan"] == []
