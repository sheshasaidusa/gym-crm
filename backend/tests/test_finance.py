import asyncio

import pytest
from httpx import AsyncClient

from tests.conftest import Account
from tests.helpers import days, make_member, make_plan, today
from tests.test_gym_and_staff import invite_and_accept

PDF = b"%PDF-1.4\n" + b"0" * 64
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64


@pytest.fixture(autouse=True)
def local_storage(tmp_path, monkeypatch):
    from app.core import storage

    monkeypatch.setattr(storage, "_storage", storage.LocalStorage(str(tmp_path)))
    return tmp_path


async def member_with_membership(
    client: AsyncClient, acct: Account, phone="9000000001", **ms
) -> dict:
    plan = await make_plan(client, acct, price=3000, joining_fee=0, tax_pct=0)
    return await make_member(client, acct, phone=phone, membership={"plan_id": plan["id"], **ms})


async def pay(client: AsyncClient, acct: Account, member_id: str, **body):
    return await client.post(f"/api/members/{member_id}/payments", json=body, headers=acct.headers)


async def test_partial_payments_balance_and_receipt_numbers(client: AsyncClient, owner: Account):
    member = await member_with_membership(client, owner)
    ms = member["memberships"][0]
    assert ms["paid"] == 0 and ms["balance"] == 3000

    r1 = await pay(
        client,
        owner,
        member["id"],
        membership_id=ms["id"],
        amount=1000,
        method="upi",
        reference="UPI123",
    )
    assert r1.status_code == 201
    assert r1.json()["receipt_no"] == "RCPT-00001" and r1.json()["plan_name"] == "Monthly"
    r2 = await pay(client, owner, member["id"], membership_id=ms["id"], amount=2000)
    assert r2.json()["receipt_no"] == "RCPT-00002" and r2.json()["method"] == "cash"

    detail = (await client.get(f"/api/members/{member['id']}", headers=owner.headers)).json()
    assert detail["memberships"][0]["paid"] == 3000 and detail["memberships"][0]["balance"] == 0

    over = await pay(client, owner, member["id"], membership_id=ms["id"], amount=1)
    assert over.status_code == 422 and "fully paid" in over.json()["detail"]


async def test_overpayment_and_validation(client: AsyncClient, owner: Account):
    member = await member_with_membership(client, owner)
    ms_id = member["memberships"][0]["id"]
    res = await pay(client, owner, member["id"], membership_id=ms_id, amount=3500)
    assert res.status_code == 422 and "3000" in res.json()["detail"]
    assert (await pay(client, owner, member["id"], amount=0)).status_code == 422
    future = await pay(client, owner, member["id"], amount=100, paid_on=days(3))
    assert future.status_code == 422
    # A payment not tied to a membership (e.g. merchandise) is allowed.
    misc = await pay(client, owner, member["id"], amount=250, note="Shaker bottle")
    assert misc.status_code == 201 and misc.json()["membership_id"] is None


async def test_pay_when_selling_membership(client: AsyncClient, owner: Account):
    member = await member_with_membership(
        client, owner, payment={"amount": 3000, "method": "card", "reference": "TXN9"}
    )
    ms = member["memberships"][0]
    assert ms["paid"] == 3000 and ms["balance"] == 0
    payments = (
        await client.get(f"/api/payments?member_id={member['id']}", headers=owner.headers)
    ).json()
    assert payments["total"] == 1 and payments["items"][0]["reference"] == "TXN9"


async def test_void_restores_balance_and_is_kept(client: AsyncClient, owner: Account):
    member = await member_with_membership(client, owner)
    ms_id = member["memberships"][0]["id"]
    p = (await pay(client, owner, member["id"], membership_id=ms_id, amount=3000)).json()
    desk = await invite_and_accept(client, owner, "desk@a.com", "front_desk")
    res = await client.post(
        f"/api/payments/{p['id']}/void", json={"reason": "Wrong member"}, headers=desk.headers
    )
    assert res.status_code == 403

    res = await client.post(
        f"/api/payments/{p['id']}/void", json={"reason": "Wrong member"}, headers=owner.headers
    )
    assert res.json()["voided_at"] and res.json()["void_reason"] == "Wrong member"
    again = await client.post(
        f"/api/payments/{p['id']}/void", json={"reason": "x2"}, headers=owner.headers
    )
    assert again.status_code == 409

    detail = (await client.get(f"/api/members/{member['id']}", headers=owner.headers)).json()
    assert detail["memberships"][0]["balance"] == 3000
    listing = (await client.get("/api/payments", headers=owner.headers)).json()
    assert listing["total"] == 1 and listing["amount_total"] == 0  # kept, but not counted
    active_only = (
        await client.get("/api/payments?include_voided=false", headers=owner.headers)
    ).json()
    assert active_only["total"] == 0


async def test_receipt(client: AsyncClient, owner: Account):
    member = await member_with_membership(client, owner, discount=500)
    ms_id = member["memberships"][0]["id"]
    p = (await pay(client, owner, member["id"], membership_id=ms_id, amount=1000)).json()
    r = (await client.get(f"/api/payments/{p['id']}/receipt", headers=owner.headers)).json()
    assert r["payment"]["receipt_no"] == "RCPT-00001" and r["gym"]["name"] == "Gym A"
    assert r["membership"] == {
        **r["membership"],
        "total": 2500,
        "paid": 1000,
        "balance": 1500,
    }
    assert r["member_phone"] == member["phone"]


async def test_receipt_numbers_are_unique_under_concurrency(client: AsyncClient, owner: Account):
    member = await member_with_membership(client, owner)
    results = await asyncio.gather(*[pay(client, owner, member["id"], amount=10) for _ in range(5)])
    numbers = {r.json()["receipt_no"] for r in results}
    assert len(numbers) == 5


async def test_dues(client: AsyncClient, owner: Account):
    a = await member_with_membership(client, owner, phone="9000000001")
    b = await member_with_membership(client, owner, phone="9000000002")
    c = await member_with_membership(client, owner, phone="9000000003")
    await pay(client, owner, a["id"], membership_id=a["memberships"][0]["id"], amount=1000)
    await pay(client, owner, b["id"], membership_id=b["memberships"][0]["id"], amount=3000)
    await client.post(f"/api/memberships/{c['memberships'][0]['id']}/cancel", headers=owner.headers)

    dues = (await client.get("/api/finance/dues", headers=owner.headers)).json()
    assert [(d["member_id"], d["balance"]) for d in dues["items"]] == [(a["id"], 2000)]
    assert dues["outstanding"] == 2000


async def test_expenses_crud_and_attachment(client: AsyncClient, owner: Account, local_storage):
    h = owner.headers
    res = await client.post(
        "/api/expenses",
        json={"category": "rent", "amount": 40000, "vendor": "Landlord", "method": "bank_transfer"},
        headers=h,
    )
    assert res.status_code == 201
    e = res.json()
    assert e["spent_on"] == today().isoformat() and e["attachment_url"] is None
    await client.post("/api/expenses", json={"category": "utilities", "amount": 5500.5}, headers=h)
    assert (
        await client.post("/api/expenses", json={"category": "rent", "amount": -5}, headers=h)
    ).status_code == 422
    future = await client.post(
        "/api/expenses", json={"category": "rent", "amount": 5, "spent_on": days(2)}, headers=h
    )
    assert future.status_code == 422

    listing = (await client.get("/api/expenses", headers=h)).json()
    assert listing["total"] == 2 and listing["amount_total"] == 45500.5
    assert listing["by_category"] == {"rent": 40000, "utilities": 5500.5}
    assert (await client.get("/api/expenses?category=rent", headers=h)).json()["total"] == 1

    url = f"/api/expenses/{e['id']}/attachment"
    up = await client.post(url, files={"file": ("bill.pdf", PDF, "application/pdf")}, headers=h)
    assert up.json()["attachment_url"] == url
    got = await client.get(url, headers=h)
    assert got.headers["content-type"] == "application/pdf" and got.content == PDF
    bad = await client.post(
        url, files={"file": ("x.pdf", b"not a pdf", "application/pdf")}, headers=h
    )
    assert bad.status_code == 415
    # Replacing the attachment deletes the old file.
    await client.post(url, files={"file": ("bill.png", PNG, "image/png")}, headers=h)
    assert len(list(local_storage.rglob("*.*"))) == 1

    res = await client.patch(
        f"/api/expenses/{e['id']}", json={"amount": 42000, "note": "Oct rent"}, headers=h
    )
    assert res.json()["amount"] == 42000
    assert (await client.delete(f"/api/expenses/{e['id']}", headers=h)).status_code == 204
    assert list(local_storage.rglob("*.*")) == []


async def test_summary(client: AsyncClient, owner: Account):
    member = await member_with_membership(client, owner)
    ms_id = member["memberships"][0]["id"]
    await pay(client, owner, member["id"], membership_id=ms_id, amount=2000, method="upi")
    voided = (await pay(client, owner, member["id"], membership_id=ms_id, amount=500)).json()
    await client.post(
        f"/api/payments/{voided['id']}/void", json={"reason": "Mistake"}, headers=owner.headers
    )
    await client.post(
        "/api/expenses", json={"category": "rent", "amount": 1500}, headers=owner.headers
    )

    s = (await client.get("/api/finance/summary?months=3", headers=owner.headers)).json()
    assert len(s["months"]) == 3 and s["currency"] == "INR"
    assert s["this_month"] == {
        "month": today().strftime("%Y-%m"),
        "revenue": 2000,
        "expenses": 1500,
        "profit": 500,
    }
    assert s["months"][-1] == s["this_month"]
    assert s["revenue_by_method"] == {"upi": 2000}
    assert s["expenses_by_category"] == {"rent": 1500}
    assert s["outstanding_dues"] == 1000
    assert s["last_month"]["revenue"] == 0


async def test_roles_and_isolation(client: AsyncClient, owner: Account, other_owner: Account):
    trainer = await invite_and_accept(client, owner, "coach@a.com", "trainer")
    desk = await invite_and_accept(client, owner, "desk@a.com", "front_desk")
    member = await member_with_membership(client, owner)
    ms_id = member["memberships"][0]["id"]

    # Trainers don't handle money; front desk takes payments but not expenses/summary.
    assert (await pay(client, trainer, member["id"], amount=10)).status_code == 403
    assert (await client.get("/api/payments", headers=trainer.headers)).status_code == 403
    p = (await pay(client, desk, member["id"], membership_id=ms_id, amount=100)).json()
    assert p["recorded_by"]["name"] == "Staff"
    assert (await client.get("/api/finance/dues", headers=desk.headers)).status_code == 200
    assert (await client.get("/api/expenses", headers=desk.headers)).status_code == 403
    assert (await client.get("/api/finance/summary", headers=desk.headers)).status_code == 403

    e = (
        await client.post(
            "/api/expenses", json={"category": "rent", "amount": 10}, headers=owner.headers
        )
    ).json()
    h = other_owner.headers
    assert (await pay(client, other_owner, member["id"], amount=10)).status_code == 404
    other_member = await make_member(client, other_owner, phone="9111111111")
    res = await pay(client, other_owner, other_member["id"], membership_id=ms_id, amount=10)
    assert res.status_code == 404  # can't pay into another gym's membership
    assert (await client.get(f"/api/payments/{p['id']}/receipt", headers=h)).status_code == 404
    assert (
        await client.post(f"/api/payments/{p['id']}/void", json={"reason": "xx"}, headers=h)
    ).status_code == 404
    assert (await client.get("/api/payments", headers=h)).json()["total"] == 0
    assert (await client.get("/api/finance/dues", headers=h)).json()["items"] == []
    assert (await client.get("/api/expenses", headers=h)).json()["total"] == 0
    assert (
        await client.patch(f"/api/expenses/{e['id']}", json={"amount": 1}, headers=h)
    ).status_code == 404
    assert (await client.delete(f"/api/expenses/{e['id']}", headers=h)).status_code == 404
    assert (await client.get(f"/api/expenses/{e['id']}/attachment", headers=h)).status_code == 404
    s = (await client.get("/api/finance/summary", headers=h)).json()
    assert s["this_month"]["revenue"] == 0 and s["this_month"]["expenses"] == 0
    # Receipt numbering is per gym.
    first_b = (await pay(client, other_owner, other_member["id"], amount=10)).json()
    assert first_b["receipt_no"] == "RCPT-00001"
