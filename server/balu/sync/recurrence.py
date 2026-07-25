"""RRULE-subset parser and next-occurrence calculation.

Supported grammar (contract §3.3):
    FREQ=DAILY|WEEKLY|MONTHLY|YEARLY [;INTERVAL=n] [;BYDAY=MO,TU,WE,TH,FR,SA,SU]
BYDAY is only valid with FREQ=WEEKLY. Week starts Monday (WKST=MO).
"""

from __future__ import annotations

import calendar
from dataclasses import dataclass, field
from datetime import date, timedelta

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
