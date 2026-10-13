"""Workout logging maths: volume, weekly totals, personal records, and turning a plan day into
a ready-to-fill session."""

import re
from datetime import date, timedelta

from app.modules.ai_plans.content import PlanContent
from app.modules.attendance.service import streak_weeks
from app.modules.workouts.models import WorkoutSession
from app.modules.workouts.schemas import (
    PersonalRecord,
    TemplateEntry,
    WeekVolume,
    WorkoutEntry,
    WorkoutOut,
    WorkoutProgress,
    WorkoutSet,
    WorkoutTemplate,
)

EDIT_DAYS = 7  # members can add or fix a session for a week
MAX_PER_DAY = 5  # a sanity cap, not a rule anyone should meet
WEEKS = 12
RECORDS = 12


def volume_kg(entries: list[WorkoutEntry]) -> float:
    """Reps x weight over the weighted sets; bodyweight sets don't count towards volume."""
    return round(sum(s.reps * s.weight_kg for e in entries for s in e.sets if s.weight_kg), 1)


def to_out(session: WorkoutSession, today: date) -> WorkoutOut:
    entries = [WorkoutEntry.model_validate(e) for e in session.entries]
    return WorkoutOut(
        id=session.id,
        day_label=session.day_label,
        performed_on=session.performed_on,
        duration_min=session.duration_min,
        notes=session.notes,
        entries=entries,
        volume_kg=volume_kg(entries),
        editable=(today - session.performed_on).days <= EDIT_DAYS,
        created_at=session.created_at,
    )


def monday(d: date) -> date:
    return d - timedelta(days=d.weekday())


def progress(sessions: list[WorkoutSession], today: date) -> WorkoutProgress:
    """Weekly volume, streak and personal records over the sessions given (newest first or not)."""
    first_week = monday(today) - timedelta(weeks=WEEKS - 1)
    weeks = {first_week + timedelta(weeks=i): [0, 0.0] for i in range(WEEKS)}
    best: dict[str, tuple[PersonalRecord, bool]] = {}
    for s in sessions:
        entries = [WorkoutEntry.model_validate(e) for e in s.entries]
        wk = monday(s.performed_on)
        if wk in weeks:
            weeks[wk][0] += 1
            weeks[wk][1] += volume_kg(entries)
        for e in entries:
            for st in e.sets:
                key = e.exercise.lower()
                weighted = bool(st.weight_kg)
                cand = PersonalRecord(
                    exercise=e.exercise,
                    weight_kg=st.weight_kg if weighted else None,
                    reps=st.reps,
                    performed_on=s.performed_on,
                )
                if key not in best or _better(cand, best[key][0]):
                    best[key] = (cand, weighted)
    records = sorted(
        (r for r, _ in best.values() if r.reps > 0), key=lambda r: r.performed_on, reverse=True
    )
    return WorkoutProgress(
        sessions_total=len(sessions),
        sessions_30d=sum(1 for s in sessions if (today - s.performed_on).days < 30),
        streak_weeks=streak_weeks([s.performed_on for s in sessions], today),
        weeks=[
            WeekVolume(week_start=w, sessions=n, volume_kg=round(v, 1))
            for w, (n, v) in sorted(weeks.items())
        ],
        records=records[:RECORDS],
    )


def _better(new: PersonalRecord, old: PersonalRecord) -> bool:
    """Heavier wins; at the same weight (or bodyweight) more reps win; ties keep the later date."""
    if (new.weight_kg or 0) != (old.weight_kg or 0):
        return (new.weight_kg or 0) > (old.weight_kg or 0)
    if new.reps != old.reps:
        return new.reps > old.reps
    return new.performed_on > old.performed_on


_PLAIN_REPS = re.compile(r"^\s*(\d+)(?:\s*[-–]\s*\d+)?\s*$")


def _start_reps(reps: str) -> int:
    """ "8-10" -> 8; "12" -> 12; "30 sec" -> 0 (the member fills it in)."""
    m = _PLAIN_REPS.match(reps)
    return int(m.group(1)) if m else 0


def template(
    plan_id, plan: PlanContent | None, day: str | None, last_day_label: str | None
) -> WorkoutTemplate:
    """A plan day as a session to fill in; without `day`, the one after the last day logged."""
    if plan is None or not plan.weekly_schedule:
        return WorkoutTemplate(plan_id=None, days=[], day_label=None, entries=[])
    labels = [d.day for d in plan.weekly_schedule]
    if day not in labels:
        nxt = (labels.index(last_day_label) + 1) % len(labels) if last_day_label in labels else 0
        day = labels[nxt]
    picked = plan.weekly_schedule[labels.index(day)]
    return WorkoutTemplate(
        plan_id=plan_id,
        days=labels,
        day_label=day,
        entries=[
            TemplateEntry(
                exercise=ex.name,
                sets=[
                    WorkoutSet(reps=_start_reps(ex.reps), weight_kg=None)
                    for _ in range(max(1, min(ex.sets, 20)))
                ],
                target=f"{ex.sets} x {ex.reps}"
                + (f", rest {ex.rest_seconds}s" if ex.rest_seconds else ""),
                notes=ex.notes or None,
            )
            for ex in picked.exercises
        ],
    )
