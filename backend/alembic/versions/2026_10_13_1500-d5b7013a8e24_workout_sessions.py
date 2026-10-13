"""workout sessions: what members log from the app, set by set

Revision ID: d5b7013a8e24
Revises: c4a92e7f10d3
Create Date: 2026-10-13 15:00:00
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "d5b7013a8e24"
down_revision: Union[str, Sequence[str], None] = "c4a92e7f10d3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "workout_sessions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("gym_id", sa.Uuid(), nullable=False),
        sa.Column("member_id", sa.Uuid(), nullable=False),
        sa.Column("plan_id", sa.Uuid(), nullable=True),
        sa.Column("day_label", sa.String(length=120), nullable=True),
        sa.Column("performed_on", sa.Date(), nullable=False),
        sa.Column("duration_min", sa.Integer(), nullable=True),
        sa.Column("notes", sa.String(length=500), nullable=True),
        sa.Column("entries", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["gym_id"], ["gyms.id"], name=op.f("fk_workout_sessions_gym_id_gyms"), ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["member_id"],
            ["members.id"],
            name=op.f("fk_workout_sessions_member_id_members"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["plan_id"],
            ["ai_plans.id"],
            name=op.f("fk_workout_sessions_plan_id_ai_plans"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_workout_sessions")),
    )
    op.create_index(op.f("ix_workout_sessions_gym_id"), "workout_sessions", ["gym_id"])
    op.create_index(
        "ix_workout_sessions_member_id_performed_on",
        "workout_sessions",
        ["member_id", "performed_on"],
    )


def downgrade() -> None:
    op.drop_index("ix_workout_sessions_member_id_performed_on", table_name="workout_sessions")
    op.drop_index(op.f("ix_workout_sessions_gym_id"), table_name="workout_sessions")
    op.drop_table("workout_sessions")
