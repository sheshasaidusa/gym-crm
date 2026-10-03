"""Imports every model so SQLAlchemy metadata (and Alembic autogenerate) sees all tables."""

from app.core.db import Base
from app.modules.ai_plans.models import AIPlan
from app.modules.audit.models import AuditLog
from app.modules.auth.models import User
from app.modules.checkups.models import CheckUp, CheckUpPhoto
from app.modules.finance.models import Expense, Payment
from app.modules.gyms.models import Branch, Gym, Invite, StaffMembership
from app.modules.imports.models import ImportJob
from app.modules.leads.models import Lead, LeadActivity
from app.modules.members.models import Member, Membership
from app.modules.notifications.models import Notification
from app.modules.plans.models import Plan
from app.modules.reminders.models import ReminderLog

__all__ = [
    "AIPlan",
    "AuditLog",
    "Base",
    "Branch",
    "CheckUp",
    "CheckUpPhoto",
    "Expense",
    "Gym",
    "ImportJob",
    "Invite",
    "Lead",
    "LeadActivity",
    "Member",
    "Membership",
    "Notification",
    "Payment",
    "Plan",
    "ReminderLog",
    "StaffMembership",
    "User",
]
