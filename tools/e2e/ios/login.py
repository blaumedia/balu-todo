#!/usr/bin/env python3
"""Log in on the iOS login form as an e2e role: login.py --udid UDID ROLE (owner|member).

The password is read in-process from the e2e state dir and written only into a temporary
Maestro flow that is deleted straight after the run, together with the Maestro log dirs
of that run (Maestro logs typed text). It is never in argv, stdout or a
report. Labels are matched in en and de. Run it on the login screen ("Welcome back").
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import balu_e2e as e  # noqa: E402
import ui  # noqa: E402


def input_rows(udid: str) -> list[tuple[int, int, int, int]]:
    # the login form has no accessibility labels for its inputs (2026-11-05, iOS 27.2):
    # the two input rows are the single-line boxes of the form, email above password
    rows = []
    for n in ui.nodes(udid):
        b = n["bounds"]
        if not (b and n["enabled"]):
            continue
        is_input = (b[2] - b[0]) >= 300 and 15 <= (b[3] - b[1]) <= 30 and 340 < b[1] and b[3] < 500
        if is_input and b not in rows:
            rows.append(b)
    return sorted(rows, key=lambda b: b[1])


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--udid", required=True)
    ap.add_argument("role", choices=["owner", "member"])
    a = ap.parse_args()
    # fail before touching the device when the run has no account
    pw = e.load(f"{a.role}.pw")
    mail = e.email(a.role)
    rows = input_rows(a.udid)
    if len(rows) < 2:
        raise SystemExit(f"expected 2 input rows, found {len(rows)}")
    email_xy, pw_xy = ui.center(rows[0]), ui.center(rows[1])
    body = (
        f"- tapOn:\n    point: \"{email_xy[0]},{email_xy[1]}\"\n"
        f"- inputText: {json.dumps(mail)}\n"
        "- hideKeyboard\n"
        f"- tapOn:\n    point: \"{pw_xy[0]},{pw_xy[1]}\"\n"
        f"- inputText: {json.dumps(pw)}\n"
        "- hideKeyboard\n"
    )
    with tempfile.TemporaryDirectory(prefix="balu-ios-login-") as d:
        flow = os.path.join(d, "login.yaml")
        with open(flow, "w", encoding="utf-8") as f:
            f.write("appId: com.blaumedia.balu\n---\n" + body)
        r = ui.maestro(["--device", a.udid, "test", flow], timeout=180)
    if r.returncode != 0:
        raise SystemExit(f"login flow failed rc={r.returncode} (credentials not shown)")
    ui.maestro_flow(a.udid, "- tapOn:\n    text: \"Log in\"")
    print("login submitted as", a.role)
    return 0


if __name__ == "__main__":
    sys.exit(main())
