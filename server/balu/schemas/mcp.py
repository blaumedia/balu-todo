"""Remote MCP settings schema (§10)."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel


class McpSettings(BaseModel):
    enabled: bool
    #: Absolute URL of the MCP endpoint, derived from the request so it is
    #: copy-pasteable behind whatever proxy the instance actually runs on.
    endpoint: str
    #: Null until the user explicitly generates one - opening settings must not
    #: mint a credential.
    key: str | None = None
    #: The ready-made `claude mcp add` line, built server-side so the web and
    #: mobile settings screens cannot drift apart on it. Null while `key` is.
    claude_code_command: str | None = None


class McpDisabled(BaseModel):
    """`GET /me/mcp?probe=true` while BALU_MCP_ENABLED is off (§10).

    Deliberately nothing but the flag: no endpoint that would 404, and never a
    stored key of a user who generated one while the feature was on.
    """

    enabled: Literal[False] = False
