"""JSON-RPC 2.0 dispatch for the MCP Streamable HTTP endpoint.

Only the tools half of MCP is implemented: `initialize`, `notifications/initialized`,
`ping`, `tools/list`, `tools/call`. There is no session id and no SSE stream - the
server is stateless, so every POST is answered with a single JSON response, which
the transport allows and Claude Code accepts.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from .. import __version__
from .tools import ToolContext, ToolError, call_tool, tool_specs

logger = logging.getLogger("balu.mcp")

#: The only revision we negotiate. Earlier ones (2025-03-26, 2024-11-05) require
#: receivers to accept JSON-RPC batches, which this server does not implement, so
#: advertising them would be a promise we do not keep. A client that asks for one
#: gets this version back and decides for itself whether to continue.
LATEST_PROTOCOL_VERSION = "2025-06-18"
SUPPORTED_PROTOCOL_VERSIONS = (LATEST_PROTOCOL_VERSION,)

SERVER_INFO = {"name": "balu", "title": "Balu", "version": __version__}

PARSE_ERROR = -32700
INVALID_REQUEST = -32600
METHOD_NOT_FOUND = -32601
INVALID_PARAMS = -32602
INTERNAL_ERROR = -32603


class JsonRpcError(Exception):
    """The request body could not be read as a single JSON-RPC request."""

    def __init__(self, code: int, message: str) -> None:
        self.code = code
        super().__init__(message)


def parse_message(raw: bytes) -> dict[str, Any]:
    try:
        message = json.loads(raw or b"")
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise JsonRpcError(PARSE_ERROR, f"Could not parse JSON: {exc}") from exc
    if not isinstance(message, dict):
        # Well-formed JSON that is not a request object is Invalid Request, not a
        # parse error. Arrays land here too: batching was removed in 2025-06-18,
        # the only revision this server negotiates.
        raise JsonRpcError(INVALID_REQUEST, "Expected a single JSON-RPC request object")
    return message


def error_response(request_id: Any, code: int, message: str) -> dict[str, Any]:
    return {
        "jsonrpc": "2.0",
        "id": request_id,
        "error": {"code": code, "message": message},
    }


def _result(request_id: Any, result: dict[str, Any]) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": request_id, "result": result}


def _text_content(payload: Any) -> list[dict[str, str]]:
    return [{"type": "text", "text": json.dumps(payload, indent=2, ensure_ascii=False)}]


def _initialize(params: dict) -> dict[str, Any]:
    requested = params.get("protocolVersion")
    version = requested if requested in SUPPORTED_PROTOCOL_VERSIONS else LATEST_PROTOCOL_VERSION
    return {
        "protocolVersion": version,
        "capabilities": {"tools": {"listChanged": False}},
        "serverInfo": SERVER_INFO,
    }


def dispatch(message: dict[str, Any], ctx: ToolContext) -> dict[str, Any] | None:
    """Handle one JSON-RPC message. Returns None for notifications (no reply)."""
    request_id = message.get("id")
    # A message without an id is a notification and must never be answered - not
    # even to complain about its shape.
    if request_id is None:
        return None

    method = message.get("method")
    params = message.get("params") or {}
    if not isinstance(method, str) or not isinstance(params, dict):
        return error_response(request_id, INVALID_REQUEST, "Malformed JSON-RPC request")

    if method == "initialize":
        return _result(request_id, _initialize(params))
    if method == "ping":
        return _result(request_id, {})
    if method == "tools/list":
        return _result(request_id, {"tools": tool_specs()})
    if method == "tools/call":
        return _tools_call(request_id, params, ctx)
    return error_response(request_id, METHOD_NOT_FOUND, f"Unknown method: {method}")


def _tools_call(request_id: Any, params: dict, ctx: ToolContext) -> dict[str, Any]:
    name = params.get("name")
    arguments = params.get("arguments") or {}
    if not isinstance(name, str) or not isinstance(arguments, dict):
        return error_response(request_id, INVALID_PARAMS, "tools/call needs name and arguments")
    try:
        payload = call_tool(ctx, name, arguments)
    except ToolError as exc:
        # A tool that refuses is a normal result with isError, not a protocol
        # error: the model is supposed to read the reason and try again. `applied`
        # names the steps of a multi-step tool that did commit before the failure,
        # so the model never has to guess how far it got.
        report: dict[str, Any] = {"error": str(exc)}
        if exc.applied:
            report["applied"] = exc.applied
        return _result(request_id, {"content": _text_content(report), "isError": True})
    except Exception:
        # Never hand a driver/ORM message to an MCP client (S6) - log it instead.
        logger.exception("MCP tool %s failed unexpectedly", name)
        return error_response(request_id, INTERNAL_ERROR, "Tool call failed")
    return _result(request_id, {"content": _text_content(payload), "isError": False})
