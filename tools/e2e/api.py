#!/usr/bin/env python3
"""API helpers for e2e runs against a balu stack (see README.md).

Prints statuses and counts only: never a password, token, invite token or body.
"""
from __future__ import annotations

import argparse
import datetime
import json
import mimetypes
import os
import sys

import balu_e2e as e

PROJECT_NAME = "E2E Project"


def ws_id() -> str:
    return e.load("ws.id")


def tasks_map() -> dict:
    try:
        return json.loads(e.load("tasks.json"))
    except SystemExit:
        return {}


def task_id(title: str) -> str:
    tid = tasks_map().get(title)
    if not tid:
        raise SystemExit(f"unknown task title: {title}")
    return tid


def today() -> str:
    return datetime.date.today().isoformat()


def task_add(title: str, project_temp: str | None = None) -> dict:
    args = {"title": title, "start_date": today()}
    if project_temp:
        args["project_id"] = project_temp
    tmp = e.new_temp_id()
    return {"type": "task_add", "uuid": e.new_uuid(), "temp_id": tmp, "args": args}


def ok(status: int) -> int:
    return 0 if 200 <= status < 300 else 1


def synced(status: int, body: dict) -> int:
    return 0 if ok(status) == 0 and e.statuses(body) == ["ok"] else 1


def cmd_health(_a) -> int:
    s = e.health()
    print("healthz", s)
    return 0 if s == 200 else 1


def cmd_setup(a) -> int:
    print("owner register", e.register("owner", "E2E Owner"))
    print("member register", e.register("member", "E2E Member"))
    s, me = e.authed("owner", "GET", "/me")
    owned = [m for m in me.get("memberships", []) if m.get("role") == "owner"]
    if s != 200 or not owned:
        raise SystemExit(f"owner has no workspace (GET /me -> {s})")
    ws = owned[0]["workspace"]["id"]
    e.save("ws.id", ws)
    s, mme = e.authed("member", "GET", "/me")
    cur = [m for m in mme.get("memberships", []) if m["workspace"]["id"] == ws]
    if cur:
        have = cur[0].get("role")
        if a.member_role and have != a.member_role:
            path = f"/workspaces/{ws}/members/{e.load('member.uid')}"
            s3, _ = e.authed("owner", "PATCH", path, {"role": a.member_role})
            print("member already in workspace; role", have, "->", a.member_role, s3)
            if s3 not in (200, 204):
                raise SystemExit(f"set role: HTTP {s3}")
        else:
            print("member already in workspace; role kept:", have)
    else:
        role = a.member_role or "viewer"
        s, inv = e.authed("owner", "POST", f"/workspaces/{ws}/invites", {"role": role})
        print("invite", s)
        if s not in (200, 201):
            raise SystemExit(f"invite: HTTP {s}")
        s2, _ = e.authed("member", "POST", "/invites/accept", {"token": inv["invite"]["token"]})
        print("accept", s2)
        if s2 not in (200, 201):
            raise SystemExit(f"accept: HTTP {s2}")
    s, snap = e.sync("owner", ws, [])
    existing = [
        p for p in snap.get("projects", [])
        if p.get("name") == PROJECT_NAME and not p.get("is_deleted")
    ]
    if existing:
        e.save("project.id", existing[0]["id"])
        # an interrupted setup may have left no tasks.json: rebuild it from the snapshot
        known = tasks_map()
        seen: set[str] = set()
        for t in snap.get("tasks", []):
            if t.get("project_id") == existing[0]["id"] and not t.get("is_deleted"):
                # the snapshot wins over a stale tasks.json; first seen per title
                if t["title"] not in seen:
                    seen.add(t["title"])
                    known[t["title"]] = t["id"]
        e.save("tasks.json", json.dumps(known))
        print("project exists")
        return 0
    proj = e.new_temp_id()
    commands = [
        {
            "type": "project_add",
            "uuid": e.new_uuid(),
            "temp_id": proj,
            "args": {"name": PROJECT_NAME},
        }
    ]
    titles = []
    task_tmps = []
    for i in range(a.tasks):
        c = task_add(f"E2E Task {chr(65 + i)}", proj)
        commands.append(c)
        titles.append(c["args"]["title"])
        task_tmps.append(c["temp_id"])
    s, b = e.sync("owner", ws, commands)
    mapping = b.get("temp_id_mapping", {})
    if proj in mapping:
        e.save("project.id", mapping[proj])
    ids = {t: mapping[m] for t, m in zip(titles, task_tmps, strict=True) if m in mapping}
    e.save("tasks.json", json.dumps(ids))
    print("seed", s, e.statuses(b))
    print("tasks", len(tasks_map()))
    return 0 if s == 200 and e.statuses(b) == ["ok"] else 1


def cmd_role(a) -> int:
    path = f"/workspaces/{ws_id()}/members/{e.load('member.uid')}"
    s, _ = e.authed("owner", "PATCH", path, {"role": a.role})
    print("set role", a.role, "->", s)
    return ok(s)


def cmd_bulk(a) -> int:
    commands = [task_add(f"E2E Bulk {i + 1:02d}") for i in range(a.n)]
    s, b = e.sync("owner", ws_id(), commands)
    mapping = b.get("temp_id_mapping", {})
    known = tasks_map()
    for c in commands:
        if c["temp_id"] in mapping:
            known[c["args"]["title"]] = mapping[c["temp_id"]]
    e.save("tasks.json", json.dumps(known))
    print("bulk", s, "tasks", len(known))
    return synced(s, b)


def cmd_edit_task(a) -> int:
    value: object = a.value
    if a.field == "priority":
        value = int(a.value)
    elif a.field == "evening":
        value = a.value.lower() in ("1", "true", "t", "yes")
    args = {"id": task_id(a.title), a.field: value}
    cmd = {"type": "task_update", "uuid": e.new_uuid(), "args": args}
    s, b = e.sync("owner", ws_id(), [cmd])
    print("task_update", a.title, a.field, "->", s, e.statuses(b))
    return synced(s, b)


def cmd_delete_task(a) -> int:
    cmd = {"type": "task_delete", "uuid": e.new_uuid(), "args": {"id": task_id(a.title)}}
    s, b = e.sync("owner", ws_id(), [cmd])
    print("task_delete", a.title, "->", s, e.statuses(b))
    return synced(s, b)


def cmd_attach(a) -> int:
    """Upload FILE to a task as the owner (CONTRACT 3.7.1: multipart task_id + file)."""
    try:
        with open(a.file, "rb") as f:
            blob = f.read()
    except OSError as err:
        raise SystemExit(f"cannot read {a.file}: {err.strerror}") from None
    boundary = "balu-e2e-" + e.new_uuid()
    name = os.path.basename(a.file).replace('"', "")
    ctype = mimetypes.guess_type(name)[0] or "application/octet-stream"
    body = (
        (
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"task_id\"\r\n\r\n"
            f"{task_id(a.title)}\r\n"
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; "
            f"filename=\"{name}\"\r\nContent-Type: {ctype}\r\n\r\n"
        ).encode()
        + blob
        + f"\r\n--{boundary}--\r\n".encode()
    )
    s, b = e.authed(
        "owner",
        "POST",
        f"/workspaces/{ws_id()}/attachments",
        raw=(body, f"multipart/form-data; boundary={boundary}"),
    )
    att = b.get("attachment", b)
    print(
        "attach", a.title, "->", s,
        att.get("filename", ""), att.get("content_type", ""), att.get("size_bytes", ""),
    )
    return ok(s)


def cmd_project_delete(_a) -> int:
    cmd = {"type": "project_delete", "uuid": e.new_uuid(), "args": {"id": e.load("project.id")}}
    s, b = e.sync("owner", ws_id(), [cmd])
    print("project_delete ->", s, e.statuses(b))
    return synced(s, b)


def cmd_remove_member(_a) -> int:
    s, _ = e.authed("owner", "DELETE", f"/workspaces/{ws_id()}/members/{e.load('member.uid')}")
    print("remove member ->", s)
    return ok(s)


def cmd_ws2(_a) -> int:
    s, w = e.authed("owner", "POST", "/workspaces", {"name": "E2E Second"})
    print("create workspace", s)
    if s not in (200, 201):
        return 1
    ws2 = w["id"]
    e.save("ws2.id", ws2)
    proj = e.new_temp_id()
    task = task_add("W2 Task", proj)
    commands = [
        {
            "type": "project_add",
            "uuid": e.new_uuid(),
            "temp_id": proj,
            "args": {"name": "W2 Project"},
        },
        task,
    ]
    s, b = e.sync("owner", ws2, commands)
    print("seed", s, e.statuses(b))
    return synced(s, b)


def cmd_sync_probe(a) -> int:
    s, b = e.sync(a.role, ws_id(), [])
    live = [t for t in b.get("tasks", []) if not t.get("is_deleted")]
    print(a.role, "sync", s, "tasks", len(live), "projects", len(b.get("projects", [])))
    return ok(s)


def cmd_me(a) -> int:
    s, b = e.authed(a.role, "GET", "/me")
    ms = b.get("memberships", [])
    print("memberships", len(ms), "roles", sorted(m.get("role", "?") for m in ms))
    return 0 if s == 200 else 1


def cmd_invite(a) -> int:
    s, b = e.authed("owner", "POST", f"/workspaces/{ws_id()}/invites", {"role": a.role})
    if s in (200, 201):
        e.save(f"invite-{a.role}.token", b["invite"]["token"])
    print("invite", s)
    return 0 if s in (200, 201) else 1


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("health").set_defaults(fn=cmd_health)
    s = sub.add_parser("setup")
    s.add_argument("--member-role", choices=["viewer", "member", "admin"], default=None)
    s.add_argument("--tasks", type=int, default=5)
    s.set_defaults(fn=cmd_setup)
    s = sub.add_parser("role")
    s.add_argument("role")
    s.set_defaults(fn=cmd_role)
    s = sub.add_parser("bulk")
    s.add_argument("n", type=int)
    s.set_defaults(fn=cmd_bulk)
    s = sub.add_parser("edit-task")
    s.add_argument("title")
    s.add_argument("field")
    s.add_argument("value")
    s.set_defaults(fn=cmd_edit_task)
    s = sub.add_parser("delete-task")
    s.add_argument("title")
    s.set_defaults(fn=cmd_delete_task)
    s = sub.add_parser("attach")
    s.add_argument("title")
    s.add_argument("file")
    s.set_defaults(fn=cmd_attach)
    sub.add_parser("project-delete").set_defaults(fn=cmd_project_delete)
    sub.add_parser("remove-member").set_defaults(fn=cmd_remove_member)
    sub.add_parser("ws2").set_defaults(fn=cmd_ws2)
    s = sub.add_parser("sync-probe")
    s.add_argument("--role", default="member")
    s.set_defaults(fn=cmd_sync_probe)
    s = sub.add_parser("me")
    s.add_argument("--role", default="owner")
    s.set_defaults(fn=cmd_me)
    s = sub.add_parser("invite")
    s.add_argument("role")
    s.set_defaults(fn=cmd_invite)
    a = p.parse_args()
    return a.fn(a)


if __name__ == "__main__":
    sys.exit(main())
