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


def next_occurrence(rrule: str, after: date) -> date:
    """Return the next occurrence strictly after `after`."""
    rec = parse_recurrence(rrule)

    if rec.freq == "DAILY":
        return after + timedelta(days=rec.interval)

    if rec.freq == "WEEKLY":
        if not rec.byday:
            return after + timedelta(days=7 * rec.interval)
        monday = after - timedelta(days=after.weekday())
        # Candidates in the same (anchor) week, strictly after `after`.
        for wd in rec.byday:
            cand = monday + timedelta(days=wd)
            if cand > after:
                return cand
        # Jump `interval` weeks and take the earliest BYDAY of that week.
        next_monday = monday + timedelta(weeks=rec.interval)
        return next_monday + timedelta(days=rec.byday[0])

    if rec.freq == "MONTHLY":
        return _add_months(after, rec.interval)

    if rec.freq == "YEARLY":
        return _add_years(after, rec.interval)

    raise ValueError(f"unhandled FREQ: {rec.freq}")  # pragma: no cover
