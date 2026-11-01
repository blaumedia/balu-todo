"""The backend and clients gate jobs in ci.yml and release.yml must stay identical.

release.yml repeats the CI gate because a tag can be pushed from a commit whose CI run failed;
a step added to only one copy would let tags publish code that main's gate would reject.
"""

from __future__ import annotations

from pathlib import Path

import pytest
import yaml

WORKFLOWS = Path(__file__).resolve().parents[2] / ".gitea" / "workflows"


def _jobs(name: str) -> dict:
    return yaml.safe_load((WORKFLOWS / name).read_text(encoding="utf-8"))["jobs"]


@pytest.mark.parametrize("job", ["backend", "clients"])
def test_gate_job_identical_in_ci_and_release(job):
    assert _jobs("ci.yml")[job] == _jobs("release.yml")[job]
