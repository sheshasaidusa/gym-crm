import contextlib

from fastapi import APIRouter, FastAPI, Response, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app import models  # noqa: F401  (registers all tables)
from app.core.config import settings
from app.core.deps import DbSession
from app.core.monitoring import RequestContextMiddleware, configure_logging, init_sentry
from app.core.scheduler import run_scheduler
from app.modules.ai_plans.router import router as ai_plans_router
from app.modules.analytics.router import router as analytics_router
from app.modules.audit.router import router as audit_router
from app.modules.auth.router import router as auth_router
from app.modules.checkups.router import router as checkups_router
from app.modules.exports.router import router as exports_router
from app.modules.finance.router import router as finance_router
from app.modules.gyms.router import router as gyms_router
from app.modules.imports.router import router as imports_router
from app.modules.leads.router import router as leads_router
from app.modules.members.router import router as members_router
from app.modules.notifications.router import router as notifications_router
from app.modules.plans.router import router as plans_router
from app.modules.public.router import router as public_router
from app.modules.reminders.router import router as reminders_router


@contextlib.asynccontextmanager
async def lifespan(_: FastAPI):
    if settings.scheduler == "inprocess":
        async with run_scheduler():
            yield
    else:
        yield


def create_app() -> FastAPI:
    configure_logging()
    init_sentry("api")
    app = FastAPI(
        title=settings.app_name,
        openapi_url="/api/openapi.json",
        docs_url="/api/docs",
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.add_middleware(RequestContextMiddleware)

    api = APIRouter(prefix="/api")

    @api.get("/health", tags=["meta"])
    async def health() -> dict[str, str]:
        """Liveness: the process is up."""
        return {"status": "ok"}

    @api.get("/health/ready", tags=["meta"])
    async def ready(response: Response, db: DbSession) -> dict[str, str]:
        """Readiness: the database answers. Point load balancer health checks here."""
        try:
            await db.execute(text("SELECT 1"))
        except Exception:
            response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
            return {"status": "database unavailable"}
        return {"status": "ok"}

    api.include_router(auth_router)
    api.include_router(gyms_router)
    api.include_router(plans_router)
    api.include_router(members_router)
    api.include_router(checkups_router)
    api.include_router(ai_plans_router)
    api.include_router(leads_router)
    api.include_router(finance_router)
    api.include_router(imports_router)
    api.include_router(analytics_router)
    api.include_router(audit_router)
    api.include_router(exports_router)
    api.include_router(public_router)
    api.include_router(reminders_router)
    api.include_router(notifications_router)
    app.include_router(api)
    return app


app = create_app()
