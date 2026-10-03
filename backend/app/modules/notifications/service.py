import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.gyms.models import Role, StaffMembership
from app.modules.notifications.models import Notification


async def notify_staff(
    db: AsyncSession,
    gym_id: uuid.UUID,
    *,
    roles: tuple[Role, ...],
    kind: str,
    title: str,
    body: str | None = None,
    link: str | None = None,
    dedupe_key: str | None = None,
    user_ids: list[uuid.UUID] | None = None,
) -> int:
    """Creates one notification per staff user with one of `roles`. Users who already
    have a notification with this dedupe_key are skipped. `user_ids` narrows it to those
    people (who must still be staff of this gym). Returns how many were created."""
    stmt = select(StaffMembership.user_id).where(
        StaffMembership.gym_id == gym_id, StaffMembership.role.in_(roles)
    )
    if user_ids is not None:
        stmt = stmt.where(StaffMembership.user_id.in_(user_ids))
    user_ids = list((await db.scalars(stmt)).all())
    if dedupe_key:
        already = set(
            (
                await db.scalars(
                    select(Notification.user_id).where(
                        Notification.gym_id == gym_id,
                        Notification.dedupe_key == dedupe_key,
                        Notification.user_id.in_(user_ids),
                    )
                )
            ).all()
        )
        user_ids = [u for u in user_ids if u not in already]
    for user_id in user_ids:
        db.add(
            Notification(
                gym_id=gym_id,
                user_id=user_id,
                kind=kind,
                title=title,
                body=body,
                link=link,
                dedupe_key=dedupe_key,
            )
        )
    await db.flush()
    return len(user_ids)
