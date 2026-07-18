"""Unit tests for the RRULE-subset recurrence engine."""

from __future__ import annotations

from datetime import date

import pytest

from balu.sync.recurrence import next_occurrence, parse_recurrence


def test_daily():
    assert next_occurrence("FREQ=DAILY", date(2026, 7, 23)) == date(2026, 7, 24)


def test_daily_interval():
    assert next_occurrence("FREQ=DAILY;INTERVAL=3", date(2026, 7, 23)) == date(2026, 7, 26)


def test_weekly_no_byday():
    assert next_occurrence("FREQ=WEEKLY", date(2026, 7, 23)) == date(2026, 7, 30)


def test_weekly_interval_no_byday():
    assert next_occurrence("FREQ=WEEKLY;INTERVAL=2", date(2026, 7, 23)) == date(2026, 8, 6)


def test_weekly_byday_same_week():
    # 2026-07-21 is a Tuesday; next among TU,FR that week is Friday 2026-07-24.
    assert (
        next_occurrence("FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,FR", date(2026, 7, 21))
        == date(2026, 7, 24)
    )


def test_weekly_byday_interval_jump():
    # From Friday 2026-07-24 (an "on" week), INTERVAL=2 jumps two weeks to Tue 2026-08-04.
    assert (
        next_occurrence("FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,FR", date(2026, 7, 24))
        == date(2026, 8, 4)
    )


def test_weekly_single_byday():
    # every Tuesday from a Wednesday -> next Tuesday
    assert next_occurrence("FREQ=WEEKLY;BYDAY=TU", date(2026, 7, 22)) == date(2026, 7, 28)


def test_monthly():
    assert next_occurrence("FREQ=MONTHLY", date(2026, 7, 15)) == date(2026, 8, 15)


def test_monthly_month_end_clamp():
    # Jan 31 + 1 month -> Feb 28 (2026 non-leap)
    assert next_occurrence("FREQ=MONTHLY", date(2026, 1, 31)) == date(2026, 2, 28)


def test_monthly_month_end_clamp_leap():
    # Jan 31 2024 + 1 month -> Feb 29 (leap)
    assert next_occurrence("FREQ=MONTHLY", date(2024, 1, 31)) == date(2024, 2, 29)


def test_monthly_interval():
    assert next_occurrence("FREQ=MONTHLY;INTERVAL=3", date(2026, 7, 15)) == date(2026, 10, 15)


def test_yearly():
    assert next_occurrence("FREQ=YEARLY", date(2026, 3, 10)) == date(2027, 3, 10)


def test_yearly_feb29_clamp():
    assert next_occurrence("FREQ=YEARLY", date(2024, 2, 29)) == date(2025, 2, 28)


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
