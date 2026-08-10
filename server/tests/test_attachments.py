"""Attachments (§3.7): REST blob transfer + metadata through the sync pipeline."""

from __future__ import annotations

import uuid

import pytest

from balu.attachments import sanitize_content_type, sanitize_filename
from balu.config import get_settings
from balu.models import Attachment
from tests.conftest import auth_headers, cmd, register_user, sync

PNG = b"\x89PNG\r\n\x1a\n" + b"pretend-pixels" * 4


@pytest.fixture(autouse=True)
def data_dir(tmp_path, monkeypatch):
    """Point BALU_DATA_DIR at a per-test directory.

    Settings are lru_cached, so the cache has to be dropped on both sides -
    otherwise this test's directory leaks into the next test's settings.
    """
    monkeypatch.setenv("BALU_DATA_DIR", str(tmp_path))
    get_settings.cache_clear()
    yield tmp_path
    get_settings.cache_clear()


def _blob_dir(data_dir, workspace_id: str):
    return data_dir / "attachments" / workspace_id


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
        "access_token": data["access_token"],
        "headers": auth_headers(data["access_token"]),
        "workspace_id": owner["workspace_id"],
    }
    resp = client.post(
        "/api/v1/invites/accept", headers=member["headers"], json={"token": invite["token"]}
    )
    assert resp.status_code == 200
    return member


def _add_task(client, user, title="Steuer") -> str:
    body = sync(client, user, commands=[cmd("task_add", temp_id="t1", title=title)])
    return body["temp_id_mapping"]["t1"]


BOUNDARY = "balutestboundary"


def _field_part(name: str, value: str) -> bytes:
    return (
        f"--{BOUNDARY}\r\n"
        f'Content-Disposition: form-data; name="{name}"\r\n\r\n'
        f"{value}\r\n"
    ).encode()


def _file_part(filename: str, content: bytes, content_type: str) -> bytes:
    head = (
        f"--{BOUNDARY}\r\n"
        f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'
        f"Content-Type: {content_type}\r\n\r\n"
    ).encode()
    return head + content + b"\r\n"


def _post_raw(client, user, body: bytes):
    """POST a hand-built multipart body, bypassing httpx's own encoder.

    httpx always emits `data=` fields before `files=` and always closes the
    envelope, so part ordering and a truncated body are only reachable this way.
    """
    return client.post(
        f"/api/v1/workspaces/{user['workspace_id']}/attachments",
        headers={
            **user["headers"],
            "content-type": f"multipart/form-data; boundary={BOUNDARY}",
        },
        content=body,
    )


def _upload(client, user, task_id, content=PNG, filename="shot.png", content_type="image/png"):
    return client.post(
        f"/api/v1/workspaces/{user['workspace_id']}/attachments",
        headers=user["headers"],
        data={"task_id": task_id},
        files={"file": (filename, content, content_type)},
    )


# ---------------------------------------------------------------------------
# Upload / download
# ---------------------------------------------------------------------------
def test_upload_download_roundtrip(client, user, data_dir):
    task_id = _add_task(client, user)
    resp = _upload(client, user, task_id)
    assert resp.status_code == 201, resp.text
    meta = resp.json()
    assert meta["task_id"] == task_id
    assert meta["workspace_id"] == user["workspace_id"]
    assert meta["filename"] == "shot.png"
    assert meta["content_type"] == "image/png"
    assert meta["size_bytes"] == len(PNG)
    assert meta["created_by"] == user["user"]["id"]
    assert meta["is_deleted"] is False

    # The blob sits under the workspace directory, named by attachment id only.
    assert (_blob_dir(data_dir, user["workspace_id"]) / meta["id"]).is_file()

    got = client.get(
        f"/api/v1/workspaces/{user['workspace_id']}/attachments/{meta['id']}/file",
        headers=user["headers"],
    )
    assert got.status_code == 200
    assert got.content == PNG
    assert got.headers["content-type"] == "image/png"
    assert "shot.png" in got.headers["content-disposition"]
    # Never `inline`: the blob is served from the app's own origin.
    assert got.headers["content-disposition"].startswith("attachment")
    assert got.headers["x-content-type-options"] == "nosniff"


def test_upload_sanitizes_a_traversal_filename(client, user):
    task_id = _add_task(client, user)
    resp = _upload(client, user, task_id, filename="../../etc/passwd")
    assert resp.status_code == 201
    assert resp.json()["filename"] == "passwd"


def test_download_missing_blob_is_not_found(client, user, data_dir):
    task_id = _add_task(client, user)
    meta = _upload(client, user, task_id).json()
    (_blob_dir(data_dir, user["workspace_id"]) / meta["id"]).unlink()

    got = client.get(
        f"/api/v1/workspaces/{user['workspace_id']}/attachments/{meta['id']}/file",
        headers=user["headers"],
    )
    assert got.status_code == 404


def test_download_unknown_attachment_is_not_found(client, user):
    got = client.get(
        f"/api/v1/workspaces/{user['workspace_id']}/attachments/{uuid.uuid4()}/file",
        headers=user["headers"],
    )
    assert got.status_code == 404


# ---------------------------------------------------------------------------
# Access control
# ---------------------------------------------------------------------------
def test_viewer_cannot_upload(client, user):
    task_id = _add_task(client, user)
    viewer = _join(client, user, role="viewer")
    resp = _upload(client, viewer, task_id)
    assert resp.status_code == 403
    assert resp.json()["detail"]["code"] == "forbidden"


def test_viewer_can_download(client, user):
    task_id = _add_task(client, user)
    meta = _upload(client, user, task_id).json()
    viewer = _join(client, user, role="viewer")
    got = client.get(
        f"/api/v1/workspaces/{user['workspace_id']}/attachments/{meta['id']}/file",
        headers=viewer["headers"],
    )
    assert got.status_code == 200
    assert got.content == PNG


def test_non_member_download_is_not_found(client, user):
    task_id = _add_task(client, user)
    meta = _upload(client, user, task_id).json()
    other = register_user(client, email=None, name="Mallory")

    got = client.get(
        f"/api/v1/workspaces/{user['workspace_id']}/attachments/{meta['id']}/file",
        headers=auth_headers(other["access_token"]),
    )
    # Not 403: a non-member must not learn that the workspace exists.
    assert got.status_code == 404


def test_upload_to_a_task_of_another_workspace_is_not_found(client, user):
    """The task exists - but not in the workspace named in the path."""
    other = register_user(client, email=None, name="Mallory")
    other_user = {
        "user": other["user"],
        "access_token": other["access_token"],
        "headers": auth_headers(other["access_token"]),
        "workspace_id": client.get(
            "/api/v1/me", headers=auth_headers(other["access_token"])
        ).json()["memberships"][0]["workspace"]["id"],
    }
    foreign_task = _add_task(client, other_user, title="Not yours")

    resp = _upload(client, user, foreign_task)
    assert resp.status_code == 404
    assert resp.json()["detail"]["code"] == "not_found"


def test_upload_to_a_deleted_task_is_not_found(client, user):
    task_id = _add_task(client, user)
    sync(client, user, commands=[cmd("task_delete", id=task_id)])
    resp = _upload(client, user, task_id)
    assert resp.status_code == 404


def test_html_upload_is_served_as_a_download(client, user):
    """A stored `text/html` file must never render in the app's own origin."""
    task_id = _add_task(client, user)
    meta = _upload(
        client,
        user,
        task_id,
        content=b"<script>alert(document.cookie)</script>",
        filename="evil.html",
        content_type="text/html",
    ).json()

    got = client.get(
        f"/api/v1/workspaces/{user['workspace_id']}/attachments/{meta['id']}/file",
        headers=user["headers"],
    )
    assert got.status_code == 200
    assert got.headers["content-disposition"].startswith("attachment")
    assert got.headers["x-content-type-options"] == "nosniff"


# ---------------------------------------------------------------------------
# Size cap
# ---------------------------------------------------------------------------
def test_oversize_upload_is_rejected_and_leaves_no_partial_blob(
    client, user, data_dir, monkeypatch
):
    monkeypatch.setenv("BALU_MAX_ATTACHMENT_MB", "1")
    get_settings.cache_clear()
    task_id = _add_task(client, user)

    resp = _upload(client, user, task_id, content=b"x" * (2 * 1024 * 1024), filename="big.bin")
    assert resp.status_code == 413
    assert resp.json()["detail"]["code"] == "too_large"

    # Nothing half-written survives: the directory is either absent or empty.
    ws_dir = _blob_dir(data_dir, user["workspace_id"])
    assert not ws_dir.exists() or list(ws_dir.iterdir()) == []


def test_oversize_upload_with_valid_auth_leaves_the_data_dir_clean(
    client, user, data_dir, monkeypatch
):
    """The authenticated oversize path is the one that gets far enough to write."""
    monkeypatch.setenv("BALU_MAX_ATTACHMENT_MB", "1")
    get_settings.cache_clear()
    task_id = _add_task(client, user)

    resp = _upload(client, user, task_id, content=b"y" * (5 * 1024 * 1024), filename="huge.bin")
    assert resp.status_code == 413
    assert resp.json()["detail"]["code"] == "too_large"

    # No row, and nothing anywhere under the data dir - not just the workspace
    # directory, so a stray temp file elsewhere would fail this too.
    leftovers = [p for p in data_dir.rglob("*") if p.is_file()]
    assert leftovers == []
    assert sync(client, user)["attachments"] == []


def test_unauthenticated_upload_is_rejected_without_touching_disk(client, user, data_dir):
    """401 before any body is read (S: FastAPI would otherwise spool it first).

    Declaring `File()`/`Form()` parameters makes FastAPI await `request.form()`
    *before* dependencies run, so an anonymous caller's multipart body lands in a
    temp file and only then gets a 401. The endpoint takes a bare `Request`
    precisely to stop that, and this asserts the outcome.
    """
    task_id = _add_task(client, user)

    resp = client.post(
        f"/api/v1/workspaces/{user['workspace_id']}/attachments",
        data={"task_id": task_id},
        files={"file": ("anon.bin", b"z" * (3 * 1024 * 1024), "application/octet-stream")},
    )
    assert resp.status_code == 401

    assert not _blob_dir(data_dir, user["workspace_id"]).exists()
    assert [p for p in data_dir.rglob("*") if p.is_file()] == []


def test_upload_larger_than_one_chunk_roundtrips(client, user):
    """A few MB crosses many stream chunks and many parser callbacks."""
    task_id = _add_task(client, user)
    # Not compressible-uniform: a repeating pattern would hide an off-by-one
    # that drops or duplicates a chunk boundary.
    body = bytes(range(256)) * (12 * 1024)  # 3 MiB
    meta = _upload(client, user, task_id, content=body, filename="big.dat",
                   content_type="application/octet-stream").json()
    assert meta["size_bytes"] == len(body)

    got = client.get(
        f"/api/v1/workspaces/{user['workspace_id']}/attachments/{meta['id']}/file",
        headers=user["headers"],
    )
    assert got.status_code == 200
    assert got.content == body


def test_declared_oversize_content_length_is_refused_up_front(client, user, monkeypatch):
    monkeypatch.setenv("BALU_MAX_ATTACHMENT_MB", "1")
    get_settings.cache_clear()

    # A lying Content-Length is still refused - the streaming counters catch a
    # body that under-declares, this catches the honest oversized one early.
    resp = client.post(
        f"/api/v1/workspaces/{user['workspace_id']}/attachments",
        headers={**user["headers"], "content-type": "multipart/form-data; boundary=zzz",
                 "content-length": str(50 * 1024 * 1024)},
        content=b"",
    )
    assert resp.status_code == 413


def test_upload_without_a_file_part_is_a_validation_error(client, user):
    task_id = _add_task(client, user)
    resp = client.post(
        f"/api/v1/workspaces/{user['workspace_id']}/attachments",
        headers=user["headers"],
        data={"task_id": task_id},  # no file
    )
    assert resp.status_code == 422
    assert resp.json()["detail"]["code"] == "validation_error"


def test_truncated_multipart_body_is_rejected(client, user, data_dir, db):
    """A body cut off mid-file must not be stored as a complete upload.

    `MultipartParser.finalize()` is a no-op (its own docstring says it does not
    yet verify the end state), so without an explicit completion check the file
    part's bytes-so-far would be committed with a `size_bytes` that matches the
    truncation - a silently corrupt attachment reported as 201.
    """
    task_id = _add_task(client, user)
    body = (
        _field_part("task_id", task_id)
        + _file_part("truncated.bin", b"A" * 4096, "application/octet-stream")
    )
    # Deliberately no closing `--BOUNDARY--`.
    resp = _post_raw(client, user, body)

    assert resp.status_code == 422, resp.text
    assert resp.json()["detail"]["code"] == "validation_error"

    # No row, and no partial blob left on the volume.
    assert db.query(Attachment).count() == 0
    assert [p for p in data_dir.rglob("*") if p.is_file()] == []
    assert sync(client, user)["attachments"] == []


def test_file_part_before_task_id_and_zero_bytes_roundtrips(client, user, data_dir):
    """Parts may arrive in any order, and an empty file is still a file."""
    task_id = _add_task(client, user)
    body = (
        _file_part("empty.bin", b"", "application/octet-stream")
        + _field_part("task_id", task_id)
        + f"--{BOUNDARY}--\r\n".encode()
    )
    resp = _post_raw(client, user, body)

    assert resp.status_code == 201, resp.text
    meta = resp.json()
    assert meta["task_id"] == task_id
    assert meta["filename"] == "empty.bin"
    assert meta["size_bytes"] == 0

    blob = _blob_dir(data_dir, user["workspace_id"]) / meta["id"]
    assert blob.is_file()
    assert blob.stat().st_size == 0

    got = client.get(
        f"/api/v1/workspaces/{user['workspace_id']}/attachments/{meta['id']}/file",
        headers=user["headers"],
    )
    assert got.status_code == 200
    assert got.content == b""


def test_upload_with_a_malformed_multipart_body_is_a_validation_error(client, user):
    """Garbage inside a declared multipart envelope is a 422, never a 500."""
    resp = client.post(
        f"/api/v1/workspaces/{user['workspace_id']}/attachments",
        headers={**user["headers"], "content-type": "multipart/form-data; boundary=abc"},
        content=b"not a multipart body at all\r\n--abc oops",
    )
    assert resp.status_code == 422
    assert resp.json()["detail"]["code"] == "validation_error"


def test_upload_with_a_non_multipart_body_is_a_validation_error(client, user):
    resp = client.post(
        f"/api/v1/workspaces/{user['workspace_id']}/attachments",
        headers=user["headers"],
        json={"task_id": "x"},
    )
    assert resp.status_code == 422
    assert resp.json()["detail"]["code"] == "validation_error"


def test_upload_at_the_cap_is_accepted(client, user, monkeypatch):
    monkeypatch.setenv("BALU_MAX_ATTACHMENT_MB", "1")
    get_settings.cache_clear()
    task_id = _add_task(client, user)

    resp = _upload(client, user, task_id, content=b"x" * (1024 * 1024), filename="exact.bin")
    assert resp.status_code == 201
    assert resp.json()["size_bytes"] == 1024 * 1024


# ---------------------------------------------------------------------------
# Sync integration
# ---------------------------------------------------------------------------
def test_upload_shows_up_in_an_incremental_sync(client, user):
    task_id = _add_task(client, user)
    before = sync(client, user)["sync_token"]

    meta = _upload(client, user, task_id).json()

    body = sync(client, user, sync_token=before)
    assert body["full_sync"] is False
    ids = {a["id"] for a in body["attachments"]}
    assert meta["id"] in ids
    row = next(a for a in body["attachments"] if a["id"] == meta["id"])
    assert row["filename"] == "shot.png"
    assert row["size_bytes"] == len(PNG)


def test_full_sync_carries_attachments(client, user):
    task_id = _add_task(client, user)
    meta = _upload(client, user, task_id).json()
    body = sync(client, user)
    assert [a["id"] for a in body["attachments"]] == [meta["id"]]


# ---------------------------------------------------------------------------
# Deletion
# ---------------------------------------------------------------------------
def test_attachment_delete_soft_deletes_and_removes_the_blob(client, user, data_dir):
    task_id = _add_task(client, user)
    meta = _upload(client, user, task_id).json()
    blob = _blob_dir(data_dir, user["workspace_id"]) / meta["id"]
    assert blob.is_file()
    before = sync(client, user)["sync_token"]

    command = cmd("attachment_delete", id=meta["id"])
    body = sync(client, user, sync_token=before, commands=[command])
    assert body["sync_status"][command["uuid"]] == "ok"
    assert not blob.exists()

    deleted = next(a for a in body["attachments"] if a["id"] == meta["id"])
    assert deleted["is_deleted"] is True

    got = client.get(
        f"/api/v1/workspaces/{user['workspace_id']}/attachments/{meta['id']}/file",
        headers=user["headers"],
    )
    assert got.status_code == 404


def test_attachment_delete_by_a_viewer_is_forbidden(client, user):
    task_id = _add_task(client, user)
    meta = _upload(client, user, task_id).json()
    viewer = _join(client, user, role="viewer")

    command = cmd("attachment_delete", id=meta["id"])
    resp = client.post(
        f"/api/v1/workspaces/{user['workspace_id']}/sync",
        headers=viewer["headers"],
        json={"sync_token": "*", "commands": [command]},
    )
    assert resp.status_code == 200
    assert resp.json()["sync_status"][command["uuid"]]["error_code"] == "forbidden"


def test_attachment_delete_of_an_unknown_id_is_not_found(client, user):
    command = cmd("attachment_delete", id=str(uuid.uuid4()))
    body = sync(client, user, commands=[command])
    assert body["sync_status"][command["uuid"]]["error_code"] == "not_found"


def test_task_delete_cascades_to_attachments(client, user, data_dir, db):
    task_id = _add_task(client, user)
    meta = _upload(client, user, task_id).json()
    blob = _blob_dir(data_dir, user["workspace_id"]) / meta["id"]
    before = sync(client, user)["sync_token"]

    sync(client, user, commands=[cmd("task_delete", id=task_id)])

    row = db.get(Attachment, uuid.UUID(meta["id"]))
    assert row is not None and row.is_deleted is True
    assert not blob.exists()

    body = sync(client, user, sync_token=before)
    deleted = next(a for a in body["attachments"] if a["id"] == meta["id"])
    assert deleted["is_deleted"] is True


def test_project_delete_cascades_to_attachments(client, user, data_dir, db):
    added = sync(
        client,
        user,
        commands=[
            cmd("project_add", temp_id="p1", name="Haus"),
            cmd("task_add", temp_id="t1", title="Dach", project_id="p1"),
        ],
    )
    task_id = added["temp_id_mapping"]["t1"]
    meta = _upload(client, user, task_id).json()
    blob = _blob_dir(data_dir, user["workspace_id"]) / meta["id"]

    sync(client, user, commands=[cmd("project_delete", id=added["temp_id_mapping"]["p1"])])

    row = db.get(Attachment, uuid.UUID(meta["id"]))
    assert row is not None and row.is_deleted is True
    assert not blob.exists()


def test_workspace_delete_removes_the_attachment_directory(client, user, data_dir):
    ws = client.post("/api/v1/workspaces", headers=user["headers"], json={"name": "Temp"}).json()
    scoped = {**user, "workspace_id": ws["id"]}
    task_id = _add_task(client, scoped)
    _upload(client, scoped, task_id)
    assert _blob_dir(data_dir, ws["id"]).is_dir()

    resp = client.delete(f"/api/v1/workspaces/{ws['id']}", headers=user["headers"])
    assert resp.status_code == 204
    assert not _blob_dir(data_dir, ws["id"]).exists()


# ---------------------------------------------------------------------------
# Sanitizers
# ---------------------------------------------------------------------------
def test_sanitize_filename():
    assert sanitize_filename("report.pdf") == "report.pdf"
    assert sanitize_filename("../../etc/passwd") == "passwd"
    assert sanitize_filename(r"C:\Users\me\notes.txt") == "notes.txt"
    assert sanitize_filename("") == "file"
    assert sanitize_filename(None) == "file"
    assert sanitize_filename("..") == "file"
    assert sanitize_filename("a" * 400) == "a" * 255


def test_sanitize_content_type():
    assert sanitize_content_type("image/png") == "image/png"
    assert sanitize_content_type("text/plain; charset=utf-8") == "text/plain; charset=utf-8"
    # Anything that could smuggle a header, or is simply not a media type.
    assert sanitize_content_type("image/png\r\nX-Evil: 1") == "application/octet-stream"
    assert sanitize_content_type("") == "application/octet-stream"
    assert sanitize_content_type(None) == "application/octet-stream"
    assert sanitize_content_type("x" * 200) == "application/octet-stream"


def test_upload_committed_mid_sync_is_never_skipped(client, user, monkeypatch):
    """The reported field bug: device A uploads while device B is syncing.

    Device B's pull reads the changed rows, device A's upload commits (version
    bump + row, one transaction), and device B then reads the version counter -
    receiving a token that has already moved past an attachment it was never
    sent. Because device B persists that token, no later incremental sync and no
    cold start ever asks for that version again, so the attachment is invisible
    on device B forever while the server and device A both show it.
    """
    task_id = _add_task(client, user)
    token = sync(client, user)["sync_token"]

    from tests.test_sync_basic import _commit_during_collect

    uploaded = {}

    def concurrent_upload():
        uploaded["id"] = _upload(client, user, task_id).json()["id"]

    _commit_during_collect(monkeypatch, concurrent_upload)

    during = sync(client, user, sync_token=token)
    monkeypatch.undo()

    assert uploaded.get("id"), "the concurrent upload did not run"
    if uploaded["id"] in {a["id"] for a in during["attachments"]}:
        return  # delivered immediately - also correct

    later = sync(client, user, sync_token=during["sync_token"])
    assert uploaded["id"] in {a["id"] for a in later["attachments"]}, (
        "attachment committed mid-request was skipped forever"
    )
