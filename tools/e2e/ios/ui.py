#!/usr/bin/env python3
"""iOS simulator UI helper on top of `maestro hierarchy` (the iOS twin of android/ui.py).

  ui.py --udid UDID list [--full] [--all]     interactive nodes (label, bounds, state)
  ui.py --udid UDID has REGEX                 exit 0 if a node label matches
  ui.py --udid UDID tap REGEX [--nth N]       tap the centre of the N-th matching node
  ui.py --udid UDID point X Y                 tap absolute points
  ui.py --udid UDID swipe X1 Y1 X2 Y2 [MS]    swipe between absolute points (pt)
  ui.py --udid UDID type TEXT                 type into the focused field (maestro inputText)
  ui.py --udid UDID erase N                   delete N characters in the focused field
  ui.py --udid UDID hide-keyboard             dismiss the software keyboard (maestro hideKeyboard)
  ui.py --udid UDID shot OUT.png              screenshot via simctl
  ui.py --udid UDID screen-size               print width height in points

Secure (password) fields are never printed. Every Maestro call is bounded by a
timeout (the process group is killed on expiry) and runs a generated flow in a temp
dir that is removed again. Maestro logs typed text, so the new run directories under
~/.maestro/tests are deleted after each call. The UDID comes from the caller
(`xcrun simctl create`), never from this script.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import tempfile

TIMEOUT = 120
MAESTRO_LOGS = os.path.join(os.path.expanduser("~"), ".maestro", "tests")


def run(args: list[str], timeout: int = TIMEOUT) -> subprocess.CompletedProcess:
    """Run args with a hard timeout; on expiry kill the whole process group."""
    p = subprocess.Popen(
        args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, start_new_session=True
    )
    try:
        out, err = p.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(p.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        p.communicate()
        raise SystemExit(f"{os.path.basename(args[0])} timed out after {timeout}s") from None
    return subprocess.CompletedProcess(args, p.returncode, out, err)


def _log_dirs() -> set[str]:
    try:
        return {e.path for e in os.scandir(MAESTRO_LOGS) if e.is_dir()}
    except FileNotFoundError:
        return set()


def maestro(args: list[str], timeout: int) -> subprocess.CompletedProcess:
    """Run maestro, then delete the log dirs this run created (they contain typed text)."""
    before = _log_dirs()
    try:
        return run(["maestro", *args], timeout=timeout)
    finally:
        for d in _log_dirs() - before:
            shutil.rmtree(d, ignore_errors=True)


def hierarchy(udid: str) -> dict:
    r = maestro(["--device", udid, "hierarchy"], timeout=90)
    if r.returncode != 0:
        raise SystemExit(f"maestro hierarchy failed rc={r.returncode}: {r.stderr[-300:]}")
    return json.loads(r.stdout)


def parse_bounds(s: str) -> tuple[int, int, int, int] | None:
    m = re.match(r"\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]", s or "")
    if not m:
        return None
    return tuple(int(v) for v in m.groups())  # type: ignore[return-value]


def flatten(node: dict, out: list[dict], depth: int = 0) -> None:
    a = node.get("attributes", {})
    b = parse_bounds(a.get("bounds", ""))
    label = a.get("accessibilityText") or a.get("text") or a.get("title") or ""
    out.append({
        "label": label,
        "value": a.get("value", ""),
        "hint": a.get("hintText", ""),
        "id": a.get("resource-id", ""),
        "bounds": b,
        "enabled": a.get("enabled") == "true",
        "selected": a.get("selected") == "true",
        "checked": a.get("checked") == "true",
        "focused": a.get("focused") == "true",
        "secure": "true" in (a.get("password"), a.get("isSecure"), a.get("secure")),
        "class": a.get("class", ""),
        "depth": depth,
    })
    for c in node.get("children", []) or []:
        flatten(c, out, depth + 1)


def nodes(udid: str) -> list[dict]:
    out: list[dict] = []
    flatten(hierarchy(udid), out)
    return out


def center(b: tuple[int, int, int, int]) -> tuple[int, int]:
    return (b[0] + b[2]) // 2, (b[1] + b[3]) // 2


def maestro_flow(udid: str, body: str) -> None:
    with tempfile.TemporaryDirectory(prefix="balu-ios-ui-") as d:
        flow = os.path.join(d, "step.yaml")
        with open(flow, "w", encoding="utf-8") as f:
            f.write("appId: com.blaumedia.balu\n---\n" + body + "\n")
        r = maestro(["--device", udid, "test", flow], timeout=180)
        if r.returncode != 0:
            tail = (r.stdout + r.stderr)[-400:]
            raise SystemExit(f"maestro step failed rc={r.returncode}: {tail}")


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("--udid", required=True)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("list")
    p.add_argument("--full", action="store_true")
    p.add_argument("--all", action="store_true", help="include nodes without label")
    p = sub.add_parser("has")
    p.add_argument("pattern")
    p = sub.add_parser("tap")
    p.add_argument("pattern")
    p.add_argument("--nth", type=int, default=0)
    p = sub.add_parser("point")
    p.add_argument("x", type=int)
    p.add_argument("y", type=int)
    p = sub.add_parser("swipe")
    for k in ("x1", "y1", "x2", "y2"):
        p.add_argument(k, type=int)
    p.add_argument("ms", type=int, nargs="?", default=300)
    p = sub.add_parser("type")
    p.add_argument("text")
    p = sub.add_parser("erase")
    p.add_argument("n", type=int)
    sub.add_parser("hide-keyboard")
    p = sub.add_parser("key")
    p.add_argument("name", help="maestro key name, e.g. enter, back")
    p = sub.add_parser("shot")
    p.add_argument("out")
    sub.add_parser("screen-size")
    a = ap.parse_args()

    if a.cmd == "list":
        for n in nodes(a.udid):
            if n["secure"] or not n["bounds"]:
                continue
            if not (n["label"] or n["value"] or n["hint"] or n["id"]) and not a.all:
                continue
            if not (n["enabled"] or a.all) and not a.full:
                continue
            x1, y1, x2, y2 = n["bounds"]
            text = n["label"] if a.full else n["label"][:60]
            extra = " ".join(k for k in ("checked", "selected", "focused") if n[k])
            print(f"[{x1},{y1}][{x2},{y2}] {text!r} {n['class']} {extra}".rstrip())
        return 0
    if a.cmd == "has":
        pat = re.compile(a.pattern)
        ok = any(pat.search(n["label"]) for n in nodes(a.udid) if not n["secure"])
        print("yes" if ok else "no")
        return 0 if ok else 1
    if a.cmd == "tap":
        pat = re.compile(a.pattern)
        hits = [
            n for n in nodes(a.udid)
            if n["bounds"] and not n["secure"] and pat.search(n["label"])
        ]
        if len(hits) <= a.nth:
            raise SystemExit(f"NOT FOUND {a.pattern!r} (hits={len(hits)})")
        x, y = center(hits[a.nth]["bounds"])
        print("tap", hits[a.nth]["bounds"], repr(hits[a.nth]["label"][:60]))
        maestro_flow(a.udid, f"- tapOn:\n    point: \"{x},{y}\"")
        return 0
    if a.cmd == "point":
        maestro_flow(a.udid, f"- tapOn:\n    point: \"{a.x},{a.y}\"")
        return 0
    if a.cmd == "swipe":
        maestro_flow(
            a.udid,
            f"- swipe:\n    start: \"{a.x1},{a.y1}\"\n    end: \"{a.x2},{a.y2}\"\n"
            f"    duration: {a.ms}",
        )
        return 0
    if a.cmd == "type":
        # the text is never echoed by this script; maestro's own logs are cleaned in maestro()
        with tempfile.TemporaryDirectory(prefix="balu-ios-type-") as d:
            flow = os.path.join(d, "type.yaml")
            with open(flow, "w", encoding="utf-8") as f:
                f.write("appId: com.blaumedia.balu\n---\n- inputText: " + json.dumps(a.text) + "\n")
            r = maestro(["--device", a.udid, "test", flow], timeout=120)
        print("typed" if r.returncode == 0 else f"type failed rc={r.returncode}")
        return r.returncode
    if a.cmd == "erase":
        maestro_flow(a.udid, f"- eraseText: {a.n}")
        return 0
    if a.cmd == "key":
        maestro_flow(a.udid, f"- pressKey: {a.name}")
        return 0
    if a.cmd == "hide-keyboard":
        maestro_flow(a.udid, "- hideKeyboard")
        return 0
    if a.cmd == "shot":
        r = run(["xcrun", "simctl", "io", a.udid, "screenshot", a.out], timeout=60)
        print("shot", a.out if r.returncode == 0 else r.stderr[-200:])
        return r.returncode
    if a.cmd == "screen-size":
        root = hierarchy(a.udid)
        b = parse_bounds(root["attributes"]["bounds"]) or (0, 0, 0, 0)
        print(b[2], b[3])
        return 0
    return 2


if __name__ == "__main__":
    sys.exit(main())
