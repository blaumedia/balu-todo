#!/usr/bin/env python3
"""Log in on the app's login form as an e2e role: login.py ROLE (owner|member).

Prints only the tap bounds, never the credentials. Labels in en/de.
"""
from __future__ import annotations

import argparse
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import balu_e2e as e  # noqa: E402
import ui  # noqa: E402


def tap(pat: str) -> None:
    root = ui.dump()
    hits = ui.find(root, pat) or ui.find(root, pat, desc=True)
    if not hits:
        raise SystemExit(f"NOT FOUND {pat}")
    x, y = ui.center(hits[0].get("bounds"))
    print("tap", hits[0].get("bounds"))
    ui.adb("shell", "input", "tap", str(x), str(y))


def type_text(text: str) -> None:
    # argument list, never a shell string; the device shell sees one `input text` call
    ui.adb("shell", "input", "text", text.replace(" ", "%s"))


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("role", choices=["owner", "member"])
    role = ap.parse_args().role
    # fail before touching the device when this run has no setup for the role
    pw = e.load(f"{role}.pw")
    tap(r"^(Email|E-Mail)$")
    time.sleep(1)
    type_text(e.email(role))
    time.sleep(1)
    tap(r"^(Password|Passwort)$")
    time.sleep(1)
    type_text(pw)
    time.sleep(1)
    ui.adb("shell", "input", "keyevent", "4")  # BACK closes the keyboard
    time.sleep(1)
    tap(r"^(Log in|Anmelden)$")
    time.sleep(7)
    return 0


if __name__ == "__main__":
    sys.exit(main())
