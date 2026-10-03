"""Celery app for production background jobs.

    celery -A app.worker worker --beat --loglevel=info

(Run beat as a separate single process when you scale workers: `celery -A app.worker beat`.)
"""

import asyncio

from celery import Celery
from celery.schedules import crontab
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app import models  # noqa: F401  (registers all tables)
from app.core.config import settings
from app.core.monitoring import configure_logging, init_sentry

configure_logging()
init_sentry("worker")

celery_app = Celery("gym_crm", broker=settings.redis_url, backend=settings.redis_url)
celery_app.conf.update(
    timezone="UTC",
    task_acks_late=True,
    worker_prefetch_multiplier=1,
    beat_schedule={
        # Hourly: each gym's reminders go out once its local send hour has passed.
        "send-membership-reminders": {
            "task": "reminders.run_all",
            "schedule": crontab(minute=5),
        }
    },
)


async def _run_reminders() -> dict:
    from app.modules.reminders.service import run_all_gyms

    # A fresh engine per task: asyncio.run() creates a new event loop each time, and
    # pooled async connections can't be shared across loops.
    engine = create_async_engine(settings.database_url, poolclass=NullPool)
    try:
        results = await run_all_gyms(async_sessionmaker(engine, expire_on_commit=False))
        return {str(gym_id): r.__dict__ for gym_id, r in results.items()}
    finally:
        await engine.dispose()


@celery_app.task(name="reminders.run_all")
def run_reminders() -> dict:
    return asyncio.run(_run_reminders())
