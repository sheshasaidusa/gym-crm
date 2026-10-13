import uuid
from datetime import datetime

from sqlalchemy import ForeignKey, Integer, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, IdMixin, TenantMixin, TimestampMixin, UTCDateTime


class MemberAccount(IdMixin, TenantMixin, TimestampMixin, Base):
    """A member's login for the member app (phone + PIN). Kept apart from `members` so the
    PIN hash can never leak through a member response. One row per member, created when
    staff first send an activation link."""

    __tablename__ = "member_accounts"

    member_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("members.id", ondelete="CASCADE"), unique=True
    )
    pin_hash: Mapped[str | None] = mapped_column(String(255))  # null until they set a PIN
    # Only the SHA-256 of the link token is stored, so a database leak can't activate accounts.
    activation_token_hash: Mapped[str | None] = mapped_column(String(64), index=True)
    activation_expires_at: Mapped[datetime | None] = mapped_column(UTCDateTime)

    failed_attempts: Mapped[int] = mapped_column(Integer, default=0)
    locked_until: Mapped[datetime | None] = mapped_column(UTCDateTime)
    # Bumped on every PIN reset or disable; tokens carry the value they were issued under.
    token_version: Mapped[int] = mapped_column(Integer, default=1)

    activated_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    last_login_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    disabled_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
