from datetime import UTC, datetime, timedelta

from httpx import AsyncClient

from app.modules.reminders.service import run_all_gyms
from tests.conftest import Account
from tests.helpers import make_member, make_plan, today
from tests.test_gym_and_staff import invite_and_accept


async def make_lead(client: AsyncClient, acct: Account, phone="9800000001", **body) -> dict:
    res = await client.post(
        "/api/leads", json={"name": "Kiran Rao", "phone": phone, **body}, headers=acct.headers
    )
    assert res.status_code == 201, res.text
    return res.json()


def iso(dt: datetime) -> str:
    return dt.isoformat()


async def test_create_lead_defaults_and_duplicates(client: AsyncClient, owner: Account):
    lead = await make_lead(client, owner, phone="+91 98000-00001", source="instagram")
    assert lead["stage"] == "new" and lead["source"] == "instagram"
    assert lead["phone"] == "+919800000001"
    assert lead["assigned_to"]["name"] == "Owner"  # creator by default
    assert [a["kind"] for a in lead["activities"]] == ["created"]

    res = await client.post(
        "/api/leads", json={"name": "Dup", "phone": "+919800000001"}, headers=owner.headers
    )
    assert res.status_code == 409 and "Kiran Rao" in res.json()["detail"]


async def test_pipeline_moves_and_activity_log(client: AsyncClient, owner: Account):
    lead = await make_lead(client, owner)
    url = f"/api/leads/{lead['id']}"
    h = owner.headers
    follow_up = datetime.now(UTC) + timedelta(days=1)

    # Logging a call on a new lead moves it to Contacted and sets the follow-up.
    res = await client.post(
        f"{url}/activities",
        json={
            "kind": "call",
            "content": "Interested in mornings",
            "next_follow_up_at": iso(follow_up),
        },
        headers=h,
    )
    body = res.json()
    assert body["stage"] == "contacted" and body["next_follow_up_at"]
    assert sorted(a["kind"] for a in body["activities"][:2]) == ["call", "stage"]

    trial = datetime.now(UTC) + timedelta(days=2)
    res = await client.post(
        f"{url}/stage", json={"stage": "trial_booked", "trial_at": iso(trial)}, headers=h
    )
    assert res.json()["stage"] == "trial_booked" and res.json()["trial_at"]

    assert (await client.post(f"{url}/stage", json={"stage": "lost"}, headers=h)).status_code == 422
    res = await client.post(
        f"{url}/stage", json={"stage": "lost", "lost_reason": "Too expensive"}, headers=h
    )
    body = res.json()
    assert body["stage"] == "lost" and body["lost_reason"] == "Too expensive"
    assert body["next_follow_up_at"] is None
    assert "Trial booked → Lost: Too expensive" in body["activities"][0]["content"]

    # Re-opening clears the reason; converting via /stage is refused.
    res = await client.post(f"{url}/stage", json={"stage": "contacted"}, headers=h)
    assert res.json()["lost_reason"] is None
    res = await client.post(f"{url}/stage", json={"stage": "converted"}, headers=h)
    assert res.status_code == 422


async def test_convert_to_member(client: AsyncClient, owner: Account):
    plan = await make_plan(client, owner)
    lead = await make_lead(
        client, owner, email="kiran@x.com", source="referral", interest="Weight loss"
    )
    res = await client.post(
        f"/api/leads/{lead['id']}/convert",
        json={"membership": {"plan_id": plan["id"], "discount": 100}},
        headers=owner.headers,
    )
    assert res.status_code == 200, res.text
    converted = res.json()
    assert converted["stage"] == "converted" and converted["converted_member_id"]

    member = (
        await client.get(f"/api/members/{converted['converted_member_id']}", headers=owner.headers)
    ).json()
    assert member["name"] == "Kiran Rao" and member["email"] == "kiran@x.com"
    assert member["status"] == "active" and member["memberships"][0]["discount"] == 100
    assert "Referral" in member["notes"] and "Weight loss" in member["notes"]

    again = await client.post(f"/api/leads/{lead['id']}/convert", json={}, headers=owner.headers)
    assert again.status_code == 409
    # Converted leads drop off the open board.
    assert (await client.get("/api/leads", headers=owner.headers)).json() == []
    closed = (await client.get("/api/leads?include_closed=true", headers=owner.headers)).json()
    assert [lead_["stage"] for lead_ in closed] == ["converted"]


async def test_convert_refuses_existing_member_phone(client: AsyncClient, owner: Account):
    await make_member(client, owner, phone="9800000001", name="Already Here")
    lead = await make_lead(client, owner)
    res = await client.post(f"/api/leads/{lead['id']}/convert", json={}, headers=owner.headers)
    assert res.status_code == 409 and "Already Here" in res.json()["detail"]


async def test_filters_and_stats(client: AsyncClient, owner: Account):
    coach = await invite_and_accept(client, owner, "coach@a.com", "trainer")
    past = datetime.now(UTC) - timedelta(hours=2)
    future = datetime.now(UTC) + timedelta(days=5)
    a = await make_lead(
        client,
        owner,
        phone="9800000001",
        name="Due Dev",
        source="instagram",
        next_follow_up_at=iso(past),
    )
    await make_lead(
        client,
        owner,
        phone="9800000002",
        name="Later Lara",
        source="walk_in",
        next_follow_up_at=iso(future),
        assigned_to=coach.user_id,
    )
    lost = await make_lead(client, owner, phone="9800000003", name="Lost Leo", source="instagram")
    await client.post(
        f"/api/leads/{lost['id']}/stage",
        json={"stage": "lost", "lost_reason": "Moved away"},
        headers=owner.headers,
    )
    conv = await make_lead(client, owner, phone="9800000004", name="Won Wes", source="instagram")
    await client.post(f"/api/leads/{conv['id']}/convert", json={}, headers=owner.headers)

    names = lambda res: [x["name"] for x in res.json()]  # noqa: E731
    h = owner.headers
    assert names(await client.get("/api/leads", headers=h)) == ["Due Dev", "Later Lara"]
    assert names(await client.get("/api/leads?due=true", headers=h)) == ["Due Dev"]
    assert names(await client.get("/api/leads?assigned=me", headers=coach.headers)) == [
        "Later Lara"
    ]
    assert names(await client.get("/api/leads?source=walk_in", headers=h)) == ["Later Lara"]
    assert names(await client.get("/api/leads?q=lara", headers=h)) == ["Later Lara"]

    stats = (await client.get("/api/leads/stats", headers=h)).json()
    assert stats["open"] == 2 and stats["follow_ups_due"] == 1
    assert stats["by_stage"]["lost"] == 1 and stats["by_stage"]["converted"] == 1
    assert stats["conversion_rate_90_days"] == 0.5
    assert stats["by_source_90_days"]["instagram"] == {"leads": 3, "converted": 1}
    assert a["id"]


async def test_follow_up_notifications(client: AsyncClient, owner: Account, sessions):
    coach = await invite_and_accept(client, owner, "coach@a.com", "trainer")
    past = iso(datetime.now(UTC) - timedelta(hours=1))
    await make_lead(
        client, owner, phone="9800000001", next_follow_up_at=past, assigned_to=coach.user_id
    )
    await make_lead(
        client, owner, phone="9800000002", next_follow_up_at=past, assigned_to=coach.user_id
    )
    unassigned = await make_lead(client, owner, phone="9800000003", next_follow_up_at=past)
    await client.patch(
        f"/api/leads/{unassigned['id']}", json={"assigned_to": None}, headers=owner.headers
    )

    d = today()
    late = datetime(d.year, d.month, d.day, 6, 0, tzinfo=UTC)  # 11:30 in Kolkata
    await run_all_gyms(sessions, now=late)
    await run_all_gyms(sessions, now=late)  # deduplicated

    coach_notes = (await client.get("/api/notifications", headers=coach.headers)).json()["items"]
    assert [n["title"] for n in coach_notes] == ["2 lead follow-ups due today"]
    owner_titles = [
        n["title"]
        for n in (await client.get("/api/notifications", headers=owner.headers)).json()["items"]
    ]
    assert owner_titles == ["1 unassigned lead follow-up due"]


async def test_public_lead_form(client: AsyncClient, owner: Account):
    h = owner.headers
    assert (await client.get("/api/leads/form-settings", headers=h)).json() == {
        "enabled": False,
        "url": None,
    }
    s = (await client.post("/api/leads/form-settings?enabled=true", headers=h)).json()
    token = s["url"].rsplit("/", 1)[-1]
    form = f"/api/public/lead-forms/{token}"

    client.cookies.clear()
    assert (await client.get(form)).json()["gym_name"] == "Gym A"
    res = await client.post(
        form, json={"name": "Web Visitor", "phone": "9811122233", "message": "Do you have yoga?"}
    )
    assert res.status_code == 202
    # Same phone again: no duplicate lead, note added instead.
    await client.post(
        form, json={"name": "Web Visitor", "phone": "98111 22233", "message": "Price?"}
    )
    # Bots that fill the honeypot are silently ignored.
    await client.post(
        form, json={"name": "Spam Bot", "phone": "9000000000", "website": "http://spam"}
    )

    leads = (await client.get("/api/leads", headers=h)).json()
    assert [x["name"] for x in leads] == ["Web Visitor"]
    lead = (await client.get(f"/api/leads/{leads[0]['id']}", headers=h)).json()
    assert lead["source"] == "website" and lead["interest"] == "Do you have yoga?"
    assert lead["next_follow_up_at"] is not None and lead["assigned_to"] is None
    assert [a["content"] for a in lead["activities"]] == [
        "Website form: Price?",
        "Website form: Do you have yoga?",
    ]
    titles = [
        n["title"] for n in (await client.get("/api/notifications", headers=h)).json()["items"]
    ]
    assert "New website enquiry: Web Visitor" in titles

    # Turning the form off (or issuing a new link) kills the old URL.
    await client.post("/api/leads/form-settings?enabled=true&new_link=true", headers=h)
    client.cookies.clear()
    assert (await client.get(form)).status_code == 404


async def test_roles_and_isolation(client: AsyncClient, owner: Account, other_owner: Account):
    trainer = await invite_and_accept(client, owner, "coach@a.com", "trainer")
    lead = await make_lead(client, owner)
    url = f"/api/leads/{lead['id']}"
    # Trainers work leads but can't convert or delete.
    res = await client.post(
        f"{url}/activities", json={"kind": "note", "content": "hi"}, headers=trainer.headers
    )
    assert res.status_code == 201
    assert (
        await client.post(f"{url}/convert", json={}, headers=trainer.headers)
    ).status_code == 403
    assert (await client.delete(url, headers=trainer.headers)).status_code == 403
    res = await client.post("/api/leads/form-settings?enabled=true", headers=trainer.headers)
    assert res.status_code == 403

    h = other_owner.headers
    assert (await client.get("/api/leads", headers=h)).json() == []
    assert (await client.get(url, headers=h)).status_code == 404
    assert (await client.patch(url, json={"name": "pwned"}, headers=h)).status_code == 404
    assert (
        await client.post(f"{url}/stage", json={"stage": "contacted"}, headers=h)
    ).status_code == 404
    res = await client.post(f"{url}/activities", json={"kind": "note", "content": "x"}, headers=h)
    assert res.status_code == 404
    assert (await client.post(f"{url}/convert", json={}, headers=h)).status_code == 404
    assert (await client.delete(url, headers=h)).status_code == 404
    # Can't assign another gym's staff, and the same phone is fine in another gym.
    res = await client.patch(url, json={"assigned_to": other_owner.user_id}, headers=owner.headers)
    assert res.status_code == 404
    await make_lead(client, other_owner, phone=lead["phone"])
    assert (await client.delete(url, headers=owner.headers)).status_code == 204
