"""attendance: visits, scanner devices, and the member's device number

Revision ID: c4a92e7f10d3
Revises: b81f4c2d9e07
Create Date: 2026-10-13 13:00:00

A member has at most one visit per day (their first). `devices` are scanners/turnstiles that
report punches with an API key (only its hash is stored).
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "c4a92e7f10d3"
down_revision: Union[str, Sequence[str], None] = "b81f4c2d9e07"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "devices",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("gym_id", sa.Uuid(), nullable=False),
        sa.Column("branch_id", sa.Uuid(), nullable=True),
        sa.Column("name", sa.String(length=80), nullable=False),
        sa.Column("api_key_hash", sa.String(length=64), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["branch_id"], ["branches.id"], name=op.f("fk_devices_branch_id_branches"), ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(
            ["gym_id"], ["gyms.id"], name=op.f("fk_devices_gym_id_gyms"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_devices")),
        sa.UniqueConstraint("api_key_hash", name=op.f("uq_devices_api_key_hash")),
    )
    op.create_index(op.f("ix_devices_gym_id"), "devices", ["gym_id"])

    op.create_table(
        "attendance",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("gym_id", sa.Uuid(), nullable=False),
        sa.Column("member_id", sa.Uuid(), nullable=False),
        sa.Column("branch_id", sa.Uuid(), nullable=True),
        sa.Column("checked_in_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("local_date", sa.Date(), nullable=False),
        sa.Column("source", sa.String(length=20), nullable=False),
        sa.Column("device_id", sa.Uuid(), nullable=True),
        sa.Column("device_ref", sa.String(length=100), nullable=True),
        sa.Column("recorded_by", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["branch_id"], ["branches.id"], name=op.f("fk_attendance_branch_id_branches"), ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(
            ["device_id"], ["devices.id"], name=op.f("fk_attendance_device_id_devices"), ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(
            ["gym_id"], ["gyms.id"], name=op.f("fk_attendance_gym_id_gyms"), ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["member_id"], ["members.id"], name=op.f("fk_attendance_member_id_members"), ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["recorded_by"], ["users.id"], name=op.f("fk_attendance_recorded_by_users"), ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_attendance")),
        sa.UniqueConstraint("gym_id", "member_id", "local_date", name=op.f("uq_attendance_gym_id")),
        sa.UniqueConstraint("device_id", "device_ref", name=op.f("uq_attendance_device_id")),
    )
    op.create_index(op.f("ix_attendance_gym_id"), "attendance", ["gym_id"])
    op.create_index(op.f("ix_attendance_member_id"), "attendance", ["member_id"])
    op.create_index("ix_attendance_gym_id_local_date", "attendance", ["gym_id", "local_date"])

    with op.batch_alter_table("members", schema=None) as batch_op:
        batch_op.add_column(sa.Column("device_user_id", sa.String(length=40), nullable=True))
        batch_op.create_unique_constraint(
            "uq_members_gym_id_device_user_id", ["gym_id", "device_user_id"]
        )


def downgrade() -> None:
    with op.batch_alter_table("members", schema=None) as batch_op:
        batch_op.drop_constraint("uq_members_gym_id_device_user_id", type_="unique")
        batch_op.drop_column("device_user_id")

    op.drop_index("ix_attendance_gym_id_local_date", table_name="attendance")
    op.drop_index(op.f("ix_attendance_member_id"), table_name="attendance")
    op.drop_index(op.f("ix_attendance_gym_id"), table_name="attendance")
    op.drop_table("attendance")
    op.drop_index(op.f("ix_devices_gym_id"), table_name="devices")
    op.drop_table("devices")
