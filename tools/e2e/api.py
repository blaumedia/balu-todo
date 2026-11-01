#!/usr/bin/env python3
"""API helpers for e2e runs against a balu stack (see README.md).

Prints statuses and counts only: never a password, token, invite token or body.
"""
from __future__ import annotations

import argparse
import contextlib
import datetime
import json
import mimetypes
import os
import re
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
    live = [p for p in snap.get("projects", []) if not p.get("is_deleted")]
    # a stored project.id that is still alive wins, so a renamed project is not duplicated
    stored = None
    with contextlib.suppress(SystemExit):
        stored = e.load("project.id")
    existing = [p for p in live if p.get("id") == stored] or [
        p for p in live if p.get("name") == PROJECT_NAME
    ]
    if existing:
        e.save("project.id", existing[0]["id"])
        # an interrupted setup may have left no tasks.json: rebuild it from the snapshot
        known = tasks_map()
        seen: set[str] = set()
        for t in snap.get("tasks", []):
            in_project = t.get("project_id") == existing[0]["id"] and not t.get("is_deleted")
            # the snapshot wins over a stale tasks.json; first seen per title
            if in_project and t["title"] not in seen:
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
    name = re.sub(r'[\r\n"\\]', "_", os.path.basename(a.file))
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


def labels_map() -> dict:
    try:
        return json.loads(e.load("labels.json"))
    except SystemExit:
        return {}


def cmd_label(a) -> int:
    """Create a label NAME as the owner (CONTRACT 4: label_add); remembered for label-task."""
    # idempotent: a live label of that name (case-insensitive) is reused, so a rerun
    # or a wiped labels.json does not hit name_taken
    s, snap = e.sync("owner", ws_id(), [])
    for lab in snap.get("labels", []):
        if not lab.get("is_deleted") and str(lab.get("name", "")).lower() == a.name.lower():
            known = labels_map()
            known[a.name] = lab["id"]
            e.save("labels.json", json.dumps(known))
            print("label exists", a.name, "->", s)
            return ok(s)
    tmp = e.new_temp_id()
    cmd = {"type": "label_add", "uuid": e.new_uuid(), "temp_id": tmp, "args": {"name": a.name}}
    s, b = e.sync("owner", ws_id(), [cmd])
    mapping = b.get("temp_id_mapping", {})
    if tmp in mapping:
        known = labels_map()
        known[a.name] = mapping[tmp]
        e.save("labels.json", json.dumps(known))
    print("label_add", a.name, "->", s, e.statuses(b))
    return synced(s, b)


def cmd_label_task(a) -> int:
    """Add label LABEL (created with `label`) to a task, keeping its other labels."""
    lid = labels_map().get(a.label)
    if not lid:
        raise SystemExit(f"unknown label: {a.label}")
    tid = task_id(a.title)
    s0, snap = e.sync("owner", ws_id(), [])
    if s0 != 200:
        raise SystemExit(f"label-task: snapshot HTTP {s0}")
    cur = [t for t in snap.get("tasks", []) if t.get("id") == tid and not t.get("is_deleted")]
    if not cur:
        raise SystemExit(f"label-task: task not found in snapshot: {a.title}")
    have = list(cur[0].get("label_ids", []))
    if lid not in have:
        have.append(lid)
    args = {"id": tid, "label_ids": have}
    cmd = {"type": "task_update", "uuid": e.new_uuid(), "args": args}
    s, b = e.sync("owner", ws_id(), [cmd])
    print("label-task", a.title, a.label, "->", s, e.statuses(b))
    return synced(s, b)


def cmd_comment(a) -> int:
    cmd = {
        "type": "comment_add",
        "uuid": e.new_uuid(),
        "temp_id": e.new_temp_id(),
        "args": {"task_id": task_id(a.title), "body": a.text},
    }
    s, b = e.sync("owner", ws_id(), [cmd])
    print("comment_add", a.title, "->", s, e.statuses(b))
    return synced(s, b)


def cmd_subtask(a) -> int:
    parent = task_id(a.parent)
    tmp = e.new_temp_id()
    args = {"title": a.title, "parent_task_id": parent, }
    if a.start or not a.deadline:
        args["start_date"] = a.start or today()
    if a.deadline:
        args["deadline"] = a.deadline
    cmd = {"type": "task_add", "uuid": e.new_uuid(), "temp_id": tmp, "args": args}
    s, b = e.sync("owner", ws_id(), [cmd])
    mapping = b.get("temp_id_mapping", {})
    if tmp in mapping:
        known = tasks_map()
        known[a.title] = mapping[tmp]
        e.save("tasks.json", json.dumps(known))
    print("subtask", a.title, "of", a.parent, "->", s, e.statuses(b))
    return synced(s, b)


def cmd_project_rename(a) -> int:
    args = {"id": e.load("project.id"), "name": a.name}
    cmd = {"type": "project_update", "uuid": e.new_uuid(), "args": args}
    s, b = e.sync("owner", ws_id(), [cmd])
    print("project_update ->", s, e.statuses(b))
    return synced(s, b)


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
    s = sub.add_parser("label")
    s.add_argument("name")
    s.set_defaults(fn=cmd_label)
    s = sub.add_parser("label-task")
    s.add_argument("title")
    s.add_argument("label")
    s.set_defaults(fn=cmd_label_task)
    s = sub.add_parser("comment")
    s.add_argument("title")
    s.add_argument("text")
    s.set_defaults(fn=cmd_comment)
    s = sub.add_parser("subtask")
    s.add_argument("parent")
    s.add_argument("title")
    s.add_argument("--start", default=None, metavar="YYYY-MM-DD")
    s.add_argument("--deadline", default=None, metavar="YYYY-MM-DD")
    s.set_defaults(fn=cmd_subtask)
    s = sub.add_parser("project-rename")
    s.add_argument("name")
    s.set_defaults(fn=cmd_project_rename)
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
