"""FastAPI application factory."""

from __future__ import annotations

import asyncio
import logging
import os
import re
from contextlib import asynccontextmanager
from pathlib import Path

from alembic.script.revision import ResolutionError
from alembic.util.exc import CommandError
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.exc import OperationalError, StatementError
from sqlalchemy.exc import TimeoutError as PoolTimeoutError

from . import __version__
from .config import get_settings
from .db import describe_transient_error, is_transient_db_error, validate_database_url
from .errors import unavailable
from .routers import attachments as attachments_router
from .routers import auth as auth_router
from .routers import channels as channels_router
from .routers import invites as invites_router
from .routers import mcp as mcp_router
from .routers import me as me_router
from .routers import members as members_router
from .routers import sync as sync_router
from .routers import workspaces as workspaces_router

_STATIC_DIR = Path(__file__).resolve().parent.parent / "static"

logger = logging.getLogger("balu.main")

# Never echo the submitted body back to the caller (it can contain credentials
# and it leaks internal field names); log the detail server-side instead.
_VALIDATION_MESSAGE = "Request body failed validation"


def _error_shape(exc: RequestValidationError) -> list[tuple]:
    """Field + error type only — never the submitted value.

    pydantic's ``errors()`` carries the offending input under ``input``, so
    logging it whole wrote plaintext passwords to the application log whenever
    registration failed the 8-character minimum.
    """
    return [(e.get("loc"), e.get("type")) for e in exc.errors()]


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Before migrations, which read the URL too: a URL with an ambiguous '@' (see
    # validate_database_url) must stop the boot here, not leak a password tail
    # through a connect error.
    validate_database_url(get_settings().database_url)
    if os.environ.get("BALU_AUTO_MIGRATE", "1") != "0":
        from .migrate import run_migrations

        try:
            run_migrations()
        except OperationalError as exc:
            # Without this the process died during startup with nothing in the
            # logs but "Waiting for application startup", which is a miserable
            # way to discover a wrong password. The usual cause is a database
            # volume that outlived a BALU_DB_PASSWORD change: Postgres only
            # applies POSTGRES_PASSWORD when initialising an empty volume.
            logger.error(
                "Cannot reach the database with DATABASE_URL. If this volume was "
                "initialised with a different password, changing BALU_DB_PASSWORD "
                "does not re-key it - rotate the role (ALTER USER balu WITH "
                "PASSWORD '…') or start from a fresh volume. Original error: %s",
                exc,
            )
            raise
        except CommandError as exc:
            # alembic words the unknown-revision error itself and chains the
            # ResolutionError behind it: trust the type first, the text second.
            if not (
                isinstance(exc.__cause__, ResolutionError)
                or "Can't locate revision" in str(exc)
            ):
                raise
            from .migrate import image_head

            logger.error(
                "The database is at a newer schema revision than this image knows "
                "(%s). It was migrated by a newer release: run `python -m "
                "balu.migrate downgrade %s` in the newer image (this image's own "
                "head; see the README rollback section) before starting this "
                "older image, or upgrade to the newer image again.",
                exc,
                image_head(),
            )
            raise

    settings = get_settings()
    stop_event: asyncio.Event | None = None
    reminder_task: asyncio.Task | None = None
    if settings.reminders_enabled:
        from .reminders import reminder_loop

        stop_event = asyncio.Event()
        reminder_task = asyncio.create_task(reminder_loop(stop_event))

    try:
        yield
    finally:
        if stop_event is not None and reminder_task is not None:
            stop_event.set()
            reminder_task.cancel()
            try:
                await reminder_task
            except asyncio.CancelledError:
                pass


_INVITE_PATH = re.compile(r"(/invite/)[^/?#\s]+", re.IGNORECASE)


class _RedactInviteTokens(logging.Filter):
    """Blank the token in /invite/<token> request lines of the uvicorn access log.

    The web invite link carries the token in the path and is served by the SPA
    fallback, so the access log would otherwise store it in plain text.
    """

    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.args, tuple):
            record.args = tuple(
                _INVITE_PATH.sub(r"\1<redacted>", a) if isinstance(a, str) else a
                for a in record.args
            )
        return True


def _configure_app_logging() -> None:
    """Give the `balu` logger tree INFO level and a stderr handler (idempotent).

    Uvicorn only configures its own loggers, and the root logger defaults to WARNING,
    so without this the app's info logs never surface.
    """
    app_logger = logging.getLogger("balu")
    handler = next(
        (h for h in app_logger.handlers if getattr(h, "_balu_app", False)), None
    )
    if handler is None:
        handler = logging.StreamHandler()
        handler.setFormatter(logging.Formatter("%(levelname)s:     %(name)s: %(message)s"))
        handler._balu_app = True  # type: ignore[attr-defined]
        app_logger.addHandler(handler)
    app_logger.setLevel(logging.INFO)
    # Migrations run in-process at boot; keep their "Running upgrade" lines visible.
    # httpx logs "HTTP Request: POST https://api.telegram.org/bot<token>/..." at INFO;
    # keep it (and httpcore) quiet even if a root handler is ever added.
    for noisy in ("httpx", "httpcore"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
    access_logger = logging.getLogger("uvicorn.access")
    if not any(isinstance(f, _RedactInviteTokens) for f in access_logger.filters):
        access_logger.addFilter(_RedactInviteTokens())
    alembic_logger = logging.getLogger("alembic")
    alembic_logger.setLevel(logging.INFO)
    if handler not in alembic_logger.handlers:
        alembic_logger.addHandler(handler)


def create_app() -> FastAPI:
    _configure_app_logging()
    settings = get_settings()
    app = FastAPI(title="Balu", version=__version__, lifespan=lifespan)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.exception_handler(RequestValidationError)
    async def _validation_handler(request: Request, exc: RequestValidationError):
        logger.info(
            "validation error on %r: %s",
            request.url.path,
            _error_shape(exc),
        )
        return JSONResponse(
            status_code=422,
            content={"detail": {"code": "validation_error", "message": _VALIDATION_MESSAGE}},
        )

    api = FastAPI(title="Balu API", version=__version__)
    api.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @api.exception_handler(RequestValidationError)
    async def _api_validation_handler(request: Request, exc: RequestValidationError):
        logger.info(
            "validation error on %r: %s",
            request.url.path,
            _error_shape(exc),
        )
        return JSONResponse(
            status_code=422,
            content={"detail": {"code": "validation_error", "message": _VALIDATION_MESSAGE}},
        )

    def _unavailable_response(request: Request, exc: Exception) -> JSONResponse:
        logger.error(
            "transient database error on %s %r: %s",
            request.method, request.url.path, describe_transient_error(exc),
        )
        err = unavailable()
        return JSONResponse(status_code=503, content={"detail": err.detail}, headers=err.headers)

    @api.exception_handler(PoolTimeoutError)
    async def _pool_timeout_handler(request: Request, exc: PoolTimeoutError):
        return _unavailable_response(request, exc)

    @api.exception_handler(StatementError)
    async def _db_error_handler(request: Request, exc: StatementError):
        if is_transient_db_error(exc):
            return _unavailable_response(request, exc)
        # Left to uvicorn, a StatementError is logged with its full traceback, and
        # Postgres's DETAIL ("Failing row contains (...)") carries user content.
        logger.error(
            "database error on %s %r: %s",
            request.method, request.url.path, type(exc).__name__,
        )
        return JSONResponse(
            status_code=500,
            content={"detail": {"code": "internal_error", "message": "Internal server error"}},
        )

    api.include_router(auth_router.router)
    api.include_router(me_router.router)
    api.include_router(workspaces_router.router)
    api.include_router(invites_router.router)
    api.include_router(members_router.router)
    api.include_router(channels_router.router)
    api.include_router(mcp_router.router)
    api.include_router(attachments_router.router)
    api.include_router(sync_router.router)
    app.mount("/api/v1", api)
    # Expose the API sub-app so tests can install dependency overrides on it
    # (overrides on the parent app do not reach a mounted sub-application).
    app.state.api = api

    @app.get("/healthz")
    def healthz() -> dict[str, str]:
        return {"status": "ok"}

    _mount_static(app)
    return app


def _mount_static(app: FastAPI) -> None:
    index = _STATIC_DIR / "index.html"
    if not index.exists():
        return  # dev: no built web client, skip silently

    assets = _STATIC_DIR / "assets"
    if assets.exists():
        app.mount("/assets", StaticFiles(directory=str(assets)), name="assets")

    root = _STATIC_DIR.resolve()

    @app.get("/{full_path:path}")
    def spa_fallback(full_path: str):
        # Starlette percent-decodes `full_path`, so `..` survives encoded forms
        # (`%2e%2e%2f`, `..%2f`, …). Resolve and require containment under the
        # static root before serving anything off disk.
        if full_path:
            try:
                candidate = (root / full_path).resolve()
                if candidate.is_relative_to(root) and candidate.is_file():
                    # The shell is also reachable directly as /index.html, and it
                    # must carry the same no-cache policy however it is requested -
                    # a stale shell is what blanks the app after a deploy. Hashed
                    # assets under /assets keep default caching.
                    if candidate == root / "index.html":
                        return FileResponse(str(index), headers={"cache-control": "no-cache"})
                    return FileResponse(str(candidate))
            except (OSError, ValueError):
                # A `%00` in the path makes resolve() raise ValueError, and a path
                # past the platform's limit makes is_file() raise OSError
                # (pathlib does not ignore ENAMETOOLONG). Both are ordinary junk
                # from a scanner or a mangled shared link - they must fall
                # through to the SPA shell, not 500 with a traceback.
                pass
        return FileResponse(str(index), headers={"cache-control": "no-cache"})


app = create_app()
