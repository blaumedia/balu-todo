#!/usr/bin/env python3
"""Log in on the iOS login form as an e2e role: login.py --udid UDID ROLE (owner|member).

The password is read in-process from the e2e state dir and written only into a temporary
Maestro flow that is deleted straight after the run, together with the private Maestro
output dir of that run (Maestro logs typed text). It is never in argv, stdout or a
report. Labels are matched in en and de. Run it on the login screen ("Welcome back" /
"Willkommen zurück").

Input rows are found relative to the heading: the first two single-line boxes below it that
span most of the screen width. Verified on iPhone 17 portrait (402 x 874 pt) only; iPad, the
Duo cover screen and landscape use the same rule but are not verified yet.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import balu_e2e as e  # noqa: E402
import ui  # noqa: E402

HEADING = re.compile(r"^(Welcome back|Willkommen zur\u00fcck)")


def input_rows(udid: str) -> list[tuple[int, int, int, int]]:
    # the login form has no accessibility labels for its inputs (2026-11-05, iOS 27.2):
    # the two input rows are the single-line boxes below the heading, email above password
    all_nodes = ui.nodes(udid)
    width, _ = ui.screen_size(all_nodes)
    heads = [n["bounds"] for n in all_nodes if n["bounds"] and HEADING.search(n["label"])]
    if not (width and heads):
        raise SystemExit("login heading not found; open the login screen first")
    top = heads[0][3]
    min_w = width * 0.6
    rows: list[tuple[int, int, int, int]] = []
    for n in all_nodes:
        b = n["bounds"]
        if not (b and n["enabled"]):
            continue
        if (b[2] - b[0]) >= min_w and 15 <= (b[3] - b[1]) <= 40 and b[1] >= top and b not in rows:
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
    rc = ui.maestro_flow(a.udid, body, quiet=True)
    if rc != 0:
        raise SystemExit(f"login flow failed rc={rc} (credentials not shown)")
    ui.maestro_flow(a.udid, "- tapOn:\n    text: \"(Log in|Anmelden)\"")
    print("login submitted as", a.role)
    return 0


if __name__ == "__main__":
    sys.exit(main())
