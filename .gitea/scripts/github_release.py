#!/usr/bin/env python3
"""Publish (or refresh) the GitHub release for a tag built on the forge.

Releases are cut on Gitea, but the repository people actually read is the
GitHub push mirror, so the release notes have to land there.

Two things make this less trivial than `gh release create`:

* **The mirror is asynchronous.** Creating a release for a tag GitHub has not
  received yet does not fail — GitHub happily *creates* that tag, pointing at
  the default branch. The result is a release for the wrong commit, silently.
  So this waits for the tag to arrive and verifies it resolves to the commit
  that was actually built.
* **The tags are annotated.** `git/ref/tags/<tag>` then returns the tag object,
  not the commit, and comparing that to the built SHA never matches. It has to
  be dereferenced through `git/tags/<sha>` first.

Environment:
  GH_TOKEN     classic PAT with `repo` (required)
  GH_REPO      owner/name of the mirror, e.g. blaumedia/balu-todo (required)
  VERSION      release version without the leading v, e.g. 1.0.1 (required)
  GITHUB_SHA   commit the tag must resolve to (required)
  GHCR_IMAGE   image name to quote in the notes (optional)
  WAIT_SECONDS how long to wait for the mirror, default 300
  DRY_RUN      when "1", resolve and report but never write
"""

from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.request

API = "https://api.github.com"


def env(name: str, *, required: bool = True, default: str = "") -> str:
    value = os.environ.get(name, default)
    if required and not value:
        sys.exit(f"{name} is not set")
    return value


def call(method: str, path: str, token: str, payload: dict | None = None):
    """Return (status, parsed_body). Never raises for HTTP errors."""
    req = urllib.request.Request(
        f"{API}{path}",
        data=json.dumps(payload).encode() if payload is not None else None,
        method=method,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req) as resp:
            body = resp.read().decode()
            return resp.status, (json.loads(body) if body else {})
    except urllib.error.HTTPError as exc:
        body = exc.read().decode()
        try:
            return exc.code, json.loads(body) if body else {}
        except json.JSONDecodeError:
            return exc.code, {"message": body[:200]}


def resolve_tag(repo: str, tag: str, token: str) -> str | None:
    """Commit SHA the tag points at on the mirror, or None if not there yet."""
    status, ref = call("GET", f"/repos/{repo}/git/ref/tags/{tag}", token)
    if status == 404:
        return None
    if status != 200:
        sys.exit(f"unexpected {status} resolving {tag}: {ref.get('message')}")

    obj = ref.get("object", {})
    if obj.get("type") == "tag":  # annotated — dereference to the commit
        status, tag_obj = call("GET", f"/repos/{repo}/git/tags/{obj['sha']}", token)
        if status != 200:
            sys.exit(f"unexpected {status} dereferencing {tag}: {tag_obj.get('message')}")
        return tag_obj.get("object", {}).get("sha")
    return obj.get("sha")


def wait_for_mirror(repo: str, tag: str, expected_sha: str, token: str, budget: int) -> None:
    deadline = budget
    while True:
        sha = resolve_tag(repo, tag, token)
        if sha == expected_sha:
            print(f"{tag} is on the mirror at {sha[:7]}")
            return
        if sha is not None:
            sys.exit(
                f"{tag} exists on {repo} at {sha[:7]} but this build is {expected_sha[:7]}. "
                "Refusing to publish a release for a different commit."
            )
        if deadline <= 0:
            sys.exit(f"{tag} never reached {repo} — is the push mirror healthy?")
        print(f"waiting for the mirror to carry {tag} ({deadline}s left)")
        time.sleep(10)
        deadline -= 10


def main() -> None:
    token = env("GH_TOKEN")
    repo = env("GH_REPO")
    version = env("VERSION")
    sha = env("GITHUB_SHA")
    image = os.environ.get("GHCR_IMAGE", "")
    budget = int(os.environ.get("WAIT_SECONDS", "300"))
    dry_run = os.environ.get("DRY_RUN") == "1"
    tag = f"v{version}"

    wait_for_mirror(repo, tag, sha, token, budget)

    body = ""
    if image:
        body = (
            f"```sh\ndocker pull {image}:{version}\n```\n\n"
            f"`linux/amd64` and `linux/arm64`. "
            f"`{image}:latest` now points here too.\n"
        )

    payload = {
        "tag_name": tag,
        "name": f"Balu {version}",
        "body": body,
        "generate_release_notes": True,
    }

    status, existing = call("GET", f"/repos/{repo}/releases/tags/{tag}", token)
    if status == 200:
        # Re-running a release must not 422 on an already-published version.
        if dry_run:
            print(f"DRY RUN: would update release {existing['id']} for {tag}")
            return
        # generate_release_notes is create-only; keep whatever notes exist.
        payload.pop("generate_release_notes")
        payload["body"] = body + existing.get("body", "")
        status, out = call("PATCH", f"/repos/{repo}/releases/{existing['id']}", token, payload)
        verb = "updated"
    else:
        if dry_run:
            print(f"DRY RUN: would create release {tag} on {repo}")
            return
        status, out = call("POST", f"/repos/{repo}/releases", token, payload)
        verb = "created"

    if status not in (200, 201):
        sys.exit(f"release {verb[:-1]}e failed with {status}: {out.get('message')}")
    print(f"{verb} {out.get('html_url')}")


if __name__ == "__main__":
    main()
