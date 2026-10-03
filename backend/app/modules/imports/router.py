import uuid
from datetime import datetime
from typing import Annotated

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    Form,
    HTTPException,
    Response,
    UploadFile,
    status,
)
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.db import get_sessionmaker
from app.core.deps import DbSession, ManagerContext
from app.core.storage import get_storage
from app.modules.audit import service as audit
from app.modules.imports import service
from app.modules.imports.importers import FIELDS, suggest_mapping
from app.modules.imports.models import (
    DateOrder,
    DuplicateMode,
    ImportEntity,
    ImportJob,
    ImportStatus,
)
from app.modules.imports.parsing import ParseError, read_table, text

router = APIRouter(prefix="/imports", tags=["imports"])

Sessions = Annotated[async_sessionmaker[AsyncSession], Depends(get_sessionmaker)]
MAX_FILE_BYTES = 5 * 1024 * 1024


class FieldOut(BaseModel):
    key: str
    label: str
    required: bool
    hint: str


class ImportJobOut(BaseModel):
    id: uuid.UUID
    entity: ImportEntity
    status: ImportStatus
    filename: str
    columns: list[str]
    total_rows: int
    mapping: dict[str, str]
    duplicate_mode: DuplicateMode
    date_order: DateOrder
    created: int
    updated: int
    skipped: int
    failed: int
    processed: int
    error: str | None
    has_error_file: bool
    created_at: datetime
    finished_at: datetime | None


class UploadOut(BaseModel):
    job: ImportJobOut
    sample: list[dict[str, str | None]]  # first rows, raw text, for the mapping screen
    suggested_mapping: dict[str, str]


class CheckIn(BaseModel):
    mapping: dict[str, str]
    duplicate_mode: DuplicateMode = DuplicateMode.SKIP
    date_order: DateOrder = DateOrder.DMY


class RowProblem(BaseModel):
    row: int
    messages: list[str]


class PreviewRow(BaseModel):
    row: int
    status: str
    values: dict[str, str]


class CheckOut(BaseModel):
    job: ImportJobOut
    new: int
    duplicates: int
    invalid: int
    errors: list[RowProblem]
    preview: list[PreviewRow]


def _out(job: ImportJob) -> ImportJobOut:
    return ImportJobOut(
        **{f: getattr(job, f) for f in ImportJobOut.model_fields if f != "has_error_file"},
        has_error_file=job.error_file_key is not None,
    )


async def _job(db: DbSession, gym_id: uuid.UUID, job_id: uuid.UUID) -> ImportJob:
    job = await db.scalar(
        select(ImportJob)
        .where(ImportJob.gym_id == gym_id, ImportJob.id == job_id)
        .execution_options(populate_existing=True)
    )
    if job is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Import not found")
    return job


@router.get("/fields", response_model=dict[ImportEntity, list[FieldOut]])
async def fields(ctx: ManagerContext):
    return {
        e: [FieldOut(key=f.key, label=f.label, required=f.required, hint=f.hint) for f in fs]
        for e, fs in FIELDS.items()
    }


@router.get("/templates/{entity}", response_class=Response)
async def template(entity: ImportEntity, ctx: ManagerContext):
    return Response(
        service.template_csv(entity).encode("utf-8-sig"),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{entity.value}-template.csv"'},
    )


@router.get("", response_model=list[ImportJobOut])
async def list_imports(ctx: ManagerContext, db: DbSession):
    jobs = (
        await db.scalars(
            select(ImportJob)
            .where(ImportJob.gym_id == ctx.gym_id)
            .order_by(ImportJob.created_at.desc())
            .limit(20)
        )
    ).all()
    return [_out(j) for j in jobs]


@router.post("", response_model=UploadOut, status_code=status.HTTP_201_CREATED)
async def upload(
    ctx: ManagerContext,
    db: DbSession,
    file: UploadFile,
    entity: Annotated[ImportEntity, Form()],
):
    data = await file.read(MAX_FILE_BYTES + 1)
    if len(data) > MAX_FILE_BYTES:
        raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, "Files must be 5 MB or smaller")
    filename = (file.filename or "upload.csv")[-200:]
    try:
        columns, rows = read_table(data, filename)
    except ParseError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc

    job = ImportJob(
        gym_id=ctx.gym_id,
        entity=entity,
        filename=filename,
        storage_key="",
        columns=columns,
        total_rows=len(rows),
        mapping={},
        created_by=ctx.user.id,
    )
    db.add(job)
    await db.flush()
    ext = "xlsx" if data[:2] == b"PK" else "csv"
    job.storage_key = f"gyms/{ctx.gym_id}/imports/{job.id}/upload.{ext}"
    await get_storage().save(job.storage_key, data, "application/octet-stream")
    await db.commit()
    return UploadOut(
        job=_out(job),
        sample=[{c: text(r.get(c)) for c in columns} for r in rows[:5]],
        suggested_mapping=suggest_mapping(entity, columns),
    )


@router.get("/{job_id}", response_model=ImportJobOut)
async def get_import(job_id: uuid.UUID, ctx: ManagerContext, db: DbSession):
    return _out(await _job(db, ctx.gym_id, job_id))


@router.post("/{job_id}/check", response_model=CheckOut)
async def check(job_id: uuid.UUID, body: CheckIn, ctx: ManagerContext, db: DbSession):
    """Saves the column mapping and validates every row (nothing is written)."""
    job = await _job(db, ctx.gym_id, job_id)
    if job.status not in (ImportStatus.UPLOADED, ImportStatus.READY):
        raise HTTPException(status.HTTP_409_CONFLICT, "This import has already run")
    known = {f.key: f for f in FIELDS[job.entity]}
    mapping = {k: v for k, v in body.mapping.items() if v}
    unknown = [k for k in mapping if k not in known]
    missing_cols = [c for c in mapping.values() if c not in job.columns]
    if unknown or missing_cols:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "The mapping doesn't match this file"
        )
    required = [f.label for f in known.values() if f.required and f.key not in mapping]
    if required:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, f"Choose a column for: {', '.join(required)}"
        )
    job.mapping = mapping
    job.duplicate_mode = body.duplicate_mode
    job.date_order = body.date_order
    try:
        result = await service.dry_run(db, job, ctx.user.id)
    except (RuntimeError, ParseError) as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc
    job = await _job(db, ctx.gym_id, job_id)  # dry_run rolled back; reload and save settings
    job.mapping = mapping
    job.duplicate_mode = body.duplicate_mode
    job.date_order = body.date_order
    job.status = ImportStatus.READY
    await db.commit()
    return CheckOut(
        job=_out(job),
        new=result.new,
        duplicates=result.duplicates,
        invalid=result.invalid,
        errors=[RowProblem(**e) for e in result.errors],
        preview=[PreviewRow(**p) for p in result.preview],
    )


@router.post("/{job_id}/run", response_model=ImportJobOut, status_code=status.HTTP_202_ACCEPTED)
async def run(
    job_id: uuid.UUID,
    ctx: ManagerContext,
    db: DbSession,
    sessions: Sessions,
    background: BackgroundTasks,
):
    job = await _job(db, ctx.gym_id, job_id)
    if job.status != ImportStatus.READY:
        raise HTTPException(status.HTTP_409_CONFLICT, "Check the file before importing")
    job.status = ImportStatus.RUNNING
    audit.record(
        db,
        ctx,
        "import.started",
        f"Imported {job.entity.value} from {job.filename} ({job.total_rows} rows)",
        job.id,
    )
    await db.commit()
    background.add_task(service.run_job, sessions, job.id)
    return _out(job)


@router.get("/{job_id}/problems.csv", response_class=Response)
async def problems(job_id: uuid.UUID, ctx: ManagerContext, db: DbSession):
    job = await _job(db, ctx.gym_id, job_id)
    data = await get_storage().read(job.error_file_key) if job.error_file_key else None
    if data is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No problems file for this import")
    stem = job.filename.rsplit(".", 1)[0]
    return Response(
        data,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{stem}-problems.csv"'},
    )
