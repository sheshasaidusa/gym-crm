"""Role dashboards and per-staff analytics: exact numbers on a small seeded gym."""

from datetime import UTC, datetime, timedelta

from httpx import AsyncClient

from tests.conftest import Account
from tests.helpers import days, make_member, make_plan, make_staff, today


async def get(client: AsyncClient, acct: Account, url: str):
    res = await client.get(url, headers=acct.headers)
    assert res.status_code == 200, res.text
    return res.json()


async def checkup(client: AsyncClient, acct: Account, member_id: str, on: str, weight: float):
    res = await client.post(
        f"/api/members/{member_id}/checkups",
        json={"recorded_on": on, "weight_kg": weight},
        headers=acct.headers,
    )
    assert res.status_code == 201, res.text


async def test_trainer_dashboard_counts_only_their_clients(client: AsyncClient, owner: Account):
    coach = await make_staff(client, owner, "trainer")
    other = await make_staff(client, owner, "trainer")
    plan = await make_plan(client, owner, price=1000, tax_pct=0, joining_fee=0)
    ms = {"plan_id": plan["id"], "start_date": days(-10)}

    # Active, never checked up.
    await make_member(
        client, owner, phone="9000000001", name="Asha", membership=ms, trainer_id=coach.user_id
    )
    # Ends in 3 days -> expiring; checked up recently.
    b = await make_member(
        client,
        owner,
        phone="9000000002",
        name="Bala",
        membership={"plan_id": plan["id"], "start_date": days(-27)},
        trainer_id=coach.user_id,
    )
    await checkup(client, owner, b["id"], days(-2), 80)
    # Someone else's client, and a client with no plan at all.
    await make_member(
        client, owner, phone="9000000003", name="Chandu", membership=ms, trainer_id=other.user_id
    )
    await make_member(client, owner, phone="9000000004", name="Dev", trainer_id=coach.user_id)

    board = await get(client, coach, "/api/dashboard/trainer")
    assert board["trainer"]["id"] == coach.user_id
    assert board["clients"]["all"] == 3
    assert board["clients"]["active"] == 2 and board["clients"]["expiring"] == 1
    assert board["clients"]["none"] == 1
    assert [r["name"] for r in board["expiring"]] == ["Bala"]
    assert board["expiring"][0]["days"] in (2, 3)
    # Asha has never had a check-up; Bala has one; Dev has no running membership.
    assert board["checkups_due"] == 1
    assert [r["name"] for r in board["checkups_due_list"]] == ["Asha"]
    # Both running clients lack a published plan.
    assert board["without_plan"] == 2


async def test_trainer_dashboard_access(client: AsyncClient, owner: Account):
    coach = await make_staff(client, owner, "trainer")
    other = await make_staff(client, owner, "trainer")
    # Trainers can't look at each other; owners can look at anyone's.
    res = await client.get(
        f"/api/dashboard/trainer?trainer_id={other.user_id}", headers=coach.headers
    )
    assert res.status_code == 404
    board = await get(client, owner, f"/api/dashboard/trainer?trainer_id={coach.user_id}")
    assert board["trainer"]["id"] == coach.user_id
    # ... but only people from their own gym.
    res = await client.get(
        "/api/dashboard/trainer?trainer_id=00000000-0000-0000-0000-000000000001",
        headers=owner.headers,
    )
    assert res.status_code == 404


async def test_desk_dashboard(client: AsyncClient, owner: Account):
    desk = await make_staff(client, owner, "front_desk")
    plan = await make_plan(client, owner, price=1000, tax_pct=0, joining_fee=0)
    # Ends in 2 days, owes everything.
    renewing = await make_member(
        client,
        owner,
        phone="9000000001",
        name="Rena",
        membership={"plan_id": plan["id"], "start_date": days(-28)},
    )
    # Fully paid, long way to go.
    paid = await make_member(
        client, owner, phone="9000000002", name="Paul", membership={"plan_id": plan["id"]}
    )
    res = await client.post(
        f"/api/members/{paid['id']}/payments",
        json={
            "amount": 1000,
            "paid_on": days(0),
            "method": "upi",
            "membership_id": paid["memberships"][0]["id"],
        },
        headers=owner.headers,
    )
    assert res.status_code == 201, res.text
    res = await client.post(
        f"/api/members/{renewing['id']}/payments",
        json={
            "amount": 400,
            "paid_on": days(0),
            "method": "cash",
            "membership_id": renewing["memberships"][0]["id"],
        },
        headers=owner.headers,
    )
    assert res.status_code == 201, res.text

    trial_at = datetime.now(UTC) + timedelta(minutes=1)
    lead = (
        await client.post(
            "/api/leads", json={"name": "Tia", "phone": "9800000001"}, headers=owner.headers
        )
    ).json()
    res = await client.post(
        f"/api/leads/{lead['id']}/stage",
        json={"stage": "trial_booked", "trial_at": trial_at.isoformat()},
        headers=owner.headers,
    )
    assert res.status_code == 200, res.text

    board = await get(client, desk, "/api/dashboard/desk")
    assert [r["name"] for r in board["renewals"]] == ["Rena"] and board["renewals_count"] == 1
    assert board["outstanding"] == 600 and board["dues_count"] == 1
    assert [(d["name"], d["balance"]) for d in board["dues"]] == [("Rena", 600)]
    assert board["payments_today"] == 1400 and board["payments_today_count"] == 2
    assert [(m["method"], m["amount"]) for m in board["payments_by_method"]] == [
        ("upi", 1000),
        ("cash", 400),
    ]
    assert board["new_members_today"] == 2
    # The trial may fall on tomorrow's date if the test runs just before midnight (IST).
    assert len(board["trials_today"]) in (0, 1)


async def test_sales_dashboard_mine_vs_team(client: AsyncClient, owner: Account):
    sales = await make_staff(client, owner, "sales")
    soon = datetime.now(UTC) + timedelta(days=2)
    past = datetime.now(UTC) - timedelta(hours=2)

    async def lead(acct: Account, phone: str, **body):
        res = await client.post(
            "/api/leads",
            json={"name": f"Lead {phone[-2:]}", "phone": phone, **body},
            headers=acct.headers,
        )
        assert res.status_code == 201, res.text
        return res.json()

    await lead(sales, "9800000011", assigned_to=sales.user_id)
    theirs = await lead(owner, "9800000012", assigned_to=owner.user_id)
    await lead(owner, "9800000013", assigned_to=sales.user_id, next_follow_up_at=past.isoformat())
    booked = await lead(sales, "9800000014", assigned_to=sales.user_id)

    res = await client.post(
        f"/api/leads/{booked['id']}/stage",
        json={"stage": "trial_booked", "trial_at": soon.isoformat()},
        headers=sales.headers,
    )
    assert res.status_code == 200, res.text
    res = await client.post(
        f"/api/leads/{theirs['id']}/stage",
        json={"stage": "lost", "lost_reason": "Too expensive"},
        headers=owner.headers,
    )
    assert res.status_code == 200, res.text

    board = await get(client, sales, "/api/dashboard/sales")
    mine_by_stage = {s["stage"]: s["leads"] for s in board["pipeline_mine"]}
    team_by_stage = {s["stage"]: s["leads"] for s in board["pipeline_team"]}
    assert mine_by_stage == {"new": 2, "contacted": 0, "trial_booked": 1, "trial_done": 0}
    assert team_by_stage == mine_by_stage  # the other lead is lost, so not in the open pipeline
    assert board["follow_ups_due"] == 1 and len(board["follow_ups"]) == 1
    assert [t["stage"] for t in board["trials"]] == ["trial_booked"]
    assert board["lost_reasons"] == [{"reason": "Too expensive", "leads": 1}]
    assert board["converted_team_30d"] == 0


async def test_dashboards_respect_roles(client: AsyncClient, owner: Account):
    trainer = await make_staff(client, owner, "trainer")
    sales = await make_staff(client, owner, "sales")
    for acct, url in [
        (trainer, "/api/dashboard/desk"),
        (trainer, "/api/dashboard/sales"),
        (trainer, "/api/analytics/staff"),
        (sales, "/api/dashboard/trainer"),
        (sales, "/api/dashboard/desk"),
    ]:
        res = await client.get(url, headers=acct.headers)
        assert res.status_code == 403, url


async def test_staff_analytics(client: AsyncClient, owner: Account):
    coach = await make_staff(client, owner, "trainer")
    rep = await make_staff(client, owner, "sales")
    plan = await make_plan(client, owner, price=1000, tax_pct=0, joining_fee=0)

    asha = await make_member(
        client,
        owner,
        phone="9000000001",
        name="Asha",
        goals=["weight_loss"],
        membership={"plan_id": plan["id"], "start_date": days(-10)},
        trainer_id=coach.user_id,
    )
    await checkup(client, coach, asha["id"], days(-9), 80)
    await checkup(client, coach, asha["id"], days(-1), 78)
    await make_member(
        client,
        owner,
        phone="9000000002",
        name="Bala",
        membership={"plan_id": plan["id"], "start_date": days(-5)},
        trainer_id=coach.user_id,
    )

    new = (
        await client.post(
            "/api/leads",
            json={"name": "Win", "phone": "9800000021", "assigned_to": rep.user_id},
            headers=owner.headers,
        )
    ).json()
    await client.post(
        "/api/leads",
        json={"name": "Lose", "phone": "9800000022", "assigned_to": rep.user_id},
        headers=owner.headers,
    )
    res = await client.post(
        f"/api/leads/{new['id']}/convert",
        json={"membership": {"plan_id": plan["id"]}},
        headers=owner.headers,
    )
    assert res.status_code == 200, res.text
    member_id = res.json()["converted_member_id"]
    res = await client.post(
        f"/api/members/{member_id}/payments",
        json={"amount": 700, "paid_on": days(0), "method": "cash"},
        headers=owner.headers,
    )
    assert res.status_code == 201, res.text

    data = await get(client, owner, "/api/analytics/staff")
    (trainer_row,) = [t for t in data["trainers"] if t["user_id"] == coach.user_id]
    assert trainer_row["clients"] == 2 and trainer_row["active_clients"] == 2
    assert trainer_row["checkup_compliance"] == 50.0  # Asha yes, Bala never
    assert trainer_row["members_tracked"] == 1 and trainer_row["on_track"] == 1
    assert trainer_row["avg_weight_change"] == -2.0
    (rep_row,) = [s for s in data["sales"] if s["user_id"] == rep.user_id]
    assert (rep_row["leads"], rep_row["converted"], rep_row["conversion_rate"]) == (2, 1, 50.0)
    assert rep_row["revenue"] == 700


async def test_owner_analytics_extras(client: AsyncClient, owner: Account):
    plan = await make_plan(client, owner, price=1000, tax_pct=0, joining_fee=0)
    member = await make_member(
        client, owner, phone="9000000001", membership={"plan_id": plan["id"], "start_date": days(0)}
    )
    for amount, method in [(600, "cash"), (400, "upi")]:
        res = await client.post(
            f"/api/members/{member['id']}/payments",
            json={
                "amount": amount,
                "paid_on": today().isoformat(),
                "method": method,
                "membership_id": member["memberships"][0]["id"],
            },
            headers=owner.headers,
        )
        assert res.status_code == 201, res.text

    data = await get(client, owner, "/api/analytics?months=1")
    assert [(m["method"], m["amount"], m["payments"]) for m in data["revenue_by_method"]] == [
        ("cash", 600, 1),
        ("upi", 400, 1),
    ]
    assert data["new_vs_renewal"] == {"new": 1000, "renewal": 0, "other": 0}
    assert data["branch_comparison"] == []  # a single branch isn't worth comparing
