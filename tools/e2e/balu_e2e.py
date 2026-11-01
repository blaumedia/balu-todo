"""Shared helpers for the e2e CLIs (stdlib only).

State (generated passwords, tokens, ids) lives in ~/.cache/balu-e2e/<project>/<run>/
(one directory per BALU_E2E_RUN) with mode 700/600. Nothing here prints a password, a token
or a request/response body.
"""
from __future__ import annotations

import json
import os
import re
import secrets
import string
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
PROJECT = os.environ.get("BALU_E2E_PROJECT") or f"balu-e2e-{REPO_ROOT.name}"
PORT = int(os.environ.get("BALU_PORT", "8090"))
BASE = os.environ.get("BALU_E2E_BASE", f"http://127.0.0.1:{PORT}")
API = BASE + "/api/v1"
STATE = Path(os.environ.get("BALU_E2E_STATE") or Path.home() / ".cache" / "balu-e2e" / PROJECT)
RUN = os.environ.get("BALU_E2E_RUN") or time.strftime("%Y%m%d")
# same file and rule as stack.sh: purge may only delete dirs that carry it
MARKER = ".balu-e2e-state"
_SAFE = re.compile(r"[A-Za-z0-9_-]+")
if not _SAFE.fullmatch(RUN):
    raise SystemExit("BALU_E2E_RUN must match [A-Za-z0-9_-]+ (it is used in paths and emails)")
if os.environ.get("BALU_E2E_PROJECT") and not re.fullmatch(r"[a-z0-9_-]+", PROJECT):
    raise SystemExit(
        "BALU_E2E_PROJECT must match [a-z0-9_-]+ (compose needs lowercase; it is used in paths)"
    )
TOKEN_MAX_AGE = 25 * 60  # server access tokens live 30 min (config.access_token_expire_minutes)


def state_dir() -> Path:
    marker = STATE / MARKER
    # same rule as stack.sh ensure_env: adopt only a new, empty or already marked dir
    if not marker.exists() and STATE.is_dir() and any(STATE.iterdir()):
        raise SystemExit(f"refusing to use {STATE}: not empty and not created by stack.sh")
    STATE.mkdir(parents=True, exist_ok=True)
    STATE.chmod(0o700)
    os.close(os.open(marker, os.O_WRONLY | os.O_CREAT, 0o600))
    return STATE


def run_dir() -> Path:
    path = state_dir() / RUN
    path.mkdir(exist_ok=True)
    path.chmod(0o700)
    return path


def save(name: str, value: str) -> None:
    path = run_dir() / name
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    try:
        os.fchmod(fd, 0o600)
        os.write(fd, value.encode("utf-8"))
    finally:
        os.close(fd)


def load(name: str) -> str:
    path = run_dir() / name
    if not path.exists():
        raise SystemExit(f"missing {name} in the state dir: run api.py setup first")
    return path.read_text(encoding="utf-8").strip()


def password(role: str) -> str:
    name = f"{role}.pw"
    if not (run_dir() / name).exists():
        alphabet = string.ascii_letters + string.digits
        save(name, "".join(secrets.choice(alphabet) for _ in range(24)))
    return load(name)


def email(role: str) -> str:
    return f"e2e-{RUN}-{role}@example.com"


def new_temp_id() -> str:
    # Reusing a temp_id maps to the earlier object (CONTRACT section 5.3: the mapping is persisted).
    return f"tmp-{uuid.uuid4().hex}"


def new_uuid() -> str:
    return str(uuid.uuid4())


def req(method: str, path: str, body=None, token: str | None = None) -> tuple[int, dict]:
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(API + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=60) as r:
            status, raw = r.status, r.read()
    except urllib.error.HTTPError as err:
        status, raw = err.code, err.read()
    except urllib.error.URLError:
        raise SystemExit(f"{method} {path}: server unreachable at {BASE}") from None
    try:
        parsed = json.loads(raw) if raw else {}
    except ValueError:
        parsed = {}
    return status, parsed if isinstance(parsed, dict) else {}


def health() -> int:
    try:
        with urllib.request.urlopen(BASE + "/healthz", timeout=10) as r:
            return r.status
    except urllib.error.HTTPError as err:
        return err.code
    except (urllib.error.URLError, OSError):
        return 0


def register(role: str, name: str) -> int:
    s, b = req(
        "POST",
        "/auth/register",
        {"email": email(role), "password": password(role), "name": name},
    )
    if s == 201:
        save(f"{role}.tok", b["access_token"])
        save(f"{role}.uid", b["user"]["id"])
    else:
        login(role)
    return s


def login(role: str) -> str:
    s, b = req("POST", "/auth/login", {"email": email(role), "password": password(role)})
    if s != 200:
        raise SystemExit(f"login {role}: HTTP {s}")
    save(f"{role}.tok", b["access_token"])
    save(f"{role}.uid", b["user"]["id"])
    return b["access_token"]


def token(role: str) -> str:
    path = run_dir() / f"{role}.tok"
    if path.exists() and time.time() - path.stat().st_mtime < TOKEN_MAX_AGE:
        return path.read_text(encoding="utf-8").strip()
    return login(role)


def authed(role: str, method: str, path: str, body=None) -> tuple[int, dict]:
    s, b = req(method, path, body, token(role))
    if s == 401:
        s, b = req(method, path, body, login(role))
    return s, b


def sync(role: str, ws: str, commands: list) -> tuple[int, dict]:
    return authed(role, "POST", f"/workspaces/{ws}/sync", {"sync_token": "*", "commands": commands})


def statuses(body: dict) -> list[str]:
    return sorted({str(v) for v in body.get("sync_status", {}).values()})
