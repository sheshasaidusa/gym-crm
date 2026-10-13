from sqlalchemy import Boolean, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, IdMixin, TimestampMixin


class User(IdMixin, TimestampMixin, Base):
    """A login identity. A user can be staff at several gyms via StaffMembership."""

    __tablename__ = "users"

    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(120))
    # Shown to members as their trainer's contact (call / WhatsApp).
    phone: Mapped[str | None] = mapped_column(String(30))
    password_hash: Mapped[str] = mapped_column(String(255))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
