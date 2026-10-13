"""member goals: one goal becomes a list of up to 3

Revision ID: a7c3e9d21b40
Revises: f8e41a7005b5
Create Date: 2026-10-06 12:00:00

"""
import json
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "a7c3e9d21b40"
down_revision: Union[str, Sequence[str], None] = "f8e41a7005b5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("members", schema=None) as batch_op:
        batch_op.add_column(sa.Column("goals", sa.JSON(), nullable=True))

    conn = op.get_bind()
    members = sa.table("members", sa.column("id"), sa.column("goal"), sa.column("goals", sa.JSON()))
    for row in conn.execute(sa.select(members.c.id, members.c.goal)).all():
        conn.execute(
            members.update()
            .where(members.c.id == row.id)
            .values(goals=[row.goal] if row.goal else [])
        )

    with op.batch_alter_table("members", schema=None) as batch_op:
        batch_op.drop_column("goal")


def downgrade() -> None:
    with op.batch_alter_table("members", schema=None) as batch_op:
        batch_op.add_column(sa.Column("goal", sa.String(length=20), nullable=True))

    conn = op.get_bind()
    members = sa.table("members", sa.column("id"), sa.column("goal"), sa.column("goals", sa.JSON()))
    for row in conn.execute(sa.select(members.c.id, members.c.goals)).all():
        goals = row.goals if isinstance(row.goals, list) else json.loads(row.goals or "[]")
        conn.execute(
            members.update().where(members.c.id == row.id).values(goal=goals[0] if goals else None)
        )

    with op.batch_alter_table("members", schema=None) as batch_op:
        batch_op.drop_column("goals")
