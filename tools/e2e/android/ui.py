#!/usr/bin/env python3
"""uiautomator helpers for an Android emulator you started yourself.

ANDROID_SERIAL is required: these scripts never pick a device. Password fields
(password="true") are skipped by find/list/has and blanked in `dump`.

  ui.py list | tap REGEX [--desc] | has REGEX [--desc] | dump FILE
  ui.py swipe DESC_REGEX left|right | state | type TEXT
"""
from __future__ import annotations

import os
import re
import subprocess
import sys
import time
import xml.etree.ElementTree as ET

_SERIAL = os.environ.get("ANDROID_SERIAL")
if not _SERIAL:
    raise SystemExit(
        "set ANDROID_SERIAL to your own emulator (adb devices); these scripts never pick a device"
    )
SER: str = _SERIAL
REMOTE = "/sdcard/balu-e2e-ui.xml"


def adb(*a: str, check: bool = True) -> str:
    try:
        r = subprocess.run(["adb", "-s", SER, *a], capture_output=True, text=True, check=check)
    except subprocess.CalledProcessError as err:
        raise SystemExit(
            f"adb failed for {SER} ({' '.join(a[:2])}): exit {err.returncode}"
        ) from None
    except FileNotFoundError:
        raise SystemExit("adb not found on PATH") from None
    return r.stdout


def dump() -> ET.Element:
    for _ in range(5):  # uiautomator fails with "could not get idle state" while the UI animates
        adb("shell", "uiautomator", "dump", REMOTE, check=False)
        xml = adb("exec-out", "cat", REMOTE, check=False)
        adb("shell", "rm", "-f", REMOTE, check=False)
        if "<?xml" in xml:
            return ET.fromstring(xml[xml.index("<?xml"):])
        time.sleep(1)
    raise SystemExit("uiautomator dump failed after retries")


def nodes(root: ET.Element):
    for n in root.iter("node"):
        if n.get("password") != "true":
            yield n


def nums(bounds: str | None) -> list[int]:
    return [int(x) for x in re.findall(r"\d+", bounds or "")]


def center(bounds: str | None) -> tuple[int, int]:
    if not bounds:
        raise SystemExit("node has no bounds")
    x1, y1, x2, y2 = nums(bounds)
    return (x1 + x2) // 2, (y1 + y2) // 2


def find(root: ET.Element, pat: str, desc: bool = False) -> list[ET.Element]:
    attr = "content-desc" if desc else "text"
    return [n for n in nodes(root) if re.search(pat, n.get(attr) or "")]


def main() -> int:
    argv = sys.argv[1:]
    if not argv:
        raise SystemExit(__doc__)
    cmd = argv[0]
    desc = "--desc" in argv
    args = [x for x in argv[1:] if x != "--desc"]
    need = {"list": 0, "state": 0, "type": 1, "tap": 1, "has": 1, "dump": 1, "swipe": 2}
    if cmd not in need:
        raise SystemExit(__doc__)
    if len(args) < need[cmd] or (cmd != "type" and len(args) > need[cmd]):
        raise SystemExit(f"usage error: {cmd} takes {need[cmd]} argument(s)\n{__doc__}")
    if cmd == "swipe" and args[1] not in ("left", "right"):
        raise SystemExit("swipe direction must be left or right")
    if cmd == "type":
        text = " ".join(args)
        if not re.fullmatch(r"[A-Za-z0-9@._+:/ -]*", text):
            print("refusing characters outside [A-Za-z0-9@._+:/ -]")
            return 2
        adb("shell", "input", "text", text.replace(" ", "%s"))
        return 0
    root = dump()
    if cmd == "list":
        for n in nodes(root):
            t, d = n.get("text", ""), n.get("content-desc", "")
            if t or d:
                print(
                    f"{n.get('bounds')} en={n.get('enabled')} clk={n.get('clickable')} "
                    f"sel={n.get('selected', '')} text={t[:70]!r} desc={d[:80]!r}"
                )
    elif cmd == "tap":
        hits = find(root, args[0], desc)
        if not hits:
            print("NOT FOUND", args[0])
            return 2
        x, y = center(hits[0].get("bounds"))
        print("tap", hits[0].get("bounds"))
        adb("shell", "input", "tap", str(x), str(y))
    elif cmd == "has":
        hits = find(root, args[0], desc)
        print("count", len(hits))
        for n in hits:
            print(n.get("bounds"), "en=", n.get("enabled"), "text=", (n.get("text") or "")[:60],
                  "desc=", (n.get("content-desc") or "")[:80])
    elif cmd == "dump":
        for n in root.iter("node"):
            if n.get("password") == "true":
                n.set("text", "")
        with open(args[0], "w", encoding="utf-8") as f:
            f.write(ET.tostring(root, encoding="unicode"))
        print("saved", args[0])
    elif cmd == "swipe":
        hits = find(root, args[0], desc=True)
        if not hits:
            print("ROW NOT FOUND", args[0])
            return 2
        x1, y1, x2, y2 = nums(hits[0].get("bounds"))
        y = (y1 + y2) // 2
        w = x2 - x1
        a, b = x1 + int(0.85 * w), x1 + int(0.15 * w)
        if args[1] == "right":
            a, b = b, a
        adb("shell", "input", "swipe", str(a), str(y), str(b), str(y), "350")
        print("swiped", args[1], "y", y)
    elif cmd == "state":
        top = max(
            (nums(n.get("bounds"))[3] for n in root.iter("node")), default=0
        )
        sel = [
            n.get("content-desc")
            for n in nodes(root)
            if n.get("selected") == "true" and n.get("content-desc")
        ]
        headers = [
            n.get("text") for n in nodes(root)
            if n.get("text") and nums(n.get("bounds"))[1] < top * 0.14
        ]
        focus = re.search(r"mCurrentFocus=.*", adb("shell", "dumpsys", "window"))
        print("selected", sel)
        print("header", headers)
        print("focus", focus.group(0) if focus else "unknown")
        print("dev-overlay nodes", len(find(root, "DEVELOPMENT|Reload")))
    else:
        raise SystemExit(__doc__)
    return 0


if __name__ == "__main__":
    sys.exit(main())
