import csv
import io

import pytest
from httpx import AsyncClient

from tests.conftest import Account
from tests.helpers import make_member, make_plan
from tests.test_gym_and_staff import invite_and_accept


@pytest.fixture(autouse=True)
def local_storage(tmp_path, monkeypatch):
    from app.core import storage

    monkeypatch.setattr(storage, "_storage", storage.LocalStorage(str(tmp_path)))


async def log(client: AsyncClient, acct: Account, **params) -> list[dict]:
    res = await client.get("/api/audit", params=params, headers=acct.headers)
    assert res.status_code == 200, res.text
    return res.json()["items"]


def read_csv(res) -> list[dict]:
    assert res.status_code == 200, res.text
    assert res.headers["content-type"].startswith("text/csv")
    return list(csv.DictReader(io.StringIO(res.content.decode("utf-8-sig"))))


async def test_audit_trail(client: AsyncClient, owner: Account):
    h = owner.headers
    plan = await make_plan(client, owner, name="Monthly", price=1000, tax_pct=0, joining_fee=0)
    member = await make_member(client, owner, name="Asha Rao", membership={"plan_id": plan["id"]})
    ms_id = member["memberships"][0]["id"]

    pay = await client.post(
        f"/api/members/{member['id']}/payments",
        json={"amount": 1000, "method": "upi", "membership_id": ms_id},
        headers=h,
    )
    await client.post(
        f"/api/payments/{pay.json()['id']}/void", json={"reason": "Entered twice"}, headers=h
    )
    await client.patch(
        f"/api/members/{member['id']}",
        json={"email": "asha@x.com", "medical_notes": "Asthma"},
        headers=h,
    )
    await client.patch(f"/api/members/{member['id']}", json={"name": "Asha Rao"}, headers=h)
    await client.patch(f"/api/plans/{plan['id']}", json={"is_active": False}, headers=h)
    await client.patch("/api/gym", json={"name": "Iron Temple"}, headers=h)
    await invite_and_accept(client, owner, "desk@a.com", "front_desk")

    entries = await log(client, owner)
    actions = [e["action"] for e in entries]
    # Newest first; the no-op rename wrote nothing.
    assert actions == [
        "staff.invited",
        "gym.updated",
        "plan.archived",
        "member.updated",
        "payment.voided",
        "payment.recorded",
        "member.created",
        "plan.created",
    ]
    by_action = {e["action"]: e for e in entries}
    assert by_action["member.created"]["summary"] == "Added member Asha Rao on Monthly"
    recorded = by_action["payment.recorded"]["summary"]
    assert recorded.startswith("Recorded 1,000 upi payment from Asha Rao")
    assert by_action["payment.voided"]["summary"].endswith(": Entered twice")
    # Sensitive values stay out of the log; only the field names are kept.
    updated = by_action["member.updated"]
    assert updated["summary"] == "Updated Asha Rao: email, medical notes"
    assert "Asthma" not in str(updated["details"])
    assert by_action["gym.updated"]["details"]["changes"]["name"][1] == "Iron Temple"
    assert all(e["actor_name"] for e in entries)

    # Filters
    assert [e["action"] for e in await log(client, owner, target_type="payment")] == [
        "payment.voided",
        "payment.recorded",
    ]
    assert len(await log(client, owner, q="asha")) == 4


async def test_failed_changes_leave_no_entry(client: AsyncClient, owner: Account):
    await make_member(client, owner, phone="9000000000")
    res = await client.post(
        "/api/members", json={"name": "Dup", "phone": "9000000000"}, headers=owner.headers
    )
    assert res.status_code == 409
    assert [e["action"] for e in await log(client, owner)] == ["member.created"]


async def test_audit_access(client: AsyncClient, owner: Account, other_owner: Account):
    await make_plan(client, owner)
    manager = await invite_and_accept(client, owner, "m@a.com", "manager")
    assert (await client.get("/api/audit", headers=manager.headers)).status_code == 403
    assert await log(client, other_owner) == []


async def test_exports(client: AsyncClient, owner: Account):
    h = owner.headers
    plan = await make_plan(client, owner, name="Monthly", price=1000, tax_pct=0, joining_fee=0)
    member = await make_member(
        client,
        owner,
        name="Asha Rao",
        email="asha@x.com",
        tags=["morning"],
        membership={"plan_id": plan["id"], "payment": {"amount": 400, "method": "cash"}},
    )
    await client.post(f"/api/members/{member['id']}/checkups", json={"weight_kg": 70}, headers=h)
    await client.post("/api/expenses", json={"category": "rent", "amount": 5000}, headers=h)
    await client.post("/api/leads", json={"name": "Ravi", "phone": "9100000000"}, headers=h)

    (m,) = read_csv(await client.get("/api/exports/members.csv", headers=h))
    assert (m["Name"], m["Email"], m["Plan"], m["Status"], m["Balance due"], m["Tags"]) == (
        "Asha Rao",
        "asha@x.com",
        "Monthly",
        "active",
        "600.00",
        "morning",
    )
    (ms,) = read_csv(await client.get("/api/exports/memberships.csv", headers=h))
    assert (ms["Total"], ms["Paid"], ms["Balance"]) == ("1000.00", "400.00", "600.00")
    (p,) = read_csv(await client.get("/api/exports/payments.csv", headers=h))
    assert (p["Member"], p["Amount"], p["Method"], p["For"]) == (
        "Asha Rao",
        "400.00",
        "cash",
        "Monthly",
    )
    (e,) = read_csv(await client.get("/api/exports/expenses.csv", headers=h))
    assert (e["Category"], e["Amount"]) == ("rent", "5000.00")
    (lead,) = read_csv(await client.get("/api/exports/leads.csv", headers=h))
    assert (lead["Name"], lead["Stage"]) == ("Ravi", "new")
    (c,) = read_csv(await client.get("/api/exports/checkups.csv", headers=h))
    assert c["Weight (kg)"] == "70.0"
    (pl,) = read_csv(await client.get("/api/exports/plans.csv", headers=h))
    assert (pl["Plan name"], pl["Duration"], pl["Price"]) == ("Monthly", "1 month", "1000.00")

    res = await client.get("/api/exports/members.csv", headers=h)
    assert "members-" in res.headers["content-disposition"]
    assert (await client.get("/api/exports/secrets.csv", headers=h)).status_code == 422
    downloads = await log(client, owner, target_type="export")
    assert len(downloads) == 8 and downloads[0]["summary"] == "Downloaded members as CSV"


async def test_export_round_trips_into_import(
    client: AsyncClient, owner: Account, other_owner: Account
):
    """Moving gyms: plans and members exported from one import cleanly into another."""
    plan = await make_plan(client, owner, name="Quarterly", duration_value=3, price=4500)
    await make_member(
        client,
        owner,
        name="Asha Rao",
        gender="female",
        goals=["weight_loss", "strength"],
        membership={"plan_id": plan["id"]},
    )
    for entity in ("plans", "members"):
        data = (await client.get(f"/api/exports/{entity}.csv", headers=owner.headers)).content
        up = await client.post(
            "/api/imports",
            data={"entity": entity},
            files={"file": (f"{entity}.csv", data, "text/csv")},
            headers=other_owner.headers,
        )
        job = up.json()
        check = await client.post(
            f"/api/imports/{job['job']['id']}/check",
            json={"mapping": job["suggested_mapping"], "date_order": "ymd"},
            headers=other_owner.headers,
        )
        assert check.json()["invalid"] == 0, check.json()["errors"]
        await client.post(f"/api/imports/{job['job']['id']}/run", headers=other_owner.headers)

    members = (await client.get("/api/members", headers=other_owner.headers)).json()["items"]
    (m,) = members
    detail = (await client.get(f"/api/members/{m['id']}", headers=other_owner.headers)).json()
    assert (detail["name"], detail["gender"], detail["goals"]) == (
        "Asha Rao",
        "female",
        ["weight_loss", "strength"],
    )
    assert detail["memberships"][0]["plan_name"] == "Quarterly"


async def test_export_roles_and_isolation(
    client: AsyncClient, owner: Account, other_owner: Account
):
    await make_member(client, owner)
    desk = await invite_and_accept(client, owner, "desk@a.com", "front_desk")
    assert (await client.get("/api/exports/members.csv", headers=desk.headers)).status_code == 403
    assert read_csv(await client.get("/api/exports/members.csv", headers=other_owner.headers)) == []


def test_audit_timestamps_strictly_increase():
    from app.modules.audit.service import _timestamp

    stamps = [_timestamp() for _ in range(1000)]
    assert all(a < b for a, b in zip(stamps, stamps[1:], strict=False))
