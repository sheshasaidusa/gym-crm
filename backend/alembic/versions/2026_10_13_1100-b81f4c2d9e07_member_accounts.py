"""member app: member_accounts (phone + PIN login)

Revision ID: b81f4c2d9e07
Revises: ac3ddb4b1e7d
Create Date: 2026-10-13 11:00:00

One row per member, created when staff first send an activation link. Kept out of `members`
so the PIN hash can never leak through a member response.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "b81f4c2d9e07"
down_revision: Union[str, Sequence[str], None] = "ac3ddb4b1e7d"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "member_accounts",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("gym_id", sa.Uuid(), nullable=False),
        sa.Column("member_id", sa.Uuid(), nullable=False),
        sa.Column("pin_hash", sa.String(length=255), nullable=True),
        sa.Column("activation_token_hash", sa.String(length=64), nullable=True),
        sa.Column("activation_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("failed_attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("locked_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("token_version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("activated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("disabled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["gym_id"], ["gyms.id"], name=op.f("fk_member_accounts_gym_id_gyms"), ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["member_id"],
            ["members.id"],
            name=op.f("fk_member_accounts_member_id_members"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_member_accounts")),
        sa.UniqueConstraint("member_id", name=op.f("uq_member_accounts_member_id")),
    )
    op.create_index(op.f("ix_member_accounts_gym_id"), "member_accounts", ["gym_id"])
    op.create_index(
        op.f("ix_member_accounts_activation_token_hash"),
        "member_accounts",
        ["activation_token_hash"],
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_member_accounts_activation_token_hash"), table_name="member_accounts")
    op.drop_index(op.f("ix_member_accounts_gym_id"), table_name="member_accounts")
    op.drop_table("member_accounts")
