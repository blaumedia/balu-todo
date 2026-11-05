#!/usr/bin/env python3
"""Log in on the iOS login form as an e2e role.

  login.py --udid UDID ROLE        ROLE is owner or member

The password is read in-process from the e2e state dir and written only into a temporary
Maestro flow that is deleted straight after the run, together with the private Maestro
output dir of that run (Maestro logs typed text). It is never in argv, stdout or a
report. Labels are matched in en and de. Run it on the login screen ("Welcome back" /
"Willkommen zurück").

Input rows are found relative to the heading: the unlabelled single-line boxes below it
that span most of the screen width (the server chip above the email field has a label and
is skipped). Exactly two must be found before anything is typed. After the email, the
password row is looked up again and must carry the Password placeholder with no text. The
keyboard must be down and the row centre on screen before the password tap; after the tap
the keyboard must be up and the email row must still show the typed mail, else the password
is not typed. (`focused` is always false for these inputs in the hierarchy, so it cannot be
used.) Verified on iPhone 17 portrait (402 x 874 pt) only; iPad, the Duo cover screen and
landscape use the same rule but are not verified yet.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import balu_e2e as e
import ui

HEADING = re.compile(r"^(Welcome back|Willkommen zur\u00fcck)")


def input_rows(all_nodes: list[dict]) -> list[tuple[int, int, int, int]]:
    # the login form has no accessibility labels for its inputs (2026-11-05, iOS 27.2):
    # the two input rows are the single-line boxes below the heading, email above password
    width, _ = ui.screen_size(all_nodes)
    heads = [
        n["bounds"] for n in all_nodes if n["bounds"] and HEADING.search(n["label"])
    ]
    if not (width and heads):
        raise SystemExit("login heading not found; open the login screen first")
    top = heads[0][3]
    min_w = width * 0.6
    # an empty input has no label; the server chip above them is labelled with the server URL
    # and a filled input gets its text as label (on a twin node with the same bounds)
    labelled = {n["bounds"] for n in all_nodes if n["label"] or n["value"]}
    rows: list[tuple[int, int, int, int]] = []
    for n in all_nodes:
        b = n["bounds"]
        if not (b and n["enabled"]) or b in labelled:
            continue
        if (
            (b[2] - b[0]) >= min_w
            and 15 <= (b[3] - b[1]) <= 40
            and b[1] >= top
            and b not in rows
        ):
            rows.append(b)
    return sorted(rows, key=lambda b: b[1])


PASSWORD_HINT = re.compile(r"^(Password|Passwort)$")


def is_password_row(all_nodes: list[dict], row: tuple[int, int, int, int]) -> bool:
    """The row carries the password placeholder and nothing typed (hierarchy `hint`)."""
    at = [n for n in all_nodes if n["bounds"] == row]
    return any(PASSWORD_HINT.search(n["hint"]) for n in at) and not any(
        n["label"] or n["value"] for n in at
    )


def keyboard_up(all_nodes: list[dict]) -> bool:
    """A key (single-character label) in the lower half of the screen: some field has focus."""
    _, height = ui.screen_size(all_nodes)
    return any(
        len(n["label"]) == 1 and n["bounds"] and n["bounds"][1] > height / 2
        for n in all_nodes
    )


def email_intact(
    all_nodes: list[dict], row: tuple[int, int, int, int], mail: str
) -> bool:
    """The email row still shows exactly the typed mail (compared, never printed)."""
    return any(n["bounds"] == row and n["label"] == mail for n in all_nodes)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--udid", required=True)
    ap.add_argument("role", choices=["owner", "member"])
    a = ap.parse_args()
    # fail before touching the device when the run has no account
    pw = e.load(f"{a.role}.pw")
    mail = e.email(a.role)
    ui.install_signal_handlers()
    rows = input_rows(ui.nodes(a.udid))
    if len(rows) != 2:
        raise SystemExit(
            f"expected exactly 2 input rows, found {len(rows)}; nothing typed"
        )
    email_bounds = rows[0]
    email_xy = ui.center(email_bounds)
    body = (
        f'- tapOn:\n    point: "{email_xy[0]},{email_xy[1]}"\n'
        f"- inputText: {json.dumps(mail)}\n"
        "- hideKeyboard\n"
    )
    rc = ui.maestro_flow(a.udid, body, quiet=True)
    if rc != 0:
        raise SystemExit(f"login flow failed rc={rc} (credentials not shown)")
    # The password is typed only into a verified row. The layout moves while typing, so look
    # again: the email row now has a label (its text), the password row is the one unlabelled
    # row left and must carry the password placeholder and no text.
    before = ui.nodes(a.udid)
    rows = input_rows(before)
    if len(rows) != 1 or not is_password_row(before, rows[0]):
        raise SystemExit(
            "password row not identified after the email; password not typed"
        )
    # a tap while the keyboard is still up (or on an off-screen row) would hit a key, and the
    # password would then go into the email field
    width, height = ui.screen_size(before)
    pw_xy = ui.center(rows[0])
    if keyboard_up(before) or not (0 < pw_xy[0] < width and 0 < pw_xy[1] < height):
        raise SystemExit("keyboard still up or password row off screen; password not typed")
    ui.maestro_flow(a.udid, f'- tapOn:\n    point: "{pw_xy[0]},{pw_xy[1]}"')
    check = ui.nodes(a.udid)
    if not keyboard_up(check) or not email_intact(check, email_bounds, mail):
        raise SystemExit("password field not focused as expected; password not typed")
    rc = ui.maestro_flow(
        a.udid, f"- inputText: {json.dumps(pw)}\n- hideKeyboard", quiet=True
    )
    if rc != 0:
        raise SystemExit(f"login flow failed rc={rc} (credentials not shown)")
    ui.maestro_flow(a.udid, '- tapOn:\n    text: "(Log in|Anmelden)"')
    print("login submitted as", a.role)
    return 0


if __name__ == "__main__":
    sys.exit(main())
