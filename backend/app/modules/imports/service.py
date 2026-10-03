import csv
import io
import logging
import uuid
from dataclasses import dataclass, field

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.dates import today_in
from app.core.db import utcnow
from app.core.storage import get_storage
from app.modules.gyms.models import Gym, Role
from app.modules.imports.importers import (
    FIELDS,
    IMPORTERS,
    Ctx,
    RowError,
    display_values,
    map_row,
)
from app.modules.imports.models import ImportJob, ImportStatus
from app.modules.imports.parsing import Row, read_table
from app.modules.notifications.service import notify_staff

log = logging.getLogger("gym_crm.imports")

BATCH = 100
MAX_REPORTED_ERRORS = 200


@dataclass
class CheckResult:
    new: int = 0
    duplicates: int = 0
    invalid: int = 0
    errors: list[dict] = field(default_factory=list)  # {"row": n, "messages": [...]}
    preview: list[dict] = field(default_factory=list)  # {"row": n, "status": ..., "values": {...}}


def spreadsheet_row(index: int) -> int:
    """Row number as the user sees it in Excel (header is row 1)."""
    return index + 2


async def load_rows(job: ImportJob) -> list[Row]:
    data = await get_storage().read(job.storage_key)
    if data is None:
        raise RuntimeError("The uploaded file is no longer available. Upload it again.")
    _, rows = read_table(data, job.filename)
    return rows


async def make_ctx(
    db: AsyncSession, job: ImportJob, user_id: uuid.UUID | None, dry_run: bool
) -> Ctx:
    gym = await db.get_one(Gym, job.gym_id)
    ctx = Ctx(
        db=db,
        gym=gym,
        user_id=user_id,
        today=today_in(gym.timezone),
        date_order=job.date_order,
        mode=job.duplicate_mode,
        dry_run=dry_run,
    )
    await ctx.load()
    return ctx


async def dry_run(db: AsyncSession, job: ImportJob, user_id: uuid.UUID) -> CheckResult:
    """Validates every row without writing anything."""
    prepare, _ = IMPORTERS[job.entity]
    ctx = await make_ctx(db, job, user_id, dry_run=True)
    result = CheckResult()
    for i, row in enumerate(await load_rows(job)):
        n = spreadsheet_row(i)
        try:
            p = await prepare(ctx, map_row(row, job.mapping))
        except RowError as exc:
            result.invalid += 1
            if len(result.errors) < MAX_REPORTED_ERRORS:
                result.errors.append({"row": n, "messages": exc.messages})
            continue
        status = "duplicate" if p.is_duplicate else "new"
        if p.is_duplicate:
            result.duplicates += 1
        else:
            result.new += 1
        if len(result.preview) < 10:
            result.preview.append(
                {"row": n, "status": status, "values": display_values(job.entity, p)}
            )
    await db.rollback()  # nothing should have been written, but be certain
    return result


async def run_job(sessions: async_sessionmaker[AsyncSession], job_id: uuid.UUID) -> None:
    async with sessions() as db:
        job = await db.get(ImportJob, job_id)
        if job is None:
            return
        try:
            await _run(db, job)
        except Exception as exc:
            log.exception("Import %s failed", job_id)
            await db.rollback()
            job = await db.get_one(ImportJob, job_id)
            job.status = ImportStatus.FAILED
            job.error = (
                str(exc) if isinstance(exc, RuntimeError) else "The import stopped unexpectedly."
            )
            job.finished_at = utcnow()
            await db.commit()


async def _run(db: AsyncSession, job: ImportJob) -> None:
    prepare, apply = IMPORTERS[job.entity]
    rows = await load_rows(job)
    ctx = await make_ctx(db, job, job.created_by, dry_run=False)
    counts = {"created": 0, "updated": 0, "skipped": 0}
    failures: list[tuple[int, Row, str]] = []

    for i, row in enumerate(rows):
        try:
            # Each row in its own savepoint: a bad row is undone without losing the batch.
            async with db.begin_nested():
                p = await prepare(ctx, map_row(row, job.mapping))
                outcome = "skipped" if p.existing is True else await apply(ctx, p)
                await db.flush()
            counts[outcome] += 1
        except RowError as exc:
            failures.append((spreadsheet_row(i), row, "; ".join(exc.messages)))
        except Exception:
            log.exception("Import %s: row %s crashed", job.id, spreadsheet_row(i))
            failures.append((spreadsheet_row(i), row, "Couldn't import this row"))
        if (i + 1) % BATCH == 0:
            _progress(job, i + 1, counts, failures)
            await db.commit()

    _progress(job, len(rows), counts, failures)
    if failures:
        job.error_file_key = await _write_error_file(job, failures)
    job.status = ImportStatus.DONE
    job.finished_at = utcnow()
    await db.flush()
    if job.created_by:
        summary = f"{job.created} added, {job.updated} updated, {job.skipped} skipped"
        if job.failed:
            summary += f", {job.failed} with problems"
        await notify_staff(
            db,
            job.gym_id,
            roles=tuple(Role),
            kind="import_done",
            title=f"Import finished: {job.filename}",
            body=summary + ".",
            link="/import",
            user_ids=[job.created_by],
        )
    await db.commit()


def _progress(job: ImportJob, processed: int, counts: dict[str, int], failures: list) -> None:
    job.processed = processed
    job.created = counts["created"]
    job.updated = counts["updated"]
    job.skipped = counts["skipped"]
    job.failed = len(failures)


async def _write_error_file(job: ImportJob, failures: list[tuple[int, Row, str]]) -> str:
    """CSV of the rows that failed, with the reason, so they can be fixed and re-imported."""
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["Row", "Problem", *job.columns])
    for n, row, message in failures:
        writer.writerow(
            [n, message, *(("" if row.get(c) is None else row.get(c)) for c in job.columns)]
        )
    key = f"gyms/{job.gym_id}/imports/{job.id}/problems.csv"
    await get_storage().save(key, buf.getvalue().encode("utf-8-sig"), "text/csv")
    return key


def template_csv(entity) -> str:
    from app.modules.imports.importers import SAMPLE_ROWS

    fields = FIELDS[entity]
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow([f.label for f in fields])
    for sample in SAMPLE_ROWS[entity]:
        writer.writerow([sample.get(f.key, "") for f in fields])
    return buf.getvalue()
