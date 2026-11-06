#!/usr/bin/env python3
"""Log in on the iOS login form as an e2e role.

  login.py --udid UDID ROLE        ROLE is owner or member

The password is read in-process from the e2e state dir and written only into a temporary
Maestro flow that is deleted straight after the run, together with the private Maestro
output dir of that run (Maestro logs typed text). It is never in argv, stdout or a
report. Labels are matched in en and de. Run it on the login screen ("Welcome back" /
"Willkommen zurück").

The two inputs are selected by their accessibility labels (Email / E-Mail and Password /
Passwort, from the `auth.email` and `auth.password` strings). Filling an input does not change
its label: the typed text shows up in the node's `value`, the placeholder in `hint`. Exactly one
empty email input and exactly one empty password input must be found before anything is typed.
The keyboard must be down and the password input on screen before the password tap; after the
tap the keyboard must be up and the email input must still hold the typed mail, else the
password is not typed. (`focused` is always false for these inputs in the hierarchy, so it
cannot be used.) Verified on iPhone 17 portrait (402 x 874 pt), English and German.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import balu_e2e as e
import ui

EMAIL_LABEL = re.compile(r"^(Email|E-Mail)$")
LOGIN_HEADING = re.compile(r"^(Welcome back|Willkommen zurück)$")
PASSWORD_LABEL = re.compile(r"^(Password|Passwort)$")


def inputs(all_nodes: list[dict], label: re.Pattern[str]) -> list[dict]:
    """Enabled nodes with a non-empty frame whose accessibility label matches, one per frame."""
    found: dict[tuple[int, int, int, int], dict] = {}
    for n in all_nodes:
        b = n["bounds"]
        if b and n["enabled"] and b[2] > b[0] and b[3] > b[1] and label.search(n["label"]):
            found.setdefault(b, n)
    return list(found.values())


def single(all_nodes: list[dict], label: re.Pattern[str]) -> dict | None:
    """The one matching input, or None when there are none or several."""
    found = inputs(all_nodes, label)
    return found[0] if len(found) == 1 else None


def on_screen(all_nodes: list[dict], node: dict) -> bool:
    width, height = ui.screen_size(all_nodes)
    x, y = ui.center(node["bounds"])
    return 0 < x < width and 0 < y < height


def keyboard_up(all_nodes: list[dict]) -> bool:
    """A key (single-character label) in the lower half of the screen: some field has focus."""
    _, height = ui.screen_size(all_nodes)
    return any(
        len(n["label"]) == 1 and n["bounds"] and n["bounds"][1] > height / 2 for n in all_nodes
    )


def email_intact(all_nodes: list[dict], mail: str) -> bool:
    """The email input holds exactly the typed mail (compared, never printed)."""
    node = single(all_nodes, EMAIL_LABEL)
    return node is not None and node["value"] == mail


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--udid", required=True)
    ap.add_argument("role", choices=["owner", "member"])
    a = ap.parse_args()
    # fail before touching the device when the run has no account
    pw = e.load(f"{a.role}.pw")
    mail = e.email(a.role)
    ui.install_signal_handlers()
    start = ui.nodes(a.udid)
    # the register form uses the same input labels: only ever type on the login screen
    if not any(LOGIN_HEADING.match(n["label"] or "") for n in start):
        raise SystemExit("not on the login screen; nothing typed")
    email_node = single(start, EMAIL_LABEL)
    password_node = single(start, PASSWORD_LABEL)
    if email_node is None or password_node is None:
        raise SystemExit("expected exactly one email and one password input; nothing typed")
    if email_node["value"] or password_node["value"] or not on_screen(start, email_node):
        raise SystemExit("inputs not empty or email input off screen; nothing typed")
    email_xy = ui.center(email_node["bounds"])
    body = (
        f'- tapOn:\n    point: "{email_xy[0]},{email_xy[1]}"\n'
        f"- inputText: {json.dumps(mail)}\n"
        "- hideKeyboard\n"
    )
    rc = ui.maestro_flow(a.udid, body, quiet=True)
    if rc != 0:
        raise SystemExit(f"login flow failed rc={rc} (credentials not shown)")
    # The password is typed only into a verified input. The layout moves while typing, so look
    # again: the email input must hold the mail, the password input must be found and empty.
    # The first hideKeyboard sometimes leaves the keyboard up (or the snapshot is taken mid
    # animation, iPhone 17, 2026-11-06): wait 1.5 s and ask again, at most twice, before giving up.
    before = ui.nodes(a.udid)
    for _ in range(2):
        if not keyboard_up(before):
            break
        time.sleep(1.5)
        ui.maestro_flow(a.udid, "- hideKeyboard")
        before = ui.nodes(a.udid)
    password_node = single(before, PASSWORD_LABEL)
    if password_node is None or password_node["value"] or not email_intact(before, mail):
        raise SystemExit("inputs not as expected after the email; password not typed")
    # a tap while the keyboard is still up (or on an off-screen input) would hit a key, and the
    # password would then go into the email field
    if keyboard_up(before) or not on_screen(before, password_node):
        raise SystemExit("keyboard still up or password input off screen; password not typed")
    pw_xy = ui.center(password_node["bounds"])
    ui.maestro_flow(a.udid, f'- tapOn:\n    point: "{pw_xy[0]},{pw_xy[1]}"')
    check = ui.nodes(a.udid)
    if not keyboard_up(check) or not email_intact(check, mail):
        raise SystemExit("password field not focused as expected; password not typed")
    rc = ui.maestro_flow(a.udid, f"- inputText: {json.dumps(pw)}\n- hideKeyboard", quiet=True)
    if rc != 0:
        raise SystemExit(f"login flow failed rc={rc} (credentials not shown)")
    ui.maestro_flow(a.udid, '- tapOn:\n    text: "(Log in|Anmelden)"')
    print("login submitted as", a.role)
    return 0


if __name__ == "__main__":
    sys.exit(main())
