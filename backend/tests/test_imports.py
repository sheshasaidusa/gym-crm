import csv
import io
from datetime import date

import pytest
from httpx import AsyncClient

from app.modules.imports.importers import suggest_mapping
from app.modules.imports.models import DateOrder, ImportEntity
from app.modules.imports.parsing import (
    ParseError,
    parse_date,
    parse_decimal,
    parse_duration,
    read_table,
)
from tests.conftest import Account
from tests.helpers import make_member, make_plan
from tests.test_gym_and_staff import invite_and_accept


@pytest.fixture(autouse=True)
def local_storage(tmp_path, monkeypatch):
    from app.core import storage

    monkeypatch.setattr(storage, "_storage", storage.LocalStorage(str(tmp_path)))
    return tmp_path


def to_csv(rows: list[list[str]]) -> bytes:
    buf = io.StringIO()
    csv.writer(buf).writerows(rows)
    return buf.getvalue().encode()


async def upload(
    client: AsyncClient, acct: Account, entity: str, data: bytes, name="data.csv"
) -> dict:
    res = await client.post(
        "/api/imports",
        data={"entity": entity},
        files={"file": (name, data, "text/csv")},
        headers=acct.headers,
    )
    assert res.status_code == 201, res.text
    return res.json()


async def check(client: AsyncClient, acct: Account, job_id: str, mapping: dict, **opts) -> dict:
    res = await client.post(
        f"/api/imports/{job_id}/check", json={"mapping": mapping, **opts}, headers=acct.headers
    )
    assert res.status_code == 200, res.text
    return res.json()


async def run(client: AsyncClient, acct: Account, job_id: str) -> dict:
    res = await client.post(f"/api/imports/{job_id}/run", headers=acct.headers)
    assert res.status_code == 202, res.text
    # Background tasks finish before the test client returns.
    return (await client.get(f"/api/imports/{job_id}", headers=acct.headers)).json()


# --- Parsing ----------------------------------------------------------------------


@pytest.mark.parametrize(
    ("value", "order", "expected"),
    [
        ("2026-10-05", DateOrder.DMY, date(2026, 10, 5)),
        ("05/10/2026", DateOrder.DMY, date(2026, 10, 5)),
        ("05/10/2026", DateOrder.MDY, date(2026, 5, 10)),
        ("5-10-26", DateOrder.DMY, date(2026, 10, 5)),
        ("05.10.2026", DateOrder.DMY, date(2026, 10, 5)),
        ("5 Oct 2026", DateOrder.DMY, date(2026, 10, 5)),
        ("05-Oct-26", DateOrder.DMY, date(2026, 10, 5)),
        ("October 5, 2026", DateOrder.DMY, date(2026, 10, 5)),
        (date(2026, 10, 5), DateOrder.DMY, date(2026, 10, 5)),
        ("", DateOrder.DMY, None),
    ],
)
def test_parse_date(value, order, expected):
    assert parse_date(value, order) == expected


@pytest.mark.parametrize("value", ["31/02/2026", "tomorrow", "13/13/2026"])
def test_parse_date_rejects(value):
    with pytest.raises(ParseError):
        parse_date(value, DateOrder.DMY)


def test_parse_numbers_and_durations():
    assert str(parse_decimal("₹1,800.50")) == "1800.50"
    assert parse_decimal(1800.0) == 1800
    with pytest.raises(ParseError):
        parse_decimal("abc")
    assert parse_duration("Quarterly") == (3, "month")
    assert parse_duration("12 months") == (12, "month")
    assert parse_duration("1 yr") == (1, "year")
    assert parse_duration("30 days") == (30, "day")


def test_read_table_csv_variants():
    headers, rows = read_table("﻿Name;Phone\nAsha;98765 43210\n;\n".encode(), "x.csv")
    assert headers == ["Name", "Phone"] and rows == [{"Name": "Asha", "Phone": "98765 43210"}]
    with pytest.raises(ParseError):
        read_table(b"Name,Phone\n", "x.csv")


def test_suggest_mapping():
    cols = ["Member Name", "Mobile No", "E-mail", "Package", "Expiry Date", "Fees Paid", "Remarks"]
    m = suggest_mapping(ImportEntity.MEMBERS, cols)
    assert m == {
        "name": "Member Name",
        "phone": "Mobile No",
        "email": "E-mail",
        "plan": "Package",
        "membership_end": "Expiry Date",
        "amount_paid": "Fees Paid",
        "notes": "Remarks",
    }


# --- Flows --------------------------------------------------------------------------

MEMBERS_CSV = to_csv(
    [
        [
            "Member Name",
            "Mobile",
            "Email",
            "Gender",
            "Package",
            "Start",
            "Expiry",
            "Paid",
            "Mode",
            "Goal",
        ],
        [
            "Asha Rao",
            "98765 43210",
            "asha@x.com",
            "F",
            "Monthly",
            "01/09/2026",
            "30/09/2026",
            "1500",
            "GPay",
            "fat loss",
        ],
        ["Bala K", "9123456780", "", "male", "monthly", "05/10/2026", "", "", "", ""],
        ["Asha Again", "98765-43210", "", "", "", "", "", "", "", ""],  # same phone as row 2
        ["Bad Row", "12", "not-an-email", "X", "Gold", "31/02/2026", "", "", "", ""],
        ["Existing", "9000000000", "", "", "", "", "", "", "", ""],
    ]
)


async def test_members_import_end_to_end(client: AsyncClient, owner: Account):
    await make_plan(client, owner, name="Monthly", price=1500, tax_pct=0, joining_fee=0)
    await make_member(client, owner, phone="9000000000", name="Already Here")

    up = await upload(client, owner, "members", MEMBERS_CSV)
    assert up["job"]["total_rows"] == 5
    mapping = up["suggested_mapping"]
    assert mapping["name"] == "Member Name" and mapping["phone"] == "Mobile"
    mapping.update(
        {
            "membership_start": "Start",
            "membership_end": "Expiry",
            "amount_paid": "Paid",
            "payment_method": "Mode",
        }
    )

    result = await check(client, owner, up["job"]["id"], mapping)
    assert (result["new"], result["duplicates"], result["invalid"]) == (2, 2, 1)
    (problem,) = result["errors"]
    assert problem["row"] == 5
    joined = " ".join(problem["messages"])
    for bit in ("phone", "email", "gender", "date"):
        assert bit in joined, bit
    # The dry run wrote nothing.
    assert (await client.get("/api/members", headers=owner.headers)).json()["total"] == 1

    job = await run(client, owner, up["job"]["id"])
    assert job["status"] == "done"
    assert (job["created"], job["updated"], job["skipped"], job["failed"]) == (2, 0, 2, 1)
    assert job["has_error_file"]

    members = (await client.get("/api/members?q=asha", headers=owner.headers)).json()["items"]
    asha = (await client.get(f"/api/members/{members[0]['id']}", headers=owner.headers)).json()
    assert asha["phone"] == "9876543210"
    assert asha["gender"] == "female" and asha["goals"] == ["weight_loss"]
    ms = asha["memberships"][0]
    assert (ms["start_date"], ms["end_date"], ms["paid"], ms["balance"]) == (
        "2026-09-01",
        "2026-09-30",
        1500,
        0,
    )
    payments = (
        await client.get(f"/api/payments?member_id={asha['id']}", headers=owner.headers)
    ).json()
    assert payments["items"][0]["method"] == "upi"

    bala = (await client.get("/api/members?q=bala", headers=owner.headers)).json()["items"][0]
    assert bala["current_membership"]["end_date"] == "2026-11-04"  # computed from the plan

    problems = await client.get(
        f"/api/imports/{up['job']['id']}/problems.csv", headers=owner.headers
    )
    lines = problems.content.decode("utf-8-sig").splitlines()
    assert lines[0].startswith("Row,Problem,Member Name") and lines[1].startswith("5,")

    # Can't run twice.
    assert (
        await client.post(f"/api/imports/{up['job']['id']}/run", headers=owner.headers)
    ).status_code == 409


async def test_update_mode_fills_in_existing_members(client: AsyncClient, owner: Account):
    m = await make_member(client, owner, phone="9000000000", name="Old Name")
    data = to_csv(
        [["Name", "Phone", "Email", "Medical"], ["New Name", "9000000000", "n@x.com", "Asthma"]]
    )
    up = await upload(client, owner, "members", data)
    result = await check(
        client, owner, up["job"]["id"], up["suggested_mapping"], duplicate_mode="update"
    )
    assert result["duplicates"] == 1
    job = await run(client, owner, up["job"]["id"])
    assert job["updated"] == 1
    detail = (await client.get(f"/api/members/{m['id']}", headers=owner.headers)).json()
    assert (detail["name"], detail["email"], detail["medical_notes"]) == (
        "New Name",
        "n@x.com",
        "Asthma",
    )


async def test_required_mapping_and_month_first_dates(client: AsyncClient, owner: Account):
    data = to_csv([["Name", "Mobile", "Joined"], ["Asha", "9876543210", "10/05/2026"]])
    up = await upload(client, owner, "members", data)
    res = await client.post(
        f"/api/imports/{up['job']['id']}/check",
        json={"mapping": {"name": "Name"}},
        headers=owner.headers,
    )
    assert res.status_code == 422 and "Phone" in res.json()["detail"]
    mapping = {"name": "Name", "phone": "Mobile", "joined_on": "Joined"}
    result = await check(client, owner, up["job"]["id"], mapping, date_order="mdy")
    assert result["preview"][0]["values"]["joined_on"] == "05 Oct 2026"


async def test_excel_plans_then_leads_payments_checkups(client: AsyncClient, owner: Account):
    from openpyxl import Workbook

    wb = Workbook()
    ws = wb.active
    ws.append(["Package", "Validity", "Fee", "GST", "Includes"])
    ws.append(["Quarterly", "3 months", 4500, 18, "Gym, Cardio"])
    ws.append(["Annual", "Yearly", "₹15,000", "", ""])
    buf = io.BytesIO()
    wb.save(buf)
    up = await upload(client, owner, "plans", buf.getvalue(), name="plans.xlsx")
    assert up["suggested_mapping"] == {
        "name": "Package",
        "duration": "Validity",
        "price": "Fee",
        "tax_pct": "GST",
        "services": "Includes",
    }
    await check(client, owner, up["job"]["id"], up["suggested_mapping"])
    assert (await run(client, owner, up["job"]["id"]))["created"] == 2
    plans = {p["name"]: p for p in (await client.get("/api/plans", headers=owner.headers)).json()}
    assert plans["Annual"]["duration_unit"] == "year" and plans["Annual"]["price"] == 15000
    assert plans["Quarterly"]["services"] == ["Gym", "Cardio"]

    member = await make_member(
        client, owner, phone="9876543210", membership={"plan_id": plans["Quarterly"]["id"]}
    )

    leads = to_csv(
        [
            ["Name", "Phone", "Source", "Status", "Follow up"],
            ["Ravi", "9111111111", "insta", "Called", "03/10/2026"],
            ["Member Already", "9876543210", "walk in", "", ""],
        ]
    )
    up = await upload(client, owner, "leads", leads)
    result = await check(client, owner, up["job"]["id"], up["suggested_mapping"])
    assert result["new"] == 1 and result["errors"][0]["messages"] == [
        "Already a member with this phone number"
    ]
    await run(client, owner, up["job"]["id"])
    (lead,) = (await client.get("/api/leads", headers=owner.headers)).json()
    assert (lead["source"], lead["stage"]) == ("instagram", "contacted") and lead[
        "next_follow_up_at"
    ]

    total = member["memberships"][0]["total"]
    pays = to_csv(
        [
            ["Mobile", "Amount", "Date", "Mode", "UTR"],
            ["9876543210", "2000", "01/10/2026", "neft", "UTR1"],
            ["9876543210", "2000", "01/10/2026", "neft", "UTR1"],  # exact repeat
            ["9999999999", "100", "01/10/2026", "", ""],
        ]
    )
    up = await upload(client, owner, "payments", pays)
    result = await check(
        client,
        owner,
        up["job"]["id"],
        {
            "phone": "Mobile",
            "amount": "Amount",
            "paid_on": "Date",
            "method": "Mode",
            "reference": "UTR",
        },
    )
    assert (result["new"], result["duplicates"], result["invalid"]) == (1, 1, 1)
    await run(client, owner, up["job"]["id"])
    detail = (await client.get(f"/api/members/{member['id']}", headers=owner.headers)).json()
    assert (
        detail["memberships"][0]["paid"] == 2000
        and detail["memberships"][0]["balance"] == total - 2000
    )

    checkups = to_csv(
        [
            ["Phone", "Date", "Weight", "Waist"],
            ["9876543210", "01/09/2026", "80", "90"],
            ["9876543210", "01/10/2026", "78.5", ""],
        ]
    )
    up = await upload(client, owner, "checkups", checkups)
    await check(client, owner, up["job"]["id"], up["suggested_mapping"])
    assert (await run(client, owner, up["job"]["id"]))["created"] == 2
    rows = (await client.get(f"/api/members/{member['id']}/checkups", headers=owner.headers)).json()
    assert [r["weight_kg"] for r in rows] == [78.5, 80]


async def test_upload_validation(client: AsyncClient, owner: Account):
    res = await client.post(
        "/api/imports",
        data={"entity": "members"},
        files={"file": ("x.csv", b"Name,Phone\n", "text/csv")},
        headers=owner.headers,
    )
    assert res.status_code == 422 and "no data" in res.json()["detail"]
    res = await client.post(
        "/api/imports",
        data={"entity": "members"},
        files={"file": ("x.xls", b"\xd0\xcf\x11\xe0", "application/vnd.ms-excel")},
        headers=owner.headers,
    )
    assert res.status_code == 422 and ".xlsx" in res.json()["detail"]
    template = await client.get("/api/imports/templates/members", headers=owner.headers)
    assert template.content.decode("utf-8-sig").startswith("Name,Phone,Email")


async def test_roles_and_isolation(client: AsyncClient, owner: Account, other_owner: Account):
    desk = await invite_and_accept(client, owner, "desk@a.com", "front_desk")
    data = to_csv([["Name", "Phone"], ["Asha", "9876543210"]])
    res = await client.post(
        "/api/imports",
        data={"entity": "members"},
        files={"file": ("x.csv", data, "text/csv")},
        headers=desk.headers,
    )
    assert res.status_code == 403
    up = await upload(client, owner, "members", data)
    jid = up["job"]["id"]
    h = other_owner.headers
    assert (await client.get(f"/api/imports/{jid}", headers=h)).status_code == 404
    assert (
        await client.post(f"/api/imports/{jid}/check", json={"mapping": {}}, headers=h)
    ).status_code == 404
    assert (await client.post(f"/api/imports/{jid}/run", headers=h)).status_code == 404
    assert (await client.get("/api/imports", headers=h)).json() == []
    # Running in gym A never touches gym B.
    await check(client, owner, jid, up["suggested_mapping"])
    await run(client, owner, jid)
    assert (await client.get("/api/members", headers=h)).json()["total"] == 0
