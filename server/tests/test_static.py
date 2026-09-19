"""SPA fallback: containment of the static file route (S1 path traversal)."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

import balu.main as main

TRAVERSAL_PAYLOADS = [
    "/%2e%2e%2fsecret.txt",
    "/..%2fsecret.txt",
    "/%2e%2e/secret.txt",
    "/%2e%2e%2f%2e%2e%2fsecret.txt",
    "/assets/../../secret.txt",
    "/%2e%2e%5csecret.txt",
]


@pytest.fixture
def spa(tmp_path, monkeypatch):
    """An app whose static dir is a tmp dir with a sibling secret file."""
    static = tmp_path / "static"
    (static / "assets").mkdir(parents=True)
    (static / "index.html").write_text("<html>spa</html>")
    (static / "app.js").write_text("console.log('app')")
    (tmp_path / "secret.txt").write_text("TOP-SECRET-CONTENT")
    monkeypatch.setattr(main, "_STATIC_DIR", static)
    return TestClient(main.create_app())


@pytest.mark.parametrize("path", TRAVERSAL_PAYLOADS)
def test_spa_fallback_blocks_traversal(spa, path):
    resp = spa.get(path)
    # Either the fallback index or a plain 404 — never the file outside static/.
    assert "TOP-SECRET-CONTENT" not in resp.text
    if resp.status_code == 200:
        assert resp.text == "<html>spa</html>"


def test_spa_fallback_still_serves_real_files(spa):
    resp = spa.get("/app.js")
    assert resp.status_code == 200
    assert "console.log" in resp.text


def test_spa_fallback_serves_index_for_unknown_route(spa):
    resp = spa.get("/projects/abc")
    assert resp.status_code == 200
    assert resp.text == "<html>spa</html>"


# Inputs that used to 500 with a traceback: a `%00` makes resolve() raise
# ValueError, and a path past the platform limit makes is_file() raise OSError
# (pathlib does not ignore ENAMETOOLONG). Both are ordinary junk from a scanner
# or a chat client that mangled a shared link, so they must fall through to the
# SPA shell like any other route this app does not own.
HOSTILE_PAYLOADS = [
    "/%00",
    "/%00foo",
    "/" + "a" * 5000,
]


@pytest.mark.parametrize("path", HOSTILE_PAYLOADS)
def test_spa_fallback_does_not_500_on_unresolvable_paths(spa, path):
    resp = spa.get(path)
    assert resp.status_code == 200
    assert resp.text == "<html>spa</html>"


def test_spa_fallback_index_is_not_heuristically_cached(spa):
    # Every deep link is its own cache entry for the same document now, so a
    # stale index.html would reference a deleted /assets/index-<oldhash>.js and
    # a link navigation does not revalidate. `no-cache` forces revalidation
    # while still allowing a cheap etag 304.
    resp = spa.get("/projects/abc")
    assert resp.headers["cache-control"] == "no-cache"


def test_spa_fallback_real_files_keep_default_caching(spa):
    # Only the SPA shell gets the header; hashed assets stay cacheable.
    resp = spa.get("/app.js")
    assert resp.headers.get("cache-control") != "no-cache"


def test_spa_fallback_direct_index_request_is_also_no_cache(spa):
    # /index.html is the same document as the SPA shell, just reached through the
    # real-file branch, so it must not get a different cache policy - a stale
    # shell is exactly what makes a deploy blank the app.
    resp = spa.get("/index.html")
    assert resp.status_code == 200
    assert resp.headers["cache-control"] == "no-cache"
