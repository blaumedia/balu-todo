"""RRULE-subset parser and next-occurrence calculation.

Supported grammar (contract §3.3):
    FREQ=DAILY|WEEKLY|MONTHLY|YEARLY [;INTERVAL=n] [;BYDAY=MO,TU,WE,TH,FR,SA,SU]
BYDAY is only valid with FREQ=WEEKLY. Week starts Monday (WKST=MO).
"""

from __future__ import annotations

import calendar
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta

_WEEKDAYS = {"MO": 0, "TU": 1, "WE": 2, "TH": 3, "FR": 4, "SA": 5, "SU": 6}
_FREQS = {"DAILY", "WEEKLY", "MONTHLY", "YEARLY"}


@dataclass
class Recurrence:
    freq: str
    interval: int = 1
    byday: list[int] = field(default_factory=list)


def parse_recurrence(rrule: str) -> Recurrence:
    """Parse and validate an RRULE-subset string. Raises ValueError on any problem."""
    if not rrule or not isinstance(rrule, str):
        raise ValueError("empty recurrence")

    parts: dict[str, str] = {}
    for chunk in rrule.strip().split(";"):
        if not chunk:
            continue
        if "=" not in chunk:
            raise ValueError(f"malformed component: {chunk!r}")
        key, _, value = chunk.partition("=")
        parts[key.strip().upper()] = value.strip().upper()

    freq = parts.get("FREQ")
    if freq not in _FREQS:
        raise ValueError(f"invalid FREQ: {freq!r}")

    interval = 1
    if "INTERVAL" in parts:
        try:
            interval = int(parts["INTERVAL"])
        except ValueError as exc:
            raise ValueError("INTERVAL must be an integer") from exc
        if interval < 1:
            raise ValueError("INTERVAL must be >= 1")

    byday: list[int] = []
    if "BYDAY" in parts:
        if freq != "WEEKLY":
            raise ValueError("BYDAY is only valid with FREQ=WEEKLY")
        for code in parts["BYDAY"].split(","):
            code = code.strip()
            if code not in _WEEKDAYS:
                raise ValueError(f"invalid BYDAY code: {code!r}")
            byday.append(_WEEKDAYS[code])
        byday = sorted(set(byday))

    unknown = set(parts) - {"FREQ", "INTERVAL", "BYDAY"}
    if unknown:
        raise ValueError(f"unsupported components: {sorted(unknown)}")

    return Recurrence(freq=freq, interval=interval, byday=byday)


def _add_months(d: date, months: int) -> date:
    total = d.month - 1 + months
    year = d.year + total // 12
    month = total % 12 + 1
    last_day = calendar.monthrange(year, month)[1]
    return date(year, month, min(d.day, last_day))


def _add_years(d: date, years: int) -> date:
    year = d.year + years
    last_day = calendar.monthrange(year, d.month)[1]
    return date(year, d.month, min(d.day, last_day))


def _nth(anchor: date, rec: Recurrence, k: int) -> date:
    """The k-th member of the series, always measured from `anchor`.

    Measuring from the anchor (rather than from the previous occurrence) is what
    keeps month-end rules stable: Jan 31 → Feb 28 → Mar 31, not Mar 28.
    """
    if rec.freq == "DAILY":
        return anchor + timedelta(days=rec.interval * k)
    if rec.freq == "WEEKLY":
        return anchor + timedelta(weeks=rec.interval * k)
    if rec.freq == "MONTHLY":
        return _add_months(anchor, rec.interval * k)
    if rec.freq == "YEARLY":
        return _add_years(anchor, rec.interval * k)
    raise ValueError(f"unhandled FREQ: {rec.freq}")  # pragma: no cover


def _start_k(anchor: date, rec: Recurrence, after: date) -> int:
    """A lower bound for the answer's index — never overshoots it."""
    if after <= anchor:
        return 0
    if rec.freq == "DAILY":
        return max(0, (after - anchor).days // rec.interval)
    if rec.freq == "WEEKLY":
        return max(0, (after - anchor).days // (7 * rec.interval))
    if rec.freq == "MONTHLY":
        months = (after.year - anchor.year) * 12 + (after.month - anchor.month)
        return max(0, months // rec.interval)
    return max(0, (after.year - anchor.year) // rec.interval)


_SCAN_LIMIT = 64


def next_occurrence(rrule: str, anchor: date, after: date | None = None) -> date:
    """The next occurrence of the series anchored at `anchor`, strictly after `after`.

    The series is `anchor, anchor+interval, anchor+2·interval, …` — for
    `FREQ=WEEKLY` with `BYDAY`, the BYDAY days of every `interval`-th week
    starting from the anchor's own week.

    Deriving everything from `after` instead (the pre-v1.2.1 behaviour) lost the
    rule's phase: every `INTERVAL > 1` rule then disagreed with the clients, and
    MONTHLY/YEARLY lost the original day-of-month. `after` defaults to `anchor`.
    Mirrored byte-for-byte by `packages/sync-client/src/recurrence.ts`.
    """
    rec = parse_recurrence(rrule)
    if after is None:
        after = anchor

    if rec.freq == "WEEKLY" and rec.byday:
        monday = anchor - timedelta(days=anchor.weekday())
        span = (after - monday).days
        first = max(0, span // (7 * rec.interval)) if span > 0 else 0
        for k in range(first, first + _SCAN_LIMIT):
            week = monday + timedelta(weeks=rec.interval * k)
            for weekday in rec.byday:  # sorted by parse_recurrence
                candidate = week + timedelta(days=weekday)
                if candidate > after:
                    return candidate
        raise ValueError("could not find the next occurrence")  # pragma: no cover

    first = _start_k(anchor, rec, after)
    for k in range(first, first + _SCAN_LIMIT):
        candidate = _nth(anchor, rec, k)
        if candidate > after:
            return candidate
    raise ValueError("could not find the next occurrence")  # pragma: no cover


# The device's UTC offset in minutes east of UTC, as `task_complete` carries it. Clamped to
# the real span of world timezones; anything else falls back to UTC (0).
MIN_UTC_OFFSET = -12 * 60
MAX_UTC_OFFSET = 14 * 60


def utc_offset_minutes(value: object) -> int:
    """`args.utc_offset` -> minutes, or 0 when absent, not an integer, or out of range.

    Mirrored by `utcOffsetMinutes` in `packages/sync-client/src/recurrence.ts`.
    """
    if isinstance(value, bool) or not isinstance(value, int):
        return 0
    if not MIN_UTC_OFFSET <= value <= MAX_UTC_OFFSET:
        return 0
    return value


@dataclass(frozen=True)
class Rolled:
    start_date: date | None
    deadline: date | None
    reminder_at: datetime | None


def roll_forward(
    rrule: str,
    start_date: date | None,
    deadline: date | None,
    reminder_at: datetime | None,
    today: date,
    utc_offset: int = 0,
) -> Rolled:
    """Advance a recurring task on completion (contract §3.3).

    `start_date` (or, without one, `deadline`) moves to its next anchored occurrence and the
    other dates move by the same number of days. Without either date the series is anchored
    on `today` and the reminder moves from its own local day to the new start date. The
    reminder only ever moves forward, by whole days of the UTC instant. Mirrored step for
    step by `rollForward` in `packages/sync-client/src/recurrence.ts`.
    """
    shift = 0
    if start_date is not None:
        new_start = next_occurrence(rrule, start_date, max(start_date, today))
        shift = (new_start - start_date).days
        start_date = new_start
        if deadline is not None:
            deadline = deadline + timedelta(days=shift)
    elif deadline is not None:
        new_deadline = next_occurrence(rrule, deadline, max(deadline, today))
        shift = (new_deadline - deadline).days
        deadline = new_deadline
    else:
        start_date = next_occurrence(rrule, today, today)
        if reminder_at is not None:
            local_day = (reminder_at.astimezone(UTC) + timedelta(minutes=utc_offset)).date()
            shift = (start_date - local_day).days
    if reminder_at is not None and shift > 0:
        reminder_at = reminder_at + timedelta(days=shift)
    return Rolled(start_date, deadline, reminder_at)
