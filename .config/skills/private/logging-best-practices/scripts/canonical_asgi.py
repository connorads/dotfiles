"""Canonical-log-line ASGI middleware.

Drop-in middleware for FastAPI / Starlette / any ASGI app. On every HTTP
request it:

  1. Creates a per-request event dict with method/path/request_id.
  2. Binds `request_id` into structlog contextvars so nested logs inherit it.
  3. Lets handlers annotate the event via `annotate(**fields)`.
  4. Emits ONE `logger.info("http.request", ...)` event in `finally`, with
     duration, status, route template, and error details populated.

Usage
-----
    from canonical_asgi import CanonicalLogMiddleware, annotate

    app = FastAPI()
    app.add_middleware(CanonicalLogMiddleware)

    @app.post("/checkout")
    async def checkout(user=Depends(current_user)):
        annotate(user_id=user.id, subscription=user.tier)
        ...

Notes
-----
* Uses the raw ASGI class form (not BaseHTTPMiddleware) deliberately —
  BaseHTTPMiddleware copies the context, so contextvars bound inside
  handlers are invisible in `finally`. See FastAPI #4696.
* Requires structlog configured with `merge_contextvars` as the first
  processor. See references/python.md.
"""

from __future__ import annotations

import time
import uuid
from contextvars import ContextVar
from typing import Any

import structlog
from starlette.types import ASGIApp, Message, Receive, Scope, Send

log = structlog.get_logger("canonical")
_event: ContextVar[dict[str, Any]] = ContextVar("canonical_event")


def annotate(**fields: Any) -> None:
    """Add fields to the current request's canonical event.

    Safe to call from anywhere in the request lifecycle. No-op outside a
    request (e.g. from a background task without its own canonical context).
    """
    try:
        _event.get().update(fields)
    except LookupError:
        pass


class CanonicalLogMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        request_id = _header(scope, b"x-request-id") or str(uuid.uuid4())
        event: dict[str, Any] = {
            "request_id":  request_id,
            "http.method": scope["method"],
            "http.path":   scope.get("path", ""),
            "db.calls": 0,
            "db.ms":    0,
        }
        event_token = _event.set(event)

        structlog.contextvars.clear_contextvars()
        structlog.contextvars.bind_contextvars(request_id=request_id)

        status: dict[str, int] = {"code": 500}

        async def send_wrapper(message: Message) -> None:
            if message["type"] == "http.response.start":
                status["code"] = message["status"]
            await send(message)

        start = time.perf_counter()
        error_class: str | None = None
        try:
            await self.app(scope, receive, send_wrapper)
        except Exception as exc:
            error_class = type(exc).__name__
            event["error.message"] = str(exc)
            raise
        finally:
            event["http.status_code"] = status["code"]
            event["duration_ms"] = round((time.perf_counter() - start) * 1000, 2)
            if error_class is not None:
                event["error.class"] = error_class

            # Route template (e.g. /users/{id}) if the router populated it.
            route = scope.get("route")
            if route is not None:
                template = getattr(route, "path", None)
                if template is not None:
                    event["http.route"] = template

            log.info("http.request", **event)
            _event.reset(event_token)


def _header(scope: Scope, name: bytes) -> str | None:
    """Case-insensitive header lookup against an ASGI scope."""
    target = name.lower()
    for key, value in scope.get("headers", []):
        if key.lower() == target:
            try:
                return value.decode("latin-1")
            except UnicodeDecodeError:
                return None
    return None
