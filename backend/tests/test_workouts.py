"""Workout logging: the maths, the edit window, ownership and the plan template."""

import uuid
from datetime import date, timedelta

from httpx import AsyncClient

from app.core.db import utcnow
from app.modules.ai_plans.models import AIPlan, PlanStatus
from app.modules.workouts.schemas import PersonalRecord, WorkoutEntry, WorkoutSet
from app.modules.workouts.service import _better, _start_reps, volume_kg
from tests.conftest import Account
from tests.helpers import days, make_member, make_staff, today
from tests.test_ai_plans import sample_plan
from tests.test_member_app import activate, link


def entry(name: str, *sets: tuple[int, float | None], from_plan=False) -> dict:
    return {
        "exercise": name,
        "from_plan": from_plan,
        "sets": [{"reps": r, "weight_kg": w} for r, w in sets],
    }


async def member_logged_in(client: AsyncClient, owner: Account, **overrides) -> dict:
    member = await make_member(client, owner, **overrides)
    assert (await activate(client, await link(client, owner, member["id"]))).status_code == 200
    return member


async def log(client: AsyncClient, *entries: dict, **body):
    return await client.post("/api/m/workouts", json={"entries": list(entries), **body})


# --- The maths ----------------------------------------------------------------------------


def test_volume_ignores_bodyweight_sets():
    entries = [
        WorkoutEntry(
            exercise="Squat",
            sets=[WorkoutSet(reps=5, weight_kg=100), WorkoutSet(reps=5, weight_kg=90)],
        ),
        WorkoutEntry(exercise="Push-up", sets=[WorkoutSet(reps=20, weight_kg=None)]),
    ]
    assert volume_kg(entries) == 950.0


def test_personal_record_ordering():
    def rec(w, r, d=1):
        return PersonalRecord(exercise="x", weight_kg=w, reps=r, performed_on=date(2026, 1, d))

    assert _better(rec(100, 3), rec(90, 10))  # heavier beats more reps
    assert _better(rec(90, 8), rec(90, 6))  # same weight: more reps
    assert _better(rec(None, 25), rec(None, 20))  # bodyweight work: most reps
    assert _better(rec(90, 8, 5), rec(90, 8, 1))  # a tie goes to the later one
    assert not _better(rec(None, 30), rec(40, 1))  # weighted beats unweighted


def test_template_reps_parsing():
    assert _start_reps("8-10") == 8 and _start_reps("12") == 12 and _start_reps(" 10 – 12 ") == 10
    assert _start_reps("30 sec") == 0 and _start_reps("AMRAP") == 0


# --- Logging ------------------------------------------------------------------------------


async def test_log_edit_delete_and_validation(client: AsyncClient, owner: Account):
    await member_logged_in(client, owner)
    res = await log(
        client, entry("Bench press", (8, 60), (8, 60), (6, 65)), day_label="Day 1", duration_min=55
    )
    assert res.status_code == 201, res.text
    w = res.json()
    assert w["performed_on"] == today().isoformat() and w["editable"] is True
    assert w["volume_kg"] == 8 * 60 * 2 + 6 * 65 and w["entries"][0]["exercise"] == "Bench press"

    # Fix it.
    res = await client.patch(
        f"/api/m/workouts/{w['id']}",
        json={"entries": [entry("Bench press", (8, 62.5))], "notes": "Felt heavy"},
    )
    assert (
        res.status_code == 200
        and res.json()["volume_kg"] == 500.0
        and res.json()["notes"] == "Felt heavy"
    )

    # Bad input: no entries, no sets, silly numbers, future or too-old dates.
    assert (await client.post("/api/m/workouts", json={"entries": []})).status_code == 422
    assert (await log(client, {"exercise": "Squat", "sets": []})).status_code == 422
    assert (await log(client, entry("Squat", (5, -1)))).status_code == 422
    assert (await log(client, entry("Squat", (5000, 10)))).status_code == 422
    assert (await log(client, entry("Squat", (5, 10)), performed_on=days(1))).status_code == 422
    assert (await log(client, entry("Squat", (5, 10)), performed_on=days(-8))).status_code == 422
    assert (await log(client, entry("Squat", (5, 10)), performed_on=days(-3))).status_code == 201

    assert (await client.delete(f"/api/m/workouts/{w['id']}")).status_code == 204
    assert (await client.delete(f"/api/m/workouts/{w['id']}")).status_code == 404
    history = (await client.get("/api/m/workouts")).json()
    assert len(history["sessions"]) == 1 and history["progress"]["sessions_total"] == 1


async def test_edit_window_is_a_week(client: AsyncClient, owner: Account, sessions):
    member = await member_logged_in(client, owner)
    from app.modules.workouts.models import WorkoutSession

    async with sessions() as db:
        old = WorkoutSession(
            gym_id=uuid.UUID(owner.gym_id),
            member_id=uuid.UUID(member["id"]),
            performed_on=today() - timedelta(days=9),
            entries=[entry("Squat", (5, 100))],
        )
        db.add(old)
        await db.commit()
        old_id = str(old.id)
    listed = (await client.get("/api/m/workouts")).json()["sessions"][0]
    assert listed["editable"] is False
    assert (
        await client.patch(
            f"/api/m/workouts/{old_id}", json={"entries": [entry("Squat", (5, 105))]}
        )
    ).status_code == 409
    assert (await client.delete(f"/api/m/workouts/{old_id}")).status_code == 409


async def test_daily_cap(client: AsyncClient, owner: Account):
    await member_logged_in(client, owner)
    for _ in range(5):
        assert (await log(client, entry("Curl", (10, 10)))).status_code == 201
    assert (await log(client, entry("Curl", (10, 10)))).status_code == 409
    assert (await log(client, entry("Curl", (10, 10)), performed_on=days(-1))).status_code == 201


async def test_progress_records_volume_and_streak(client: AsyncClient, owner: Account):
    await member_logged_in(client, owner)
    await log(client, entry("Bench Press", (5, 60)), performed_on=days(-6))
    await log(
        client, entry("bench press", (5, 70), (8, 60)), performed_on=days(-2)
    )  # same lift, new PR
    await log(client, entry("Pull-up", (10, None)), performed_on=days(-1))
    await log(client, entry("Squat", (5, 100)))

    p = (await client.get("/api/m/workouts")).json()["progress"]
    assert p["sessions_total"] == 4 and p["sessions_30d"] == 4 and p["streak_weeks"] >= 1
    assert len(p["weeks"]) == 12 and sum(w["sessions"] for w in p["weeks"]) == 4
    assert round(sum(w["volume_kg"] for w in p["weeks"])) == 300 + (350 + 480) + 0 + 500
    records = {r["exercise"].lower(): r for r in p["records"]}
    assert records["bench press"]["weight_kg"] == 70 and records["bench press"]["reps"] == 5
    assert records["pull-up"]["weight_kg"] is None and records["pull-up"]["reps"] == 10
    assert records["squat"]["weight_kg"] == 100


async def test_ownership_and_staff_view(client: AsyncClient, owner: Account):
    coach = await make_staff(client, owner, "trainer")
    other_coach = await make_staff(client, owner, "trainer")
    mine = await member_logged_in(client, owner, phone="9000000001", trainer_id=coach.user_id)
    w = (await log(client, entry("Row", (10, 40)))).json()
    # Someone else's session isn't theirs to touch: a second member can't see or change it.
    client.cookies.clear()
    other = await make_member(client, owner, phone="9000000002", trainer_id=other_coach.user_id)
    await activate(client, await link(client, owner, other["id"]))
    assert (await client.get("/api/m/workouts")).json()["sessions"] == []
    assert (
        await client.patch(f"/api/m/workouts/{w['id']}", json={"entries": [entry("Row", (1, 1))]})
    ).status_code == 404
    assert (await client.delete(f"/api/m/workouts/{w['id']}")).status_code == 404
    client.cookies.clear()
    # Staff: the trainer sees their own client's log, not another trainer's.
    res = await client.get(f"/api/members/{mine['id']}/workouts", headers=coach.headers)
    assert res.status_code == 200 and len(res.json()["sessions"]) == 1
    assert (
        await client.get(f"/api/members/{mine['id']}/workouts", headers=other_coach.headers)
    ).status_code == 404
    sales = await make_staff(client, owner, "sales")
    assert (
        await client.get(f"/api/members/{mine['id']}/workouts", headers=sales.headers)
    ).status_code == 403
    # Staff tokens don't open the member routes, and the other way round.
    assert (await client.get("/api/m/workouts", headers=owner.headers)).status_code == 401


async def test_template_from_the_published_plan(client: AsyncClient, owner: Account, sessions):
    member = await member_logged_in(client, owner)
    assert (await client.get("/api/m/workouts/template")).json() == {
        "plan_id": None,
        "days": [],
        "day_label": None,
        "entries": [],
    }
    async with sessions() as db:
        plan = AIPlan(
            gym_id=uuid.UUID(owner.gym_id),
            member_id=uuid.UUID(member["id"]),
            version=1,
            status=PlanStatus.PUBLISHED,
            title="Plan",
            content=sample_plan(days=3).model_dump(),
            published_at=utcnow(),
        )
        db.add(plan)
        await db.commit()
        plan_id = str(plan.id)

    t = (await client.get("/api/m/workouts/template")).json()
    assert (
        t["plan_id"] == plan_id
        and t["days"] == ["Day 1", "Day 2", "Day 3"]
        and t["day_label"] == "Day 1"
    )
    (ex,) = t["entries"]
    assert ex["exercise"] == "Goblet squat" and ex["from_plan"] is True
    assert (
        ex["sets"] == [{"reps": 10, "weight_kg": None}] * 3 and ex["target"] == "3 x 10, rest 90s"
    )

    # After logging Day 1, the next offer is Day 2; a day can also be asked for by name.
    await log(client, entry("Goblet squat", (10, 20), from_plan=True), day_label="Day 1")
    assert (await client.get("/api/m/workouts/template")).json()["day_label"] == "Day 2"
    assert (await client.get("/api/m/workouts/template?day=Day 3")).json()["day_label"] == "Day 3"
    assert (await client.get("/api/m/workouts/template?day=Nope")).json()["day_label"] == "Day 2"
    logged = (await client.get("/api/m/workouts")).json()["sessions"][0]
    assert logged["day_label"] == "Day 1"


async def test_trainer_board_counts_clients_who_logged(client: AsyncClient, owner: Account):
    coach = await make_staff(client, owner, "trainer")
    await member_logged_in(client, owner, phone="9000000001", trainer_id=coach.user_id)
    await log(client, entry("Row", (10, 40)))
    client.cookies.clear()
    await make_member(client, owner, phone="9000000002", trainer_id=coach.user_id)
    board = (await client.get("/api/dashboard/trainer", headers=coach.headers)).json()
    assert board["clients"]["all"] == 2 and board["logged_7d"] == 1
