import uuid
from datetime import date

from sqlalchemy import JSON, Date, ForeignKey, Index, Integer, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, IdMixin, TenantMixin, TimestampMixin


class WorkoutSession(IdMixin, TenantMixin, TimestampMixin, Base):
    """One workout a member logged from the app: what they did, set by set."""

    __tablename__ = "workout_sessions"
    __table_args__ = (
        Index("ix_workout_sessions_member_id_performed_on", "member_id", "performed_on"),
    )

    member_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("members.id", ondelete="CASCADE"))
    # The plan they were following, if any. Kept loosely: replacing the plan must not erase history.
    plan_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("ai_plans.id", ondelete="SET NULL")
    )
    day_label: Mapped[str | None] = mapped_column(String(120))  # "Day 2 – Upper body"
    performed_on: Mapped[date] = mapped_column(Date)
    duration_min: Mapped[int | None] = mapped_column(Integer)
    notes: Mapped[str | None] = mapped_column(String(500))
    # [{exercise, from_plan, sets: [{reps, weight_kg}]}], checked by WorkoutEntry on the way in.
    # ponytail: JSON, not a table per set. Progress is computed in Python over a member's own
    # sessions (tens, not millions); split into rows only if cross-member exercise analytics appear.
    entries: Mapped[list] = mapped_column(JSON, default=list)
