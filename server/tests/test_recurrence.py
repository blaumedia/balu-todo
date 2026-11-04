"""Unit tests for the RRULE-subset recurrence engine.

`PARITY_VECTORS` is mirrored verbatim in
`packages/sync-client/test/recurrence.test.ts` — the two engines must agree for
every rule, or a completed recurring task visibly jumps to a different date once
the sync response lands (I1). Keep the two lists in sync.

`ROLL_VECTORS` (the whole roll-forward including the reminder) and `OFFSET_VECTORS`
are mirrored the same way in that file.
"""

from __future__ import annotations

from datetime import UTC, date, datetime

import pytest

from balu.sync.recurrence import next_occurrence, parse_recurrence, roll_forward, utc_offset_minutes


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


# (rrule, start, deadline, reminder, today, utc_offset, exp_start, exp_deadline, exp_reminder)
ROLL_VECTORS: list[
    tuple[
        str, str | None, str | None, str | None, str, int,
        str | None, str | None, str | None,
    ]
] = [
    # start branch: the reminder moves with the start date
    ("FREQ=DAILY", "2026-07-23", None, "2026-07-23T07:00:00Z", "2026-07-23", 120,
     "2026-07-24", None, "2026-07-24T07:00:00Z"),
    # completed late, 42-day shift
    ("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO", "2026-07-06", "2026-07-08", "2026-07-06T07:00:00Z",
     "2026-08-05", 120, "2026-08-17", "2026-08-19", "2026-08-17T07:00:00Z"),
    # no reminder
    ("FREQ=DAILY", "2026-07-23", None, None, "2026-07-23", 0,
     "2026-07-24", None, None),
    # reminder not on the start day keeps its distance
    ("FREQ=DAILY", "2026-07-23", None, "2026-07-20T07:00:00Z", "2026-07-23", 120,
     "2026-07-24", None, "2026-07-21T07:00:00Z"),
    # deadline branch, 181 days
    ("FREQ=MONTHLY", None, "2026-01-31", "2026-01-31T16:00:00Z", "2026-07-23", 60,
     None, "2026-07-31", "2026-07-31T16:00:00Z"),
    # neither, reminder today
    ("FREQ=DAILY", None, None, "2026-07-23T07:00:00Z", "2026-07-23", 120,
     "2026-07-24", None, "2026-07-24T07:00:00Z"),
    # neither, quick-add rolled it to tomorrow: untouched
    ("FREQ=DAILY", None, None, "2026-07-24T07:00:00Z", "2026-07-23", 120,
     "2026-07-24", None, "2026-07-24T07:00:00Z"),
    # neither, completed days late
    ("FREQ=DAILY", None, None, "2026-07-20T07:00:00Z", "2026-07-23", 120,
     "2026-07-24", None, "2026-07-24T07:00:00Z"),
    # neither, reminder on another weekday
    ("FREQ=WEEKLY;BYDAY=MO", None, None, "2026-07-23T07:00:00Z", "2026-07-22", 120,
     "2026-07-27", None, "2026-07-27T07:00:00Z"),
    # UTC-5, 21:00 local: the offset decides the day
    ("FREQ=DAILY", None, None, "2026-07-24T02:00:00Z", "2026-07-23", -300,
     "2026-07-24", None, "2026-07-25T02:00:00Z"),
    # same without offset: UTC day, untouched
    ("FREQ=DAILY", None, None, "2026-07-24T02:00:00Z", "2026-07-23", 0,
     "2026-07-24", None, "2026-07-24T02:00:00Z"),
    # UTC+13
    ("FREQ=DAILY", None, None, "2026-07-23T19:00:00Z", "2026-07-24", 780,
     "2026-07-25", None, "2026-07-24T19:00:00Z"),
    # reminder already past the next occurrence: never moves back
    ("FREQ=DAILY", None, None, "2026-08-10T07:00:00Z", "2026-07-23", 120,
     "2026-07-24", None, "2026-08-10T07:00:00Z"),
    # neither, no reminder
    ("FREQ=DAILY", None, None, None, "2026-07-23", 0,
     "2026-07-24", None, None),
]


def _iso_utc(value: datetime | None) -> str | None:
    return None if value is None else value.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


@pytest.mark.parametrize(
    (
        "rrule", "start", "deadline", "reminder", "today", "offset",
        "exp_start", "exp_deadline", "exp_reminder",
    ),
    ROLL_VECTORS,
)
def test_roll_forward_parity_vectors(
    rrule, start, deadline, reminder, today, offset, exp_start, exp_deadline, exp_reminder
):
    rolled = roll_forward(
        rrule,
        d(start) if start else None,
        d(deadline) if deadline else None,
        datetime.fromisoformat(reminder.replace("Z", "+00:00")) if reminder else None,
        d(today),
        offset,
    )
    assert rolled.start_date == (d(exp_start) if exp_start else None)
    assert rolled.deadline == (d(exp_deadline) if exp_deadline else None)
    assert _iso_utc(rolled.reminder_at) == exp_reminder


# (input, expected)
OFFSET_VECTORS: list[tuple[object, int]] = [
    (120, 120),
    (0, 0),
    (-300, -300),
    (840, 840),
    (-720, -720),
    (841, 0),
    (-721, 0),
    ("120", 0),
    (True, 0),
    (None, 0),
    (1.5, 0),
]


@pytest.mark.parametrize(("value", "expected"), OFFSET_VECTORS)
def test_utc_offset_minutes(value, expected):
    assert utc_offset_minutes(value) == expected
