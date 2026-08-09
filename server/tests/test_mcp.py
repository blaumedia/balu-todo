"""Remote MCP server (§10): feature gate, key lifecycle, JSON-RPC, tool scoping."""

from __future__ import annotations

import pytest

from balu.config import get_settings
from tests.conftest import auth_headers, cmd, register_user, sync


@pytest.fixture
def mcp_on():
    """Turn the feature on for one test (settings are a cached singleton)."""
    settings = get_settings()
    settings.mcp_enabled = True
    yield
    settings.mcp_enabled = False


def mcp_settings(client, user) -> dict:
    resp = client.get("/api/v1/me/mcp", headers=user["headers"])
    assert resp.status_code == 200, resp.text
    return resp.json()


def mcp_key(client, user) -> str:
    """Generate a key the way the settings UIs do (explicit user action)."""
    resp = client.post("/api/v1/me/mcp/key", headers=user["headers"])
    assert resp.status_code == 200, resp.text
    return resp.json()["key"]


def rpc(client, key: str, method: str, params: dict | None = None, id_: int | None = 1):
    body: dict = {"jsonrpc": "2.0", "method": method}
    if id_ is not None:
        body["id"] = id_
    if params is not None:
        body["params"] = params
    return client.post(
        "/api/v1/mcp", headers={"Authorization": f"Bearer {key}"}, json=body
    )


def call(client, key: str, name: str, arguments: dict) -> dict:
    resp = rpc(client, key, "tools/call", {"name": name, "arguments": arguments})
    assert resp.status_code == 200, resp.text
    return resp.json()["result"]


def payload(result: dict) -> str:
    return result["content"][0]["text"]


def task_id_of(result: dict, key: str = "created") -> str:
    import json

    return json.loads(payload(result))[key]["id"]


def _join(client, owner, role="member") -> dict:
    """Register a fresh user and have them accept an invite into owner's workspace."""
    invite = client.post(
        f"/api/v1/workspaces/{owner['workspace_id']}/invites",
        headers=owner["headers"],
        json={"role": role},
    ).json()["invite"]
    data = register_user(client, email=None, name="Otto")
    member = {
        "user": data["user"],
        "headers": auth_headers(data["access_token"]),
        "workspace_id": owner["workspace_id"],
    }
    resp = client.post(
        "/api/v1/invites/accept", headers=member["headers"], json={"token": invite["token"]}
    )
    assert resp.status_code == 200
    return member


# ---------------------------------------------------------------------------
# Feature gate
# ---------------------------------------------------------------------------
def test_disabled_hides_every_endpoint(client, user):
    ping = {"jsonrpc": "2.0", "id": 1, "method": "ping"}
    assert client.get("/api/v1/me/mcp", headers=user["headers"]).status_code == 404
    assert client.post("/api/v1/me/mcp/key", headers=user["headers"]).status_code == 404
    assert client.get("/api/v1/mcp").status_code == 404
    assert client.post("/api/v1/mcp", json=ping).status_code == 404


def test_disabled_hides_the_endpoint_even_with_a_valid_key(client, user, mcp_on):
    key = mcp_key(client, user)
    get_settings().mcp_enabled = False
    assert rpc(client, key, "ping").status_code == 404


def test_get_on_the_endpoint_is_405_when_enabled(client, mcp_on):
    resp = client.get("/api/v1/mcp")
    assert resp.status_code == 405
    assert resp.headers["allow"] == "POST"


def test_routes_stay_out_of_the_openapi_schema(client, mcp_on):
    paths = client.get("/api/v1/openapi.json").json()["paths"]
    assert not [p for p in paths if "mcp" in p]


# ---------------------------------------------------------------------------
# Key lifecycle
# ---------------------------------------------------------------------------
def test_reading_settings_does_not_mint_a_key(client, user, mcp_on):
    first = mcp_settings(client, user)
    assert first["enabled"] is True
    assert first["key"] is None
    assert first["claude_code_command"] is None
    assert first["endpoint"].endswith("/api/v1/mcp")
    # Re-reading still must not mint one.
    assert mcp_settings(client, user)["key"] is None


def test_key_is_generated_on_explicit_request_and_then_readable(client, user, mcp_on):
    generated = client.post("/api/v1/me/mcp/key", headers=user["headers"]).json()
    assert generated["key"].startswith("balu_mcp_")
    assert generated["key"] in generated["claude_code_command"]
    assert generated["endpoint"] in generated["claude_code_command"]
    # The product requirement: the user can come back and see the same key.
    assert mcp_settings(client, user)["key"] == generated["key"]


def test_regenerating_invalidates_the_previous_key(client, user, mcp_on):
    old = mcp_key(client, user)
    new = mcp_key(client, user)
    assert new != old
    assert rpc(client, old, "ping").status_code == 401
    assert rpc(client, new, "ping").status_code == 200


def test_key_endpoints_require_a_session(client, mcp_on):
    assert client.get("/api/v1/me/mcp").status_code == 401
    assert client.post("/api/v1/me/mcp/key").status_code == 401


# ---------------------------------------------------------------------------
# Transport
# ---------------------------------------------------------------------------
def test_missing_and_bad_keys_are_rejected(client, user, mcp_on):
    mcp_key(client, user)
    anonymous = client.post("/api/v1/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "ping"})
    assert anonymous.status_code == 401
    assert anonymous.headers["www-authenticate"].startswith("Bearer")
    assert rpc(client, "balu_mcp_nope", "ping").status_code == 401
    assert rpc(client, "not-even-prefixed", "ping").status_code == 401


def test_repeated_auth_failures_are_rate_limited(client, user, mcp_on):
    from balu.ratelimit import MCP_AUTH_PER_IP

    for _ in range(MCP_AUTH_PER_IP.limit):
        assert rpc(client, "balu_mcp_wrong", "ping").status_code == 401
    assert rpc(client, "balu_mcp_wrong", "ping").status_code == 429


def test_successful_calls_do_not_spend_the_auth_budget(client, user, mcp_on):
    from balu.ratelimit import MCP_AUTH_PER_IP

    key = mcp_key(client, user)
    for _ in range(MCP_AUTH_PER_IP.limit + 5):
        assert rpc(client, key, "ping").status_code == 200


def test_initialize_negotiates_the_only_supported_version(client, user, mcp_on):
    key = mcp_key(client, user)
    resp = rpc(client, key, "initialize", {"protocolVersion": "2025-06-18", "capabilities": {}})
    result = resp.json()["result"]
    assert result["protocolVersion"] == "2025-06-18"
    assert "tools" in result["capabilities"]
    assert result["serverInfo"]["name"] == "balu"

    # Anything else gets our version back; the client decides whether to continue.
    older = rpc(client, key, "initialize", {"protocolVersion": "2024-11-05"}).json()["result"]
    assert older["protocolVersion"] == "2025-06-18"


def test_initialized_notification_gets_no_body(client, user, mcp_on):
    key = mcp_key(client, user)
    resp = rpc(client, key, "notifications/initialized", {}, id_=None)
    assert resp.status_code == 202
    assert resp.content == b""


def test_a_malformed_notification_is_still_never_answered(client, user, mcp_on):
    key = mcp_key(client, user)
    resp = client.post(
        "/api/v1/mcp",
        headers={"Authorization": f"Bearer {key}"},
        json={"jsonrpc": "2.0", "method": 42},
    )
    assert resp.status_code == 202
    assert resp.content == b""


def test_unknown_method_and_bad_bodies(client, user, mcp_on):
    key = mcp_key(client, user)
    unknown = rpc(client, key, "resources/list").json()
    assert unknown["error"]["code"] == -32601

    broken = client.post(
        "/api/v1/mcp",
        headers={"Authorization": f"Bearer {key}", "content-type": "application/json"},
        content=b"{not json",
    )
    assert broken.status_code == 400
    assert broken.json()["error"]["code"] == -32700

    # Valid JSON that is not a request object (a batch, say) is Invalid Request.
    batch = client.post(
        "/api/v1/mcp",
        headers={"Authorization": f"Bearer {key}"},
        json=[{"jsonrpc": "2.0", "id": 1, "method": "ping"}],
    )
    assert batch.status_code == 400
    assert batch.json()["error"]["code"] == -32600


def test_tools_list_advertises_schemas(client, user, mcp_on):
    key = mcp_key(client, user)
    tools = rpc(client, key, "tools/list").json()["result"]["tools"]
    names = {t["name"] for t in tools}
    assert names == {
        "list_workspaces",
        "list_projects",
        "list_tasks",
        "get_task",
        "create_task",
        "update_task",
        "complete_task",
        "reopen_task",
        "add_comment",
    }
    for tool in tools:
        assert tool["description"]
        assert tool["inputSchema"]["type"] == "object"
        assert "properties" in tool["inputSchema"]


# ---------------------------------------------------------------------------
# Tools
# ---------------------------------------------------------------------------
def test_list_workspaces_and_projects(client, user, mcp_on):
    key = mcp_key(client, user)
    sync(client, user, "*", [cmd("project_add", temp_id="p1", name="Haushalt")])

    workspaces = call(client, key, "list_workspaces", {})
    assert user["workspace_id"] in payload(workspaces)
    assert '"your_role": "owner"' in payload(workspaces)

    projects = call(client, key, "list_projects", {"workspace_id": user["workspace_id"]})
    assert "Haushalt" in payload(projects)


def test_create_task_shows_up_in_the_sync_feed(client, user, mcp_on):
    key = mcp_key(client, user)
    before = sync(client, user, "*")
    result = call(
        client,
        key,
        "create_task",
        {"workspace_id": user["workspace_id"], "title": "Milch kaufen", "deadline": "2026-09-01"},
    )
    assert result["isError"] is False
    assert "Milch kaufen" in payload(result)

    delta = sync(client, user, before["sync_token"])
    assert [t["title"] for t in delta["tasks"]] == ["Milch kaufen"]
    assert delta["tasks"][0]["deadline"] == "2026-09-01"


def test_task_lifecycle_over_mcp(client, user, mcp_on):
    key = mcp_key(client, user)
    ws = user["workspace_id"]
    created = call(client, key, "create_task", {"workspace_id": ws, "title": "Wäsche"})
    task_id = task_id_of(created)

    updated = call(
        client, key, "update_task", {"workspace_id": ws, "task_id": task_id, "notes": "60 Grad"}
    )
    assert "60 Grad" in payload(updated)

    call(client, key, "add_comment", {"workspace_id": ws, "task_id": task_id, "body": "läuft"})
    detail = call(client, key, "get_task", {"workspace_id": ws, "task_id": task_id})
    assert "läuft" in payload(detail)

    done = call(client, key, "complete_task", {"workspace_id": ws, "task_id": task_id})
    assert '"completed": true' in payload(done)
    reopened = call(client, key, "reopen_task", {"workspace_id": ws, "task_id": task_id})
    assert '"completed": false' in payload(reopened)

    open_tasks = call(client, key, "list_tasks", {"workspace_id": ws, "search": "wäsche"})
    assert '"count": 1' in payload(open_tasks)
    completed_only = call(client, key, "list_tasks", {"workspace_id": ws, "status": "completed"})
    assert '"count": 0' in payload(completed_only)


def test_update_task_moves_project_and_section(client, user, mcp_on):
    key = mcp_key(client, user)
    ws = user["workspace_id"]
    first = sync(
        client,
        user,
        "*",
        [
            cmd("project_add", temp_id="p1", name="Haushalt"),
            cmd("section_add", temp_id="s1", project_id="p1", name="Küche"),
        ],
    )
    project_id = first["temp_id_mapping"]["p1"]
    section_id = first["temp_id_mapping"]["s1"]

    task_id = task_id_of(call(client, key, "create_task", {"workspace_id": ws, "title": "Spülen"}))
    moved = call(
        client,
        key,
        "update_task",
        {
            "workspace_id": ws,
            "task_id": task_id,
            "notes": "mit der Hand",
            "project_id": project_id,
            "section_id": section_id,
        },
    )
    assert moved["isError"] is False
    assert '"project": "Haushalt"' in payload(moved)
    assert '"section": "Küche"' in payload(moved)
    assert "mit der Hand" in payload(moved)

    # Clearing puts it back in the inbox.
    cleared = call(
        client, key, "update_task", {"workspace_id": ws, "task_id": task_id, "project_id": None}
    )
    assert '"project_id": null' in payload(cleared)


def test_a_rejected_move_is_refused_before_anything_is_applied(client, user, mcp_on):
    """The two halves of update_task commit separately, so a bad reference in the
    second must not let the first through."""
    key = mcp_key(client, user)
    ws = user["workspace_id"]
    first = sync(
        client,
        user,
        "*",
        [
            cmd("project_add", temp_id="p1", name="Haushalt"),
            cmd("project_add", temp_id="p2", name="Arbeit"),
            cmd("section_add", temp_id="s1", project_id="p1", name="Küche"),
        ],
    )
    task_id = task_id_of(call(client, key, "create_task", {"workspace_id": ws, "title": "Spülen"}))

    # A section from another project: rejected, and `notes` must not have stuck.
    result = call(
        client,
        key,
        "update_task",
        {
            "workspace_id": ws,
            "task_id": task_id,
            "notes": "darf nicht bleiben",
            "project_id": first["temp_id_mapping"]["p2"],
            "section_id": first["temp_id_mapping"]["s1"],
        },
    )
    assert result["isError"] is True
    assert "section_id must belong" in payload(result)
    assert "applied" not in payload(result)

    after = call(client, key, "get_task", {"workspace_id": ws, "task_id": task_id})
    assert "darf nicht bleiben" not in payload(after)
    assert '"notes": null' in payload(after)


def test_apply_stops_at_the_first_rejection_and_names_what_committed(client, user, db, mcp_on):
    """Each command commits in its own transaction, so a multi-command tool must
    stop at the first rejection and say how far it got."""
    import uuid as uuidlib

    from balu.db import get_sessionmaker
    from balu.mcp.tools import ToolContext, ToolError, _apply
    from balu.models import User as UserRow
    from balu.schemas.sync import Command

    ws_id = uuidlib.UUID(user["workspace_id"])
    ctx = ToolContext(
        db=db,
        sm=get_sessionmaker(),
        user=db.get(UserRow, uuidlib.UUID(user["user"]["id"])),
        event_sender=lambda *args, **kwargs: None,
    )
    commands = [
        Command(type="task_add", uuid=str(uuidlib.uuid4()), temp_id="ok", args={"title": "Erste"}),
        # References a task that does not exist: rejected by the handler.
        Command(
            type="task_update",
            uuid=str(uuidlib.uuid4()),
            args={"id": str(uuidlib.uuid4()), "title": "Zweite"},
        ),
        Command(
            type="task_add", uuid=str(uuidlib.uuid4()), temp_id="never", args={"title": "Dritte"}
        ),
    ]
    with pytest.raises(ToolError) as raised:
        _apply(ctx, ws_id, "owner", commands)
    assert raised.value.applied == ["task_add"]

    # The first committed, the third never ran.
    assert [t["title"] for t in sync(client, user, "*")["tasks"]] == ["Erste"]


def test_list_tasks_filters(client, user, mcp_on):
    key = mcp_key(client, user)
    ws = user["workspace_id"]
    for title, deadline in (("Früh", "2026-01-05"), ("Spät", "2026-12-05")):
        call(client, key, "create_task", {"workspace_id": ws, "title": title, "deadline": deadline})

    early = call(client, key, "list_tasks", {"workspace_id": ws, "deadline_to": "2026-06-01"})
    assert "Früh" in payload(early) and "Spät" not in payload(early)

    mine = call(client, key, "list_tasks", {"workspace_id": ws, "assigned_to_me": True})
    assert '"count": 0' in payload(mine)


def test_list_tasks_limit_is_validated_and_capped(client, user, mcp_on):
    key = mcp_key(client, user)
    ws = user["workspace_id"]
    for n in range(3):
        call(client, key, "create_task", {"workspace_id": ws, "title": f"T{n}"})

    limited = call(client, key, "list_tasks", {"workspace_id": ws, "limit": 2})
    assert '"count": 2' in payload(limited)
    assert '"truncated": true' in payload(limited)

    everything = call(client, key, "list_tasks", {"workspace_id": ws, "limit": 1000})
    assert '"count": 3' in payload(everything)
    assert '"truncated": false' in payload(everything)

    # Garbage is an actionable tool error, never a -32603 protocol error.
    bad = call(client, key, "list_tasks", {"workspace_id": ws, "limit": "abc"})
    assert bad["isError"] is True
    assert "limit must be an integer" in payload(bad)


def test_search_treats_wildcards_literally(client, user, mcp_on):
    key = mcp_key(client, user)
    ws = user["workspace_id"]
    call(client, key, "create_task", {"workspace_id": ws, "title": "50% Rabatt"})
    call(client, key, "create_task", {"workspace_id": ws, "title": "nichts davon"})

    hit = call(client, key, "list_tasks", {"workspace_id": ws, "search": "50%"})
    assert '"count": 1' in payload(hit)
    # As a wildcard "%o%" would match both titles; as a literal it matches neither.
    miss = call(client, key, "list_tasks", {"workspace_id": ws, "search": "%o%"})
    assert '"count": 0' in payload(miss)


def test_labels_and_assignee_round_trip(client, user, mcp_on):
    key = mcp_key(client, user)
    ws = user["workspace_id"]
    member = _join(client, user, role="member")
    sync(client, user, "*", [cmd("label_add", temp_id="l1", name="Haushalt")])

    created = call(
        client,
        key,
        "create_task",
        {
            "workspace_id": ws,
            "title": "Einkaufen",
            "labels": ["haushalt"],  # names resolve case-insensitively
            "assignee_id": member["user"]["id"],
        },
    )
    assert created["isError"] is False
    assert '"labels": [\n      "Haushalt"\n    ]' in payload(created)
    assert f'"assignee_id": "{member["user"]["id"]}"' in payload(created)
    assert '"assignee": "Otto"' in payload(created)

    task_id = task_id_of(created)
    unassigned = call(
        client, key, "update_task", {"workspace_id": ws, "task_id": task_id, "assignee_id": None}
    )
    assert '"assignee_id": null' in payload(unassigned)


def test_assignee_must_be_a_member(client, user, mcp_on):
    key = mcp_key(client, user)
    stranger = register_user(client, email=None, name="Fremd")
    result = call(
        client,
        key,
        "create_task",
        {
            "workspace_id": user["workspace_id"],
            "title": "X",
            "assignee_id": stranger["user"]["id"],
        },
    )
    assert result["isError"] is True
    assert "must be a member of this workspace" in payload(result)


def test_unknown_label_is_a_tool_error_not_a_protocol_error(client, user, mcp_on):
    key = mcp_key(client, user)
    result = call(
        client,
        key,
        "create_task",
        {"workspace_id": user["workspace_id"], "title": "X", "labels": ["nope"]},
    )
    assert result["isError"] is True
    assert "unknown label" in payload(result)


def test_tools_are_scoped_to_the_callers_workspaces(client, user, mcp_on):
    key = mcp_key(client, user)
    stranger = register_user(client, email=None, name="Fremd")
    other_ws = client.get(
        "/api/v1/me", headers=auth_headers(stranger["access_token"])
    ).json()["memberships"][0]["workspace"]["id"]

    result = call(client, key, "list_tasks", {"workspace_id": other_ws})
    assert result["isError"] is True
    assert "not found" in payload(result)


def test_viewer_can_read_but_not_mutate(client, user, mcp_on):
    viewer = _join(client, user, role="viewer")
    key = mcp_key(client, viewer)
    ws = user["workspace_id"]
    sync(client, user, "*", [cmd("task_add", temp_id="t1", title="Nur lesen")])

    listed = call(client, key, "list_tasks", {"workspace_id": ws})
    assert "Nur lesen" in payload(listed)

    blocked = call(client, key, "create_task", {"workspace_id": ws, "title": "Nope"})
    assert blocked["isError"] is True
    assert "viewer role is read-only" in payload(blocked)


def test_unknown_tool_is_reported_as_a_tool_error(client, user, mcp_on):
    key = mcp_key(client, user)
    result = call(client, key, "delete_everything", {})
    assert result["isError"] is True
    assert "unknown tool" in payload(result)
