"""Runs slow work (imports, AI generation) off the request.

With SCHEDULER=celery the job goes to the Celery worker, so a deploy or restart of the API
doesn't kill it half way. Otherwise (local dev, the free Render plan with no worker) it runs
as a FastAPI background task in the API process, as before.
"""

import uuid
from collections.abc import Awaitable, Callable
from functools import cache

from fastapi import BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import settings

JobFn = Callable[[async_sessionmaker[AsyncSession], uuid.UUID], Awaitable[None]]


@cache
def _celery():
    # A send-only client; importing app.worker here would start worker logging and Sentry.
    from celery import Celery

    return Celery("gym_crm", broker=settings.redis_url)


def enqueue(
    background: BackgroundTasks,
    task_name: str,
    fn: JobFn,
    sessions: async_sessionmaker[AsyncSession],
    record_id: uuid.UUID,
) -> None:
    """`task_name` must match a task in app.worker that calls the same `fn`."""
    if settings.scheduler == "celery":
        _celery().send_task(task_name, args=[str(record_id)])
    else:
        background.add_task(fn, sessions, record_id)
