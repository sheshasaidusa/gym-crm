"""Pieces of the "who is due a check-up" query, shared by the due list and the dashboards."""

import uuid
from datetime import date

from sqlalchemy import func, select

from app.modules.checkups.models import CheckUp
from app.modules.members.models import Membership


def last_checkup(gym_id: uuid.UUID):
    """Subquery of (member_id, last_on): the date of each member's latest check-up."""
    return (
        select(CheckUp.member_id, func.max(CheckUp.recorded_on).label("last_on"))
        .where(CheckUp.gym_id == gym_id)
        .group_by(CheckUp.member_id)
        .subquery()
    )


def running_member_ids(gym_id: uuid.UUID, today: date):
    """Members with a membership that is running today (frozen ones included)."""
    return (
        select(Membership.member_id)
        .where(
            Membership.gym_id == gym_id,
            Membership.cancelled_at.is_(None),
            Membership.start_date <= today,
            Membership.end_date >= today,
        )
        .distinct()
    )


def is_due(last, cutoff: date):
    """Never checked up, or last checked up on/before `cutoff`."""
    return (last.c.last_on.is_(None)) | (last.c.last_on <= cutoff)
