"""FastAPI application factory."""

from __future__ import annotations

import asyncio
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .config import get_settings
from .routers import auth as auth_router
from .routers import channels as channels_router
from .routers import invites as invites_router
from .routers import me as me_router
from .routers import members as members_router
from .routers import sync as sync_router
from .routers import workspaces as workspaces_router

_STATIC_DIR = Path(__file__).resolve().parent.parent / "static"


@asynccontextmanager
async def lifespan(app: FastAPI):
    if os.environ.get("BALU_AUTO_MIGRATE", "1") != "0":
        from .migrate import run_migrations

        run_migrations()

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


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="Balu", version="0.1.0", lifespan=lifespan)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.exception_handler(RequestValidationError)
    async def _validation_handler(request: Request, exc: RequestValidationError):
        return JSONResponse(
            status_code=422,
            content={"detail": {"code": "validation_error", "message": str(exc.errors())}},
        )

    api = FastAPI(title="Balu API", version="0.1.0")
    api.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @api.exception_handler(RequestValidationError)
    async def _api_validation_handler(request: Request, exc: RequestValidationError):
        return JSONResponse(
            status_code=422,
            content={"detail": {"code": "validation_error", "message": str(exc.errors())}},
        )

    api.include_router(auth_router.router)
    api.include_router(me_router.router)
    api.include_router(workspaces_router.router)
    api.include_router(invites_router.router)
    api.include_router(members_router.router)
    api.include_router(channels_router.router)
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

    @app.get("/{full_path:path}")
    def spa_fallback(full_path: str):
        candidate = _STATIC_DIR / full_path
        if full_path and candidate.is_file():
            return FileResponse(str(candidate))
        return FileResponse(str(index))


app = create_app()
