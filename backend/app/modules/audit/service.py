import threading
import uuid
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import utcnow
from app.core.deps import TenantContext
from app.modules.audit.models import AuditLog


def _jsonable(v: Any) -> Any:
    if isinstance(v, Decimal):
        return float(v)
    if isinstance(v, uuid.UUID):
        return str(v)
    if isinstance(v, dict):
        return {k: _jsonable(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [_jsonable(x) for x in v]
    if hasattr(v, "isoformat"):
        return v.isoformat()
    return v


_last: datetime | None = None
_lock = threading.Lock()


def _timestamp() -> datetime:
    """Strictly increasing within this process, so entries keep the order they happened in
    even when the clock is coarse (Windows ticks every ~15 ms) or one request logs several."""
    global _last
    with _lock:
        now = utcnow()
        if _last is not None and now <= _last:
            now = _last + timedelta(microseconds=1)
        _last = now
        return now


def record(
    db: AsyncSession,
    ctx: TenantContext,
    action: str,
    summary: str,
    target_id: uuid.UUID | None = None,
    details: dict[str, Any] | None = None,
) -> None:
    """Adds an entry to the session; it's saved by the caller's commit."""
    db.add(
        AuditLog(
            gym_id=ctx.gym_id,
            created_at=_timestamp(),
            actor_id=ctx.user.id,
            actor_name=ctx.user.name,
            action=action,
            target_type=action.split(".", 1)[0],
            target_id=target_id,
            summary=summary[:300],
            details=_jsonable(details) if details else None,
        )
    )


def amount(v: Decimal) -> str:
    """1800 -> "1,800"; 1800.5 -> "1,800.50". Currency-neutral."""
    return f"{v:,.0f}" if v == v.to_integral_value() else f"{v:,.2f}"


def changes(before: dict[str, Any], after: dict[str, Any]) -> dict[str, list]:
    """{"field": [old, new]} for the fields that changed."""
    return {k: [before.get(k), v] for k, v in after.items() if before.get(k) != v}
