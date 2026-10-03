"""Logging, request IDs and Sentry error reporting."""

import json
import logging
import re
import time
import uuid
from contextvars import ContextVar

from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core.config import settings

# Preview links and invites carry secret tokens in the path; keep them out of logs.
_TOKEN = re.compile(
    r"(?<=/)(?![0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:/|$))"
    r"[A-Za-z0-9_-]{20,}(?=/|$)"
)


def redact(path: str) -> str:
    return _TOKEN.sub(":token", path)


request_id: ContextVar[str | None] = ContextVar("request_id", default=None)
access_log = logging.getLogger("gym_crm.access")


class _RequestIdFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = request_id.get() or "-"
        return True


class _JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        data = {
            "time": self.formatTime(record),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "request_id": getattr(record, "request_id", None),
        }
        for key in ("method", "path", "status", "duration_ms"):
            if hasattr(record, key):
                data[key] = getattr(record, key)
        if record.exc_info:
            data["exception"] = self.formatException(record.exc_info)
        return json.dumps(data)


def configure_logging() -> None:
    handler = logging.StreamHandler()
    handler.addFilter(_RequestIdFilter())
    handler.setFormatter(
        _JsonFormatter()
        if settings.log_json
        else logging.Formatter("%(asctime)s %(levelname)s [%(request_id)s] %(name)s: %(message)s")
    )
    root = logging.getLogger("gym_crm")
    root.handlers = [handler]
    root.setLevel(settings.log_level.upper())
    root.propagate = False


def _scrub(event, _hint):
    """Belt and braces on top of send_default_pii=False: drop bodies, cookies and auth."""
    req = event.get("request") or {}
    req.pop("data", None)
    req.pop("cookies", None)
    req.pop("query_string", None)
    if req.get("url"):
        req["url"] = redact(req["url"])
    headers = req.get("headers") or {}
    for name in list(headers):
        if name.lower() in ("authorization", "cookie", "set-cookie"):
            headers[name] = "[removed]"
    return event


def init_sentry(component: str) -> None:
    if not settings.sentry_dsn:
        return
    import sentry_sdk

    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        environment=settings.environment,
        release=settings.release,
        server_name=component,
        send_default_pii=False,
        traces_sample_rate=settings.sentry_traces_sample_rate,
        before_send=_scrub,
    )


class RequestContextMiddleware:
    """Gives every request an ID (echoed as X-Request-ID), logs one line per request and
    adds baseline security headers to API responses."""

    SECURITY_HEADERS = [
        (b"x-content-type-options", b"nosniff"),
        (b"referrer-policy", b"strict-origin-when-cross-origin"),
        (b"x-frame-options", b"DENY"),
    ]

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        incoming = dict(scope["headers"]).get(b"x-request-id", b"").decode("latin-1")
        rid = incoming[:64] if incoming.isprintable() and incoming else uuid.uuid4().hex
        token = request_id.set(rid)
        start = time.perf_counter()
        status = 500

        async def send_wrapper(message: Message) -> None:
            nonlocal status
            if message["type"] == "http.response.start":
                status = message["status"]
                headers = list(message.get("headers", []))
                present = {k.lower() for k, _ in headers}
                headers.append((b"x-request-id", rid.encode()))
                headers += [(k, v) for k, v in self.SECURITY_HEADERS if k not in present]
                message["headers"] = headers
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        finally:
            path = redact(scope.get("path", ""))
            if path != "/api/health":
                access_log.info(
                    "%s %s %s",
                    scope.get("method"),
                    path,
                    status,
                    extra={
                        "method": scope.get("method"),
                        "path": path,  # never the query string: it can hold tokens or names
                        "status": status,
                        "duration_ms": round((time.perf_counter() - start) * 1000, 1),
                    },
                )
            request_id.reset(token)
