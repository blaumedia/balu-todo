"""Remote MCP endpoints (§10): the JSON-RPC transport plus key management.

Everything here 404s when ``BALU_MCP_ENABLED`` is off, except
``GET /me/mcp?probe=true``, which answers ``200 {"enabled": false}`` for clients
that understand it. Without ``probe``, old clients keep getting the 404 they read
as "this server has no MCP support" and hide the section, which is also what an
older server without the feature does.

None of it appears in the OpenAPI schema: `/mcp` is JSON-RPC rather than REST and
has nothing useful to say there, and keeping the document independent of runtime
configuration is worth more than documenting two account endpoints.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool
from starlette.requests import ClientDisconnect

from ..auth import get_current_user
from ..config import get_settings
from ..db import get_db, get_sessionmaker
from ..errors import ApiError, not_found, rate_limited
from ..events import EventSender, get_event_sender
from ..mcp.keys import generate_mcp_key, user_for_key
from ..mcp.protocol import JsonRpcError, dispatch, error_response, parse_message
from ..mcp.tools import ToolContext
from ..models import User
from ..ratelimit import MCP_AUTH_PER_IP, MCP_KEY_PER_IP, client_ip, limiter
from ..schemas.mcp import McpDisabled, McpSettings

logger = logging.getLogger("balu.mcp")

router = APIRouter(tags=["mcp"], include_in_schema=False)

_MCP_PATH = "/mcp"
_SETTINGS_PATH = "/me/mcp"
_KEY_PATH = "/me/mcp/key"


def require_mcp_enabled() -> None:
    if not get_settings().mcp_enabled:
        raise not_found("Not found")


def _settings_gate(probe: str | None = None) -> bool:
    """Feature gate for GET /me/mcp only.

    Clients that understand `{"enabled": false}` ask with `?probe=true` and get a
    200 instead of a 404 (no red console line). Everyone else - mobile <= 1.3.2,
    old web bundles - keeps the 404 they read as "hide the section", because they
    render any 200 body. Runs before auth, so an unauthenticated non-probe call
    still 404s exactly as before.

    `probe` is read leniently: only "true"/"1" count (case-insensitive,
    surrounding spaces ignored), any other value is ignored like before (no 422
    for a value an old server never validated).
    """
    enabled = get_settings().mcp_enabled
    probing = probe is not None and probe.strip().lower() in ("true", "1")
    if not enabled and not probing:
        raise not_found("Not found")
    return enabled


def _unauthorized() -> ApiError:
    return ApiError(
        401,
        "invalid_token",
        "Invalid or missing MCP key",
        headers={"WWW-Authenticate": 'Bearer realm="balu-mcp"'},
    )


def _forwarded_proto(request: Request, hops: int) -> str | None:
    """The scheme the outermost trusted proxy saw, counted from the right.

    Same arithmetic as :func:`balu.ratelimit.client_ip`, and for the same reason:
    proxies append, so the leftmost entry is whatever the client wrote.
    """
    parts = [p.strip() for p in request.headers.get("x-forwarded-proto", "").split(",")]
    parts = [p for p in parts if p]
    if len(parts) < hops:
        return None  # chain shorter than configured: trust the socket instead
    proto = parts[-hops]
    return proto if proto in ("http", "https") else None


def _endpoint_url(request: Request, own_path: str) -> str:
    """Absolute URL of the MCP endpoint, as seen by whoever asked.

    Derived by trimming this route's own suffix off the request path instead of
    hardcoding ``/api/v1``, so it stays correct wherever the API sub-app is
    mounted. ``X-Forwarded-Proto`` is only consulted when
    ``BALU_TRUSTED_PROXY_HOPS`` says a proxy really is in front - otherwise the
    header is a free rewrite of the URL we hand the user.
    """
    prefix = request.url.path.removesuffix(own_path)
    url = request.url.replace(path=f"{prefix}{_MCP_PATH}", query="")
    hops = get_settings().trusted_proxy_hops
    if hops > 0:
        proto = _forwarded_proto(request, hops)
        if proto is not None:
            url = url.replace(scheme=proto)
    return str(url)


def _settings_payload(request: Request, own_path: str, key: str | None) -> McpSettings:
    endpoint = _endpoint_url(request, own_path)
    return McpSettings(
        enabled=True,
        endpoint=endpoint,
        key=key,
        claude_code_command=(
            None
            if key is None
            else (
                f'claude mcp add --transport http balu {endpoint} '
                f'--header "Authorization: Bearer {key}"'
            )
        ),
    )


# ---------------------------------------------------------------------------
# Key management (session-authenticated, for the settings UIs)
# ---------------------------------------------------------------------------
@router.get(_SETTINGS_PATH, response_model=McpSettings | McpDisabled)
def get_mcp_settings(
    request: Request,
    response: Response,
    enabled: bool = Depends(_settings_gate),
    user: User = Depends(get_current_user),
) -> McpSettings | McpDisabled:
    # The body can carry a full-access key, and browsers disk-cache plain 200 GETs.
    # Set on the disabled 200 too, so nothing stale outlives a toggle. The 404s carry
    # no secret and no validators, so they are left alone.
    response.headers["Cache-Control"] = "no-store"
    if not enabled:
        return McpDisabled()
    # Read-only on purpose: both settings screens call this on mount just to
    # decide whether to render the section, and that is not a request for a
    # non-expiring full-access credential. `key` stays null until POST /me/mcp/key.
    return _settings_payload(request, _SETTINGS_PATH, user.mcp_key)


@router.post(_KEY_PATH, response_model=McpSettings, dependencies=[Depends(require_mcp_enabled)])
def create_mcp_key(
    request: Request,
    response: Response,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> McpSettings:
    """Mint a key, or replace the existing one. Explicit user action, both ways."""
    if not limiter.allow(f"mcp:key:{client_ip(request)}", MCP_KEY_PER_IP):
        raise rate_limited(retry_after=int(MCP_KEY_PER_IP.window))
    response.headers["Cache-Control"] = "no-store"
    return _settings_payload(request, _KEY_PATH, generate_mcp_key(db, user))


# ---------------------------------------------------------------------------
# The MCP endpoint itself
# ---------------------------------------------------------------------------
@router.get(_MCP_PATH, dependencies=[Depends(require_mcp_enabled)])
def mcp_get() -> Response:
    # Streamable HTTP allows a server that never streams to refuse the GET
    # (server-initiated SSE channel); every message we handle arrives by POST.
    return Response(status_code=405, headers={"Allow": "POST"})


@router.post(_MCP_PATH, dependencies=[Depends(require_mcp_enabled)])
async def mcp_post(
    request: Request,
    db: Session = Depends(get_db),
    event_sender: EventSender = Depends(get_event_sender),
) -> Response:
    try:
        raw = await request.body()
    except ClientDisconnect:
        # The client went away mid-body: nobody to answer, and not a server
        # fault, so do not let it escape as an unhandled ASGI exception.
        logger.info("mcp request aborted by client")
        return Response(status_code=400)
    authorization = request.headers.get("Authorization", "")
    ip = client_ip(request)
    # The body is the only async part; tool handling is synchronous SQLAlchemy and
    # belongs in the threadpool, like every other `def` handler in this app.
    return await run_in_threadpool(_handle, raw, authorization, ip, db, event_sender)


def _handle(
    raw: bytes, authorization: str, ip: str, db: Session, event_sender: EventSender
) -> Response:
    # This is an unauthenticated endpoint that verifies a credential, so it needs
    # the same treatment as login: budget is only *spent* on failures, so a busy
    # legitimate client is never throttled for making tool calls.
    bucket = f"mcp:auth:{ip}"
    if not limiter.check(bucket, MCP_AUTH_PER_IP):
        raise rate_limited(retry_after=int(MCP_AUTH_PER_IP.window))
    user = None
    if authorization.lower().startswith("bearer "):
        user = user_for_key(db, authorization[7:].strip())
    if user is None:
        limiter.record(bucket, MCP_AUTH_PER_IP)
        raise _unauthorized()

    try:
        message = parse_message(raw)
    except JsonRpcError as exc:
        return JSONResponse(
            status_code=400, content=error_response(None, exc.code, str(exc))
        )

    ctx = ToolContext(db=db, sm=get_sessionmaker(), user=user, event_sender=event_sender)
    response = dispatch(message, ctx)
    if response is None:
        # A JSON-RPC notification (`notifications/initialized`) gets no body.
        return Response(status_code=202)
    return JSONResponse(content=response)
