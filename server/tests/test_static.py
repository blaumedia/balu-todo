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
