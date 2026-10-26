"""
Time utilities for floor_day and interpolation helpers.
"""

from datetime import datetime, time, timedelta, timezone


def floor_day(dt: datetime) -> datetime:
    """Return midnight UTC of the given datetime's date."""
    return datetime(dt.year, dt.month, dt.day, tzinfo=timezone.utc)


def compute_decision_deadline(start_time: datetime, cutoff_time_str: str) -> datetime:
    """
    For a delivery startTime on day D, compute the D-1 decision deadline.

    decision_deadline = floor_day(startTime) - 1 day + cutoff_time (UTC)

    Example:
        startTime = 2026-01-06T14:00:00Z, cutoff = "11:00"
        -> 2026-01-05T11:00:00Z
    """
    delivery_day_midnight = floor_day(start_time)
    h, m = map(int, cutoff_time_str.split(":"))
    cutoff = time(h, m, tzinfo=timezone.utc)
    decision_day = delivery_day_midnight - timedelta(days=1)
    return decision_day.replace(hour=cutoff.hour, minute=cutoff.minute, second=0, microsecond=0)
