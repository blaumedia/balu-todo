#!/usr/bin/env python3
"""iOS simulator UI helper on top of `maestro hierarchy` (the iOS twin of android/ui.py).

  ui.py --udid UDID list [--full] [--all]     interactive nodes (label, bounds, state)
  ui.py --udid UDID has REGEX                 exit 0 if a node label matches
  ui.py --udid UDID tap REGEX [--nth N]       tap the centre of the N-th matching node
  ui.py --udid UDID point X Y                 tap absolute points
  ui.py --udid UDID swipe X1 Y1 X2 Y2 [MS]    swipe between absolute points (pt)
  ui.py --udid UDID type TEXT|-               type into the focused field (maestro inputText);
                                              `-` reads the text from stdin. TEXT is visible in ps
                                              and transcripts: never pass secrets (login.py does)
  ui.py --udid UDID key NAME                  press a key (maestro pressKey, e.g. enter)
  ui.py --udid UDID erase N                   delete N characters in the focused field
  ui.py --udid UDID hide-keyboard             dismiss the software keyboard (maestro hideKeyboard)
  ui.py --udid UDID shot OUT.png              screenshot via simctl
  ui.py --udid UDID screen-size               print width height in points

Node values are never printed, only labels, bounds and state. Every Maestro call is bounded
by a timeout (the process group is killed on expiry, SIGINT, SIGTERM or SIGHUP) and runs a generated
flow in a temp dir that is removed again. Maestro logs typed text, so its test output and
debug output go to a private temp dir that is removed after each call. The UDID comes from
the caller (`xcrun simctl create`), never from this script.
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


_CHILDREN: set[int] = set()


def _killpg(pid: int) -> None:
    try:
        os.killpg(pid, signal.SIGKILL)
    except (ProcessLookupError, PermissionError):
        pass


_SIGNALS = (signal.SIGINT, signal.SIGTERM, signal.SIGHUP)


def _on_signal(signum: int, _frame: object) -> None:
    """Kill every child process group, then exit (finally blocks run).

    Further signals are ignored from here on so that cleanup (temp dirs holding the flow file
    and Maestro output) cannot be interrupted. SIGKILL of this script cannot be caught: it
    leaves the Maestro JVM and the temp dirs behind.
    """
    for sig in _SIGNALS:
        signal.signal(sig, signal.SIG_IGN)
    for pid in list(_CHILDREN):
        _killpg(pid)
    raise SystemExit(128 + signum)


def run(args: list[str], timeout: int = TIMEOUT) -> subprocess.CompletedProcess:
    """Run args with a hard timeout; on expiry, signal or interrupt kill the process group."""
    # block the signals from Popen until the child is registered, so a signal in between
    # cannot orphan it; the child itself starts with an empty mask
    old_mask = signal.pthread_sigmask(signal.SIG_BLOCK, _SIGNALS)
    try:
        p = subprocess.Popen(
            args,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            start_new_session=True,
            preexec_fn=lambda: signal.pthread_sigmask(signal.SIG_SETMASK, ()),  # noqa: PLW1509
        )
        _CHILDREN.add(p.pid)
    finally:
        signal.pthread_sigmask(signal.SIG_SETMASK, old_mask)
    try:
        out, err = p.communicate(timeout=timeout)
    except BaseException as exc:
        _killpg(p.pid)
        try:
            p.communicate(timeout=10)
        except subprocess.TimeoutExpired:
            # a descendant left the group and still holds the pipes: give up on them
            for f in (p.stdout, p.stderr):
                if f:
                    f.close()
            try:
                p.wait(timeout=10)
            except subprocess.TimeoutExpired:
                pass
        if isinstance(exc, subprocess.TimeoutExpired):
            raise SystemExit(
                f"{os.path.basename(args[0])} timed out after {timeout}s"
            ) from None
        raise
    finally:
        _CHILDREN.discard(p.pid)
    return subprocess.CompletedProcess(args, p.returncode, out, err)


def maestro(
    args: list[str], timeout: int, flow: str | None = None
) -> subprocess.CompletedProcess:
    """Run maestro with all of its output in a private temp dir that is removed afterwards.

    args are the global options (e.g. --device UDID) plus the subcommand for non-flow calls;
    flow is the path of a flow file to run with `maestro test`.

    Maestro logs typed text (inputText) verbatim, so `maestro test` gets --test-output-dir and
    --debug-output pointing at a per-call mkdtemp() (0700). Nothing is deleted by guessing
    which folders in ~/.maestro/tests are ours. Not redirectable: Maestro's own
    ~/Library/Logs/maestro/<timestamp>_<pid>.zip (checked: its maestro.log is empty).
    """
    out_dir = tempfile.mkdtemp(prefix="balu-ios-maestro-")
    cmd = ["maestro", *args]
    if flow is not None:
        cmd += [
            "test",
            "--test-output-dir",
            out_dir,
            "--debug-output",
            out_dir,
            "--flatten-debug-output",
            flow,
        ]
    try:
        return run(cmd, timeout=timeout)
    finally:
        shutil.rmtree(out_dir, ignore_errors=True)


def hierarchy(udid: str) -> dict:
    r = maestro(["--device", udid, "hierarchy"], timeout=90)
    if r.returncode != 0:
        raise SystemExit(
            f"maestro hierarchy failed rc={r.returncode}: {r.stderr[-300:]}"
        )
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
    out.append(
        {
            "label": label,
            "value": a.get("value", ""),
            "hint": a.get("hintText", ""),
            "id": a.get("resource-id", ""),
            "bounds": b,
            "enabled": a.get("enabled") == "true",
            "selected": a.get("selected") == "true",
            "checked": a.get("checked") == "true",
            "focused": a.get("focused") == "true",
            "depth": depth,
        }
    )
    for c in node.get("children", []) or []:
        flatten(c, out, depth + 1)


def nodes(udid: str) -> list[dict]:
    out: list[dict] = []
    flatten(hierarchy(udid), out)
    return out


def center(b: tuple[int, int, int, int]) -> tuple[int, int]:
    return (b[0] + b[2]) // 2, (b[1] + b[3]) // 2


def screen_size(all_nodes: list[dict]) -> tuple[int, int]:
    """Width and height in points of the first node with a non-empty frame (the window)."""
    for n in all_nodes:
        b = n["bounds"]
        if b and b[2] > b[0] and b[3] > b[1]:
            return b[2] - b[0], b[3] - b[1]
    return 0, 0


def maestro_flow(udid: str, body: str, quiet: bool = False, timeout: int = 180) -> int:
    """Run a generated flow. quiet: return the rc and print no output (flows with secrets)."""
    with tempfile.TemporaryDirectory(prefix="balu-ios-ui-") as d:
        flow = os.path.join(d, "step.yaml")
        with open(flow, "w", encoding="utf-8") as f:
            f.write("appId: com.blaumedia.balu\n---\n" + body + "\n")
        r = maestro(["--device", udid], timeout=timeout, flow=flow)
    if r.returncode != 0 and not quiet:
        tail = (r.stdout + r.stderr)[-400:]
        raise SystemExit(f"maestro step failed rc={r.returncode}: {tail}")
    return r.returncode


def install_signal_handlers() -> None:
    for sig in _SIGNALS:
        signal.signal(sig, _on_signal)


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
    p.add_argument(
        "text", help="text to type, or - to read it from stdin (never pass secrets)"
    )
    p = sub.add_parser("erase")
    p.add_argument("n", type=int)
    sub.add_parser("hide-keyboard")
    p = sub.add_parser("key")
    p.add_argument("name", help="maestro key name, e.g. enter, back")
    p = sub.add_parser("shot")
    p.add_argument("out")
    sub.add_parser("screen-size")
    a = ap.parse_args()
    install_signal_handlers()

    if a.cmd == "list":
        for n in nodes(a.udid):
            if not n["bounds"]:
                continue
            if not (n["label"] or n["value"] or n["hint"] or n["id"]) and not a.all:
                continue
            if not (n["enabled"] or a.all):
                continue
            x1, y1, x2, y2 = n["bounds"]
            text = n["label"] if a.full else n["label"][:60]
            extra = " ".join(k for k in ("checked", "selected", "focused") if n[k])
            print(f"[{x1},{y1}][{x2},{y2}] {text!r} {extra}".rstrip())
        return 0
    if a.cmd == "has":
        pat = re.compile(a.pattern)
        ok = any(pat.search(n["label"]) for n in nodes(a.udid))
        print("yes" if ok else "no")
        return 0 if ok else 1
    if a.cmd == "tap":
        pat = re.compile(a.pattern)
        hits = [n for n in nodes(a.udid) if n["bounds"] and pat.search(n["label"])]
        if len(hits) <= a.nth:
            raise SystemExit(f"NOT FOUND {a.pattern!r} (hits={len(hits)})")
        x, y = center(hits[a.nth]["bounds"])
        print("tap", hits[a.nth]["bounds"], repr(hits[a.nth]["label"][:60]))
        maestro_flow(a.udid, f'- tapOn:\n    point: "{x},{y}"')
        return 0
    if a.cmd == "point":
        maestro_flow(a.udid, f'- tapOn:\n    point: "{a.x},{a.y}"')
        return 0
    if a.cmd == "swipe":
        maestro_flow(
            a.udid,
            f'- swipe:\n    start: "{a.x1},{a.y1}"\n    end: "{a.x2},{a.y2}"\n'
            f"    duration: {a.ms}",
        )
        return 0
    if a.cmd == "type":
        # the text is never echoed by this script; maestro's own output goes to a temp dir
        if a.text == "-" and sys.stdin.isatty():
            raise SystemExit("type -: pipe the text in (stdin is a terminal)")
        text = sys.stdin.read().rstrip("\n") if a.text == "-" else a.text
        if "${" in text:
            raise SystemExit(
                "type: text containing '${' is evaluated by maestro; not supported"
            )
        rc = maestro_flow(
            a.udid, "- inputText: " + json.dumps(text), quiet=True, timeout=120
        )
        print("typed" if rc == 0 else f"type failed rc={rc}")
        return rc
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
        w, h = screen_size(nodes(a.udid))
        print(w, h)
        return 0
    return 2


if __name__ == "__main__":
    sys.exit(main())
