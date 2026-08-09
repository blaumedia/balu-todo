"""Remote MCP server (Streamable HTTP), gated by ``BALU_MCP_ENABLED``.

A Claude Code (or any MCP) client points at ``/api/v1/mcp`` and authenticates with
a per-user bearer key from settings. The transport is a plain JSON-RPC 2.0 POST
handler in :mod:`balu.mcp.protocol` - no SSE stream, no SDK: responding
``application/json`` to each POST is what the spec calls the simple case, and it
is all a tool-only server needs.

Every mutation is expressed as a sync command and applied through
:func:`balu.sync.commands.process_commands`, the exact path the REST sync endpoint
uses. That is not an implementation detail to preserve casually: role checks,
version stamping, event dispatch and the replication feed all live there, so a
task created over MCP has to appear on web and mobile like any other.
"""

from .keys import MCP_KEY_PREFIX, generate_mcp_key, new_mcp_key, user_for_key
from .protocol import LATEST_PROTOCOL_VERSION, JsonRpcError, dispatch

__all__ = [
    "MCP_KEY_PREFIX",
    "LATEST_PROTOCOL_VERSION",
    "JsonRpcError",
    "dispatch",
    "generate_mcp_key",
    "new_mcp_key",
    "user_for_key",
]
