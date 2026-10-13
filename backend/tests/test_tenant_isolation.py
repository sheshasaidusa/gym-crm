"""The most important guarantee: one gym can never see or change another gym's data."""

from httpx import AsyncClient

from tests.conftest import Account


async def test_gym_settings_are_per_tenant(
    client: AsyncClient, owner: Account, other_owner: Account
):
    a = (await client.get("/api/gym", headers=owner.headers)).json()
    b = (await client.get("/api/gym", headers=other_owner.headers)).json()
    assert a["id"] == owner.gym_id and b["id"] == other_owner.gym_id
    assert a["name"] == "Gym A" and b["name"] == "Gym B"


async def test_cannot_touch_other_gyms_branches(
    client: AsyncClient, owner: Account, other_owner: Account
):
    b_branch = (await client.get("/api/branches", headers=other_owner.headers)).json()[0]
    a_branches = (await client.get("/api/branches", headers=owner.headers)).json()
    assert b_branch["id"] not in {b["id"] for b in a_branches}

    url = f"/api/branches/{b_branch['id']}"
    assert (
        await client.patch(url, json={"name": "pwned"}, headers=owner.headers)
    ).status_code == 404
    assert (await client.delete(url, headers=owner.headers)).status_code == 404


async def test_cannot_touch_other_gyms_staff_or_invites(
    client: AsyncClient, owner: Account, other_owner: Account
):
    b_staff = (await client.get("/api/staff", headers=other_owner.headers)).json()[0]
    a_staff = (await client.get("/api/staff", headers=owner.headers)).json()
    assert b_staff["id"] not in {s["id"] for s in a_staff}

    url = f"/api/staff/{b_staff['id']}"
    assert (
        await client.patch(url, json={"role": "trainer"}, headers=owner.headers)
    ).status_code == 404
    assert (await client.delete(url, headers=owner.headers)).status_code == 404

    inv = await client.post(
        "/api/invites", json={"email": "t@b.com", "role": "trainer"}, headers=other_owner.headers
    )
    assert (await client.get("/api/invites", headers=owner.headers)).json() == []
    res = await client.delete(f"/api/invites/{inv.json()['id']}", headers=owner.headers)
    assert res.status_code == 404


async def test_cannot_assign_other_gyms_branch(
    client: AsyncClient, owner: Account, other_owner: Account
):
    b_branch = (await client.get("/api/branches", headers=other_owner.headers)).json()[0]
    res = await client.post(
        "/api/invites",
        json={"email": "t@a.com", "role": "trainer", "branch_id": b_branch["id"]},
        headers=owner.headers,
    )
    assert res.status_code == 404


async def test_cannot_switch_into_other_gym(
    client: AsyncClient, owner: Account, other_owner: Account
):
    res = await client.post(
        "/api/auth/switch-gym", json={"gym_id": other_owner.gym_id}, headers=owner.headers
    )
    assert res.status_code == 403
    res = await client.post(
        "/api/auth/login",
        json={"email": "owner@a.com", "password": "supersecret1", "gym_id": other_owner.gym_id},
    )
    assert res.status_code == 403


async def test_plans_members_and_memberships_are_isolated(
    client: AsyncClient, owner: Account, other_owner: Account
):
    from tests.helpers import make_member, make_plan

    b_plan = await make_plan(client, other_owner)
    b_member = await make_member(client, other_owner, membership={"plan_id": b_plan["id"]})
    b_ms = b_member["memberships"][0]["id"]
    h = owner.headers

    assert (await client.get("/api/plans", headers=h)).json() == []
    assert (await client.get("/api/members", headers=h)).json()["total"] == 0
    assert (await client.get("/api/members/counts", headers=h)).json()["all"] == 0

    assert (await client.get(f"/api/plans/{b_plan['id']}", headers=h)).status_code == 404
    res = await client.patch(f"/api/plans/{b_plan['id']}", json={"price": 1}, headers=h)
    assert res.status_code == 404
    assert (await client.get(f"/api/members/{b_member['id']}", headers=h)).status_code == 404
    res = await client.patch(f"/api/members/{b_member['id']}", json={"name": "pwned"}, headers=h)
    assert res.status_code == 404
    assert (await client.delete(f"/api/members/{b_member['id']}", headers=h)).status_code == 404
    res = await client.post(f"/api/members/{b_member['id']}/preview-link", headers=h)
    assert res.status_code == 404
    for action in ("cancel", "unfreeze"):
        assert (
            await client.post(f"/api/memberships/{b_ms}/{action}", headers=h)
        ).status_code == 404

    # Can't sell another gym's plan or point at its staff, even on your own member.
    mine = await make_member(client, owner, phone="9111111111")
    res = await client.post(
        f"/api/members/{mine['id']}/memberships", json={"plan_id": b_plan["id"]}, headers=h
    )
    assert res.status_code == 404
    res = await client.patch(
        f"/api/members/{mine['id']}", json={"trainer_id": other_owner.user_id}, headers=h
    )
    assert res.status_code == 404

    # Same phone number is fine in a different gym.
    await make_member(client, owner, phone=b_member["phone"], name="Same Phone")


async def test_new_staff_endpoints_do_not_cross_gyms(
    client: AsyncClient, owner: Account, other_owner: Account
):
    from tests.helpers import make_member, make_staff

    victim_member = await make_member(client, other_owner)
    victim_coach = await make_staff(client, other_owner, "trainer")
    my_coach = await make_staff(client, owner, "trainer")
    victim_row = next(
        s
        for s in (await client.get("/api/staff", headers=other_owner.headers)).json()
        if s["user_id"] == victim_coach.user_id
    )

    # Bulk-assigning another gym's member touches nothing.
    res = await client.post(
        "/api/members/assign-trainer",
        json={"member_ids": [victim_member["id"]], "trainer_id": my_coach.user_id},
        headers=owner.headers,
    )
    assert res.status_code == 200 and res.json() == {"updated": 0}
    # Another gym's staff row is invisible to every staff action.
    for path in ("deactivate", "reactivate"):
        res = await client.post(
            f"/api/staff/{victim_row['id']}/{path}", json={}, headers=owner.headers
        )
        assert res.status_code == 404, path
    res = await client.patch(
        f"/api/staff/{victim_row['id']}", json={"role": "manager"}, headers=owner.headers
    )
    assert res.status_code == 404
    # ...and other gyms' staff can't be named as a reassignment target.
    mine = next(
        s
        for s in (await client.get("/api/staff", headers=owner.headers)).json()
        if s["user_id"] == my_coach.user_id
    )
    res = await client.post(
        f"/api/staff/{mine['id']}/deactivate",
        json={"reassign_members_to": victim_coach.user_id},
        headers=owner.headers,
    )
    assert res.status_code == 404
