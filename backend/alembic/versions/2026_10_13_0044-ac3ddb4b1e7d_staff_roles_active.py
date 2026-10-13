"""staff roles: deactivate staff per gym, staff phone, sales role

Revision ID: ac3ddb4b1e7d
Revises: a7c3e9d21b40
Create Date: 2026-10-13 00:44:20

The new `sales` role needs no DDL: roles are stored as a plain string (non-native enum
without a CHECK constraint).
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "ac3ddb4b1e7d"
down_revision: Union[str, Sequence[str], None] = "a7c3e9d21b40"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # The goals migration filled every row but left the column nullable; match the model.
    with op.batch_alter_table("members", schema=None) as batch_op:
        batch_op.alter_column("goals", existing_type=sa.JSON(), nullable=False)

    with op.batch_alter_table("staff_memberships", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("is_active", sa.Boolean(), server_default=sa.true(), nullable=False)
        )

    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.add_column(sa.Column("phone", sa.String(length=30), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.drop_column("phone")

    with op.batch_alter_table("staff_memberships", schema=None) as batch_op:
        batch_op.drop_column("is_active")

    with op.batch_alter_table("members", schema=None) as batch_op:
        batch_op.alter_column("goals", existing_type=sa.JSON(), nullable=True)
