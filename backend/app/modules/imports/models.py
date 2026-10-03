import enum
import uuid
from datetime import datetime

from sqlalchemy import JSON, Enum, ForeignKey, Integer, String, Text, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, IdMixin, TenantMixin, TimestampMixin, UTCDateTime


def _enum(e: type[enum.StrEnum]) -> Enum:
    return Enum(e, native_enum=False, length=20, values_callable=lambda x: [m.value for m in x])


class ImportEntity(enum.StrEnum):
    MEMBERS = "members"
    LEADS = "leads"
    PAYMENTS = "payments"
    CHECKUPS = "checkups"
    PLANS = "plans"


class ImportStatus(enum.StrEnum):
    UPLOADED = "uploaded"  # file parsed, waiting for mapping
    READY = "ready"  # mapping checked (dry run done)
    RUNNING = "running"
    DONE = "done"
    FAILED = "failed"


class DuplicateMode(enum.StrEnum):
    SKIP = "skip"  # leave existing records alone
    UPDATE = "update"  # fill in / overwrite fields from the file


class DateOrder(enum.StrEnum):
    DMY = "dmy"  # 31/12/2026 (India, UK)
    MDY = "mdy"  # 12/31/2026 (US)
    YMD = "ymd"  # 2026-12-31


class ImportJob(IdMixin, TenantMixin, TimestampMixin, Base):
    __tablename__ = "import_jobs"

    entity: Mapped[ImportEntity] = mapped_column(_enum(ImportEntity))
    status: Mapped[ImportStatus] = mapped_column(_enum(ImportStatus), default=ImportStatus.UPLOADED)
    filename: Mapped[str] = mapped_column(String(255))
    storage_key: Mapped[str] = mapped_column(String(300))
    columns: Mapped[list] = mapped_column(JSON, default=list)  # header names in the file
    total_rows: Mapped[int] = mapped_column(Integer, default=0)

    mapping: Mapped[dict] = mapped_column(JSON, default=dict)  # field key -> column name
    duplicate_mode: Mapped[DuplicateMode] = mapped_column(
        _enum(DuplicateMode), default=DuplicateMode.SKIP
    )
    date_order: Mapped[DateOrder] = mapped_column(_enum(DateOrder), default=DateOrder.DMY)

    created: Mapped[int] = mapped_column(Integer, default=0)
    updated: Mapped[int] = mapped_column(Integer, default=0)
    skipped: Mapped[int] = mapped_column(Integer, default=0)
    failed: Mapped[int] = mapped_column(Integer, default=0)
    processed: Mapped[int] = mapped_column(Integer, default=0)
    error: Mapped[str | None] = mapped_column(Text)  # job-level failure
    error_file_key: Mapped[str | None] = mapped_column(String(300))  # CSV of failed rows

    created_by: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL")
    )
    finished_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
