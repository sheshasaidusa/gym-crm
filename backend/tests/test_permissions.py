"""Who can do what: the role matrix, record scoping and staff management rules."""

import pytest
from httpx import AsyncClient

from app.core.permissions import CAPS, Cap, capabilities
from app.modules.gyms.models import Role
from tests.conftest import Account
from tests.helpers import make_member, make_plan, make_staff

ROLES = ["owner", "manager", "front_desk", "sales", "trainer"]


async def team(client: AsyncClient, owner: Account) -> dict[str, Account]:
    accounts = {"owner": owner}
    for role in ROLES[1:]:
        accounts[role] = await make_staff(client, owner, role)
    return accounts


# --- Capabilities -------------------------------------------------------------


def test_every_capability_has_a_role_and_owner_has_all_but_trainer_leads():
    for cap, roles in CAPS.items():
        assert roles, cap
        assert Role.OWNER in roles or cap == Cap.LEADS_OWN, cap


async def test_me_lists_capabilities(client: AsyncClient, owner: Account):
    staff = await team(client, owner)
    for role, acct in staff.items():
        me = (await client.get("/api/auth/me", headers=acct.headers)).json()
        assert me["role"] == role
        assert me["capabilities"] == capabilities(Role(role))
    sales = (await client.get("/api/auth/me", headers=staff["sales"].headers)).json()
    assert "leads" in sales["capabilities"] and "members_view" not in sales["capabilities"]


# endpoint -> roles that may call it. Anyone else must get 403.
GET_MATRIX = {
    "/api/members": {"owner", "manager", "front_desk", "trainer"},
    "/api/payments": {"owner", "manager", "front_desk"},
    "/api/finance/dues": {"owner", "manager", "front_desk"},
    "/api/finance/summary": {"owner", "manager"},
    "/api/analytics": {"owner", "manager"},
    "/api/exports/members.csv": {"owner", "manager"},
    "/api/imports": {"owner", "manager"},
    "/api/audit": {"owner"},
    "/api/reminders/due": {"owner", "manager", "front_desk"},
    "/api/leads": set(ROLES),  # trainers see only their own
    "/api/invites": {"owner", "manager"},
    "/api/plans": set(ROLES),
    "/api/staff": set(ROLES),
    "/api/branches": set(ROLES),
}


@pytest.mark.parametrize("url", sorted(GET_MATRIX))
async def test_role_matrix(client: AsyncClient, owner: Account, url: str):
    staff = await team(client, owner)
    for role, acct in staff.items():
        res = await client.get(url, headers=acct.headers)
        if role in GET_MATRIX[url]:
            assert res.status_code == 200, (url, role, res.text)
        else:
            assert res.status_code == 403, (url, role, res.status_code)


# --- Trainers see their own members only --------------------------------------


async def test_trainer_sees_only_assigned_members_without_money(
    client: AsyncClient, owner: Account
):
    plan = await make_plan(client, owner)
    coach = await make_staff(client, owner, "trainer")
    coach2 = await make_staff(client, owner, "trainer")
    mine = await make_member(
        client,
        owner,
        phone="9000000001",
        trainer_id=coach.user_id,
        membership={"plan_id": plan["id"]},
    )
    other = await make_member(client, owner, phone="9000000002", trainer_id=coach2.user_id)
    await make_member(client, owner, phone="9000000003")  # nobody's

    res = await client.get("/api/members", headers=coach.headers)
    assert [m["id"] for m in res.json()["items"]] == [mine["id"]]
    assert (await client.get("/api/members/counts", headers=coach.headers)).json()["all"] == 1
    assert (
        await client.get(f"/api/members/{other['id']}", headers=coach.headers)
    ).status_code == 404

    detail = (await client.get(f"/api/members/{mine['id']}", headers=coach.headers)).json()
    ms = detail["memberships"][0]
    assert all(ms[k] is None for k in ("price", "total", "paid", "balance", "joining_fee"))
    full = (await client.get(f"/api/members/{mine['id']}", headers=owner.headers)).json()
    assert full["memberships"][0]["total"] is not None

    # Their rights end at viewing: no edits, check-ups only on their own clients.
    res = await client.patch(
        f"/api/members/{mine['id']}", json={"notes": "x"}, headers=coach.headers
    )
    assert res.status_code == 403
    res = await client.post(
        f"/api/members/{other['id']}/checkups", json={"weight_kg": 70}, headers=coach.headers
    )
    assert res.status_code == 404
    res = await client.post(
        f"/api/members/{mine['id']}/checkups", json={"weight_kg": 70}, headers=coach.headers
    )
    assert res.status_code == 201
    due = (await client.get("/api/checkups/due?scope=all", headers=coach.headers)).json()
    assert {d["member_id"] for d in due["items"]} <= {mine["id"]}


# --- Branch scoping --------------------------------------------------------------


async def test_branch_bound_staff_see_their_branch_and_unassigned_members(
    client: AsyncClient, owner: Account
):
    main = (await client.get("/api/branches", headers=owner.headers)).json()[0]
    other_branch = (
        await client.post("/api/branches", json={"name": "Downtown"}, headers=owner.headers)
    ).json()
    desk = await make_staff(client, owner, "front_desk", branch_id=main["id"])
    here = await make_member(client, owner, phone="9000000001", branch_id=main["id"])
    away = await make_member(client, owner, phone="9000000002", branch_id=other_branch["id"])
    nowhere = await make_member(client, owner, phone="9000000003")
    # New members default to their creator's branch; clear it to get a member with no branch.
    await client.patch(
        f"/api/members/{nowhere['id']}", json={"branch_id": None}, headers=owner.headers
    )
    assert (await client.get(f"/api/members/{nowhere['id']}", headers=owner.headers)).json()[
        "branch_id"
    ] is None

    ids = {
        m["id"] for m in (await client.get("/api/members", headers=desk.headers)).json()["items"]
    }
    assert here["id"] in ids and away["id"] not in ids
    assert (await client.get(f"/api/members/{away['id']}", headers=desk.headers)).status_code == 404
    assert (
        await client.get(f"/api/members/{nowhere['id']}", headers=desk.headers)
    ).status_code == 200
    # Owners are never limited to a branch.
    assert len((await client.get("/api/members", headers=owner.headers)).json()["items"]) == 3


async def test_branch_bound_manager_analytics_and_exports(client: AsyncClient, owner: Account):
    main = (await client.get("/api/branches", headers=owner.headers)).json()[0]
    manager = await make_staff(client, owner, "manager", branch_id=main["id"])
    res = await client.get("/api/analytics", headers=manager.headers)
    assert res.status_code == 200
    assert (
        await client.get("/api/exports/members.csv", headers=manager.headers)
    ).status_code == 403
    assert (await client.get("/api/exports/members.csv", headers=owner.headers)).status_code == 200


# --- Assigning trainers ----------------------------------------------------------


async def test_only_coaches_can_be_assigned_as_trainer(client: AsyncClient, owner: Account):
    desk = await make_staff(client, owner, "front_desk")
    sales = await make_staff(client, owner, "sales")
    manager = await make_staff(client, owner, "manager")
    member = await make_member(client, owner)
    for not_a_coach in (desk, sales):
        res = await client.patch(
            f"/api/members/{member['id']}",
            json={"trainer_id": not_a_coach.user_id},
            headers=owner.headers,
        )
        assert res.status_code == 422
    res = await client.patch(
        f"/api/members/{member['id']}", json={"trainer_id": manager.user_id}, headers=owner.headers
    )
    assert res.status_code == 200


async def test_bulk_assign_trainer(client: AsyncClient, owner: Account):
    manager = await make_staff(client, owner, "manager")
    coach = await make_staff(client, owner, "trainer")
    a = await make_member(client, owner, phone="9000000001")
    b = await make_member(client, owner, phone="9000000002")
    body = {"member_ids": [a["id"], b["id"]], "trainer_id": coach.user_id}

    assert (
        await client.post("/api/members/assign-trainer", json=body, headers=coach.headers)
    ).status_code == 403
    res = await client.post("/api/members/assign-trainer", json=body, headers=manager.headers)
    assert res.status_code == 200 and res.json() == {"updated": 2}
    assert len((await client.get("/api/members", headers=coach.headers)).json()["items"]) == 2
    # Unassign.
    body["trainer_id"] = None
    await client.post("/api/members/assign-trainer", json=body, headers=manager.headers)
    assert (await client.get("/api/members", headers=coach.headers)).json()["items"] == []


# --- Staff management ---------------------------------------------------------------


async def test_manager_can_only_manage_staff_below_them(client: AsyncClient, owner: Account):
    manager = await make_staff(client, owner, "manager")
    peer = await make_staff(client, owner, "manager")
    coach = await make_staff(client, owner, "trainer")
    h = manager.headers

    for role in ("manager", "owner"):
        res = await client.post(
            "/api/invites", json={"email": f"{role}@x.com", "role": role}, headers=h
        )
        assert res.status_code == 403, role
    assert (
        await client.post("/api/invites", json={"email": "ok@x.com", "role": "sales"}, headers=h)
    ).status_code == 201

    staff = {s["user_id"]: s for s in (await client.get("/api/staff", headers=h)).json()}
    coach_row, peer_row, owner_row = staff[coach.user_id], staff[peer.user_id], staff[owner.user_id]
    # Allowed: change a trainer's phone, move them to front desk.
    res = await client.patch(
        f"/api/staff/{coach_row['id']}", json={"phone": "99000 11111"}, headers=h
    )
    assert res.status_code == 200 and res.json()["phone"] == "99000 11111"
    assert (
        await client.patch(f"/api/staff/{coach_row['id']}", json={"role": "front_desk"}, headers=h)
    ).status_code == 200
    # Not allowed: promote to manager, touch a peer or the owner.
    assert (
        await client.patch(f"/api/staff/{coach_row['id']}", json={"role": "manager"}, headers=h)
    ).status_code == 403
    assert (
        await client.patch(f"/api/staff/{peer_row['id']}", json={"role": "trainer"}, headers=h)
    ).status_code == 403
    assert (await client.delete(f"/api/staff/{owner_row['id']}", headers=h)).status_code == 403
    assert (
        await client.post(f"/api/staff/{peer_row['id']}/deactivate", json={}, headers=h)
    ).status_code == 403
    # Front desk, sales and trainers can't manage staff at all.
    for role in ("front_desk", "sales", "trainer"):
        other = await make_staff(client, owner, role)
        assert (await client.get("/api/invites", headers=other.headers)).status_code == 403


async def test_deactivate_and_reactivate_staff(client: AsyncClient, owner: Account):
    coach = await make_staff(client, owner, "trainer", email="coach@a.com")
    heir = await make_staff(client, owner, "trainer")
    member = await make_member(client, owner, trainer_id=coach.user_id)
    lead = (
        await client.post(
            "/api/leads",
            json={"name": "Walk In", "phone": "9111111111", "assigned_to": coach.user_id},
            headers=owner.headers,
        )
    ).json()
    row = next(
        s
        for s in (await client.get("/api/staff", headers=owner.headers)).json()
        if s["user_id"] == coach.user_id
    )

    res = await client.post(
        f"/api/staff/{row['id']}/deactivate",
        json={"reassign_members_to": heir.user_id, "reassign_leads_to": heir.user_id},
        headers=owner.headers,
    )
    assert res.status_code == 200 and res.json()["is_active"] is False
    # Their clients and leads moved; they themselves are locked out right away.
    assert (await client.get(f"/api/members/{member['id']}", headers=heir.headers)).json()[
        "trainer"
    ]["id"] == heir.user_id
    assert (await client.get(f"/api/leads/{lead['id']}", headers=heir.headers)).json()[
        "assigned_to"
    ]["id"] == heir.user_id
    assert (await client.get("/api/members", headers=coach.headers)).status_code == 401
    login = await client.post(
        "/api/auth/login", json={"email": "coach@a.com", "password": "staffpass1"}
    )
    assert login.status_code == 403
    # They can't be picked as a trainer or lead owner while inactive.
    res = await client.patch(
        f"/api/members/{member['id']}", json={"trainer_id": coach.user_id}, headers=owner.headers
    )
    assert res.status_code == 404
    # Inactive staff are listed after active ones.
    listed = (await client.get("/api/staff", headers=owner.headers)).json()
    assert listed[-1]["user_id"] == coach.user_id and listed[-1]["is_active"] is False

    res = await client.post(f"/api/staff/{row['id']}/reactivate", headers=owner.headers)
    assert res.status_code == 200 and res.json()["is_active"] is True
    assert (await client.get("/api/members", headers=coach.headers)).status_code == 200


async def test_cannot_deactivate_yourself_or_the_last_owner(client: AsyncClient, owner: Account):
    staff = (await client.get("/api/staff", headers=owner.headers)).json()
    me = staff[0]
    res = await client.post(f"/api/staff/{me['id']}/deactivate", json={}, headers=owner.headers)
    assert res.status_code == 409


async def test_staff_can_edit_their_own_phone_and_resend_invites(
    client: AsyncClient, owner: Account
):
    coach = await make_staff(client, owner, "trainer")
    res = await client.patch("/api/auth/me", json={"phone": " 98765 43210 "}, headers=coach.headers)
    assert res.status_code == 200 and res.json()["user"]["phone"] == "98765 43210"

    inv = (
        await client.post(
            "/api/invites", json={"email": "new@a.com", "role": "sales"}, headers=owner.headers
        )
    ).json()
    old_token = inv["url"].rsplit("/", 1)[-1]
    res = await client.post(f"/api/invites/{inv['id']}/resend", headers=owner.headers)
    assert res.status_code == 200
    new_token = res.json()["url"].rsplit("/", 1)[-1]
    assert new_token != old_token
    assert (await client.get(f"/api/auth/invites/{old_token}")).status_code == 404
    assert (await client.get(f"/api/auth/invites/{new_token}")).status_code == 200
