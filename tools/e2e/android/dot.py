#!/usr/bin/env python3
"""Read the header sync-indicator dot colour from a screencap (no UI tree exposes it).

  dot.py [--watch SECONDS]

Looks only at the dot window left of the Settings button and prints the dominant
status colour. The window is tied to the current header layout (x 900-957, y 115-152
on a 1080 px wide screen); re-measure it if the header changes.
Needs ANDROID_SERIAL and Pillow: uv run --with pillow python tools/e2e/android/dot.py
"""
from __future__ import annotations

import sys

# these scripts use 3.10+ syntax and do not import balu_e2e, so they check the version themselves
if sys.version_info < (3, 11):  # noqa: UP036 - ruff targets the server's Python, this runs on python3
    raise SystemExit("tools/e2e needs Python 3.11+")

import argparse
import collections
import io
import os
import subprocess
import time

try:
    from PIL import Image
except ImportError:
    raise SystemExit("needs Pillow: uv run --with pillow python tools/e2e/android/dot.py") from None

SER = os.environ.get("ANDROID_SERIAL")
if not SER:
    raise SystemExit(
        "set ANDROID_SERIAL to your own emulator (adb devices); these scripts never pick a device"
    )

PALETTE = {
    "synced": (0x16, 0xA3, 0x4A), "syncing": (0x02, 0x84, 0xC7), "error": (0xDC, 0x26, 0x26),
    "offline": (0x94, 0xA3, 0xB8), "synced-dark": (0x4A, 0xDE, 0x80),
    "syncing-dark": (0x38, 0xBD, 0xF8), "error-dark": (0xF8, 0x71, 0x71),
    "offline-dark": (0x64, 0x74, 0x8B),
}


def near(p, c) -> float:
    return sum((a - b) ** 2 for a, b in zip(p, c, strict=True)) ** 0.5


def sample() -> str:
    cmd = ["adb", "-s", SER, "exec-out", "screencap", "-p"]
    try:
        png = subprocess.run(cmd, capture_output=True, check=True).stdout
    except subprocess.CalledProcessError as err:
        raise SystemExit(f"adb screencap failed for {SER}: exit {err.returncode}") from None
    except FileNotFoundError:
        raise SystemExit("adb not found on PATH") from None
    im = Image.open(io.BytesIO(png)).convert("RGB")
    sx = im.size[0] / 1080.0  # scale by width so the window follows other resolutions
    box = (int(900 * sx), int(115 * sx), int(957 * sx), int(152 * sx))
    hits: collections.Counter = collections.Counter()
    for p, n in collections.Counter(im.crop(box).getdata()).items():
        for name, c in PALETTE.items():
            if near(p, c) < 20:
                hits[name] += n
    return f"dot: {hits.most_common(1)[0][0] if hits else 'none'} {dict(hits.most_common(3))}"


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--watch", type=int, default=0, metavar="SECONDS")
    a = p.parse_args()
    if not a.watch:
        print(sample())
        return
    end = time.time() + a.watch
    while time.time() < end:
        print(time.strftime("%H:%M:%S"), sample(), flush=True)
        time.sleep(1)


if __name__ == "__main__":
    main()
