"""Remote MCP endpoints (§10): the JSON-RPC transport plus key management.

Everything here 404s when ``BALU_MCP_ENABLED`` is off, including the key
endpoints - the settings UIs read that 404 as "this server has no MCP support"
and hide the section, which is also what an older server without the feature
does.

None of it appears in the OpenAPI schema: `/mcp` is JSON-RPC rather than REST and
has nothing useful to say there, and keeping the document independent of runtime
configuration is worth more than documenting two account endpoints.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

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
from ..schemas.mcp import McpSettings

router = APIRouter(tags=["mcp"], include_in_schema=False)

_MCP_PATH = "/mcp"
_SETTINGS_PATH = "/me/mcp"
_KEY_PATH = "/me/mcp/key"


def require_mcp_enabled() -> None:
    if not get_settings().mcp_enabled:
        raise not_found("Not found")


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
@router.get(_SETTINGS_PATH, response_model=McpSettings, dependencies=[Depends(require_mcp_enabled)])
def get_mcp_settings(
    request: Request,
    user: User = Depends(get_current_user),
) -> McpSettings:
    # Read-only on purpose: both settings screens call this on mount just to
    # decide whether to render the section, and that is not a request for a
    # non-expiring full-access credential. `key` stays null until POST /me/mcp/key.
    return _settings_payload(request, _SETTINGS_PATH, user.mcp_key)


@router.post(_KEY_PATH, response_model=McpSettings, dependencies=[Depends(require_mcp_enabled)])
def create_mcp_key(
    request: Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> McpSettings:
    """Mint a key, or replace the existing one. Explicit user action, both ways."""
    if not limiter.allow(f"mcp:key:{client_ip(request)}", MCP_KEY_PER_IP):
        raise rate_limited(retry_after=int(MCP_KEY_PER_IP.window))
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
    raw = await request.body()
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
