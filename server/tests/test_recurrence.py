"""Unit tests for the RRULE-subset recurrence engine.

`PARITY_VECTORS` is mirrored verbatim in
`packages/sync-client/test/recurrence.test.ts` — the two engines must agree for
every rule, or a completed recurring task visibly jumps to a different date once
the sync response lands (I1). Keep the two lists in sync.
"""

from __future__ import annotations

from datetime import date

import pytest

from balu.sync.recurrence import next_occurrence, parse_recurrence


def d(iso: str) -> date:
    return date.fromisoformat(iso)


# (rrule, anchor, after, expected)
PARITY_VECTORS: list[tuple[str, str, str, str]] = [
    # ── DAILY ──────────────────────────────────────────────────────────────
    ("FREQ=DAILY", "2026-07-23", "2026-07-23", "2026-07-24"),
    ("FREQ=DAILY;INTERVAL=3", "2026-07-23", "2026-07-23", "2026-07-26"),
    # Completed late: the phase of the every-3-days series is kept, so the next
    # date is anchor+9, not after+3.
    ("FREQ=DAILY;INTERVAL=3", "2026-07-01", "2026-07-08", "2026-07-10"),
    ("FREQ=DAILY;INTERVAL=5", "2026-07-01", "2026-07-23", "2026-07-26"),
    ("FREQ=DAILY", "2026-07-01", "2026-07-23", "2026-07-24"),
    # after < anchor: the anchor itself is the next occurrence.
    ("FREQ=DAILY;INTERVAL=2", "2026-07-23", "2026-07-01", "2026-07-23"),

    # ── WEEKLY without BYDAY ───────────────────────────────────────────────
    ("FREQ=WEEKLY", "2026-07-23", "2026-07-23", "2026-07-30"),
    ("FREQ=WEEKLY;INTERVAL=2", "2026-07-23", "2026-07-23", "2026-08-06"),
    # Two weeks late on an every-2-weeks rule: stays on the anchor's phase.
    ("FREQ=WEEKLY;INTERVAL=2", "2026-07-02", "2026-07-25", "2026-07-30"),
    ("FREQ=WEEKLY;INTERVAL=3", "2026-01-05", "2026-07-23", "2026-08-03"),

    # ── WEEKLY with BYDAY ──────────────────────────────────────────────────
    ("FREQ=WEEKLY;BYDAY=TU", "2026-07-22", "2026-07-22", "2026-07-28"),
    ("FREQ=WEEKLY;BYDAY=MO", "2026-07-23", "2026-07-23", "2026-07-27"),
    ("FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,FR", "2026-07-21", "2026-07-21", "2026-07-24"),
    ("FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,FR", "2026-07-24", "2026-07-24", "2026-08-04"),
    ("FREQ=WEEKLY;INTERVAL=2;BYDAY=TU", "2026-07-21", "2026-07-25", "2026-08-04"),
    # Completed a full cycle late: the anchor-aligned Monday, not "two weeks
    # after `after`" (the pre-fix server answer would have been 2026-08-17).
    ("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO", "2026-07-06", "2026-08-05", "2026-08-17"),
    ("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO", "2026-07-06", "2026-07-25", "2026-08-03"),
    ("FREQ=WEEKLY;INTERVAL=3;BYDAY=WE,SA", "2026-07-01", "2026-07-01", "2026-07-04"),
    ("FREQ=WEEKLY;INTERVAL=3;BYDAY=WE,SA", "2026-07-04", "2026-07-04", "2026-07-22"),
    # BYDAY order in the rule string must not matter.
    ("FREQ=WEEKLY;BYDAY=FR,MO", "2026-07-21", "2026-07-21", "2026-07-24"),

    # ── MONTHLY ────────────────────────────────────────────────────────────
    ("FREQ=MONTHLY", "2026-07-15", "2026-07-15", "2026-08-15"),
    ("FREQ=MONTHLY", "2026-01-31", "2026-01-31", "2026-02-28"),
    ("FREQ=MONTHLY", "2024-01-31", "2024-01-31", "2024-02-29"),
    # Month-end must recover: measured from the anchor, Jan 31 → Mar 31.
    ("FREQ=MONTHLY", "2026-01-31", "2026-02-28", "2026-03-31"),
    ("FREQ=MONTHLY;INTERVAL=3", "2026-07-15", "2026-07-15", "2026-10-15"),
    # Late on a quarterly rule: keeps the 15th and the anchor's phase.
    ("FREQ=MONTHLY;INTERVAL=3", "2026-01-15", "2026-08-20", "2026-10-15"),
    ("FREQ=MONTHLY;INTERVAL=2", "2026-01-31", "2026-04-10", "2026-05-31"),

    # ── YEARLY ─────────────────────────────────────────────────────────────
    ("FREQ=YEARLY", "2026-03-10", "2026-03-10", "2027-03-10"),
    ("FREQ=YEARLY", "2024-02-29", "2024-02-29", "2025-02-28"),
    ("FREQ=YEARLY", "2024-02-29", "2027-01-01", "2027-02-28"),
    # Leap day recovers, because every step is measured from the anchor and not
    # from the previous (clamped) occurrence.
    ("FREQ=YEARLY", "2024-02-29", "2027-03-01", "2028-02-29"),
    ("FREQ=YEARLY;INTERVAL=2", "2026-03-10", "2026-03-10", "2028-03-10"),
    ("FREQ=YEARLY;INTERVAL=5", "2020-06-01", "2026-07-23", "2030-06-01"),
]


@pytest.mark.parametrize("rrule,anchor,after,expected", PARITY_VECTORS)
def test_parity_vectors(rrule, anchor, after, expected):
    assert next_occurrence(rrule, d(anchor), d(after)) == d(expected)


def test_after_defaults_to_anchor():
    assert next_occurrence("FREQ=DAILY", d("2026-07-23")) == d("2026-07-24")


def test_result_is_always_strictly_after():
    for rrule, anchor, after, expected in PARITY_VECTORS:
        assert d(expected) > d(after), (rrule, anchor, after)


def test_parse_rejects_byday_without_weekly():
    with pytest.raises(ValueError):
        parse_recurrence("FREQ=DAILY;BYDAY=MO")


def test_parse_rejects_bad_freq():
    with pytest.raises(ValueError):
        parse_recurrence("FREQ=HOURLY")


def test_parse_rejects_bad_interval():
    with pytest.raises(ValueError):
        parse_recurrence("FREQ=DAILY;INTERVAL=0")


def test_parse_rejects_bad_byday_code():
    with pytest.raises(ValueError):
        parse_recurrence("FREQ=WEEKLY;BYDAY=XX")
