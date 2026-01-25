"""
Kometa Schedule Parser

Parses and evaluates Kometa schedule syntax to determine if a collection
would be active at a given point in time.

Supported schedule formats:
- daily                         # Every day
- weekly(day)                   # Specific day(s): weekly(monday), weekly(monday|friday)
- monthly(day_num)              # Day of month: monthly(1), monthly(15)
- yearly(mm/dd)                 # Specific date: yearly(12/25)
- range(mm/dd-mm/dd)            # Date range: range(12/01-12/31), range(12/01-01/05)
- all[schedule1, schedule2]     # ALL must match (AND logic)
- any[schedule1, schedule2]     # ANY can match (OR logic) - this is default for lists
- never                         # Never active
- (no schedule)                 # Always active

Note: visible_home, visible_shared, visible_library can also use schedule syntax
instead of simple boolean values (e.g., visible_home: range(12/01-12/31))
"""

import re
import logging
from datetime import datetime, date, timedelta
from dataclasses import dataclass
from typing import Optional
from enum import Enum

logger = logging.getLogger(__name__)


class ScheduleType(str, Enum):
    DAILY = "daily"
    WEEKLY = "weekly"
    MONTHLY = "monthly"
    YEARLY = "yearly"
    RANGE = "range"
    ALL = "all"
    ANY = "any"
    NEVER = "never"
    ALWAYS = "always"  # No schedule defined = always active


@dataclass
class ParsedSchedule:
    """A parsed schedule component."""
    schedule_type: ScheduleType
    raw: str
    # For weekly: list of day names ["monday", "friday"]
    days: list[str] | None = None
    # For monthly: day of month (1-31)
    day_of_month: int | None = None
    # For yearly: (month, day) tuple
    yearly_date: tuple[int, int] | None = None
    # For range: (start_month, start_day, end_month, end_day)
    range_dates: tuple[int, int, int, int] | None = None
    # For all/any: list of sub-schedules
    sub_schedules: list["ParsedSchedule"] | None = None


@dataclass
class ScheduleEvaluation:
    """Result of evaluating a schedule at a specific time."""
    collection_name: str
    is_active: bool
    schedule_raw: str | None
    schedule_type: ScheduleType
    # When the status will change (if calculable)
    next_change: date | None = None
    next_change_type: str | None = None  # "becomes_active" or "becomes_inactive"
    # Human-readable explanation
    explanation: str = ""


@dataclass
class ScheduleConflict:
    """A conflict between a layout block and Kometa schedule."""
    collection_name: str
    collection_id: str
    conflict_type: str  # "deleted_during_block", "not_created_yet", "partial_coverage"
    block_name: str
    block_start: datetime
    block_end: datetime
    kometa_schedule_raw: str
    # When the conflict occurs
    conflict_start: date | None = None
    conflict_end: date | None = None
    message: str = ""
    # Suggested fix
    suggested_schedule: str | None = None


# Day name mappings
DAY_NAMES = {
    "monday": 0, "mon": 0,
    "tuesday": 1, "tue": 1,
    "wednesday": 2, "wed": 2,
    "thursday": 3, "thu": 3,
    "friday": 4, "fri": 4,
    "saturday": 5, "sat": 5,
    "sunday": 6, "sun": 6,
}


class KometaScheduleParser:
    """Parses and evaluates Kometa schedule strings."""

    # Regex patterns for schedule components
    WEEKLY_PATTERN = re.compile(r"weekly\(([^)]+)\)", re.IGNORECASE)
    MONTHLY_PATTERN = re.compile(r"monthly\((\d+)\)", re.IGNORECASE)
    YEARLY_PATTERN = re.compile(r"yearly\((\d{1,2})/(\d{1,2})\)", re.IGNORECASE)
    RANGE_PATTERN = re.compile(r"range\((\d{1,2})/(\d{1,2})-(\d{1,2})/(\d{1,2})\)", re.IGNORECASE)
    ALL_PATTERN = re.compile(r"all\[([^\]]+)\]", re.IGNORECASE)
    ANY_PATTERN = re.compile(r"any\[([^\]]+)\]", re.IGNORECASE)

    def parse(self, schedule: str | list | None) -> ParsedSchedule:
        """
        Parse a Kometa schedule into a structured format.

        Args:
            schedule: Schedule string, list of schedules, or None

        Returns:
            ParsedSchedule object
        """
        # No schedule = always active
        if schedule is None:
            return ParsedSchedule(
                schedule_type=ScheduleType.ALWAYS,
                raw="(always)"
            )

        # List of schedules = ANY logic (OR)
        if isinstance(schedule, list):
            sub_schedules = [self.parse(s) for s in schedule]
            return ParsedSchedule(
                schedule_type=ScheduleType.ANY,
                raw=str(schedule),
                sub_schedules=sub_schedules
            )

        schedule = str(schedule).strip().lower()

        # Simple keywords
        if schedule == "daily":
            return ParsedSchedule(schedule_type=ScheduleType.DAILY, raw=schedule)

        if schedule == "never":
            return ParsedSchedule(schedule_type=ScheduleType.NEVER, raw=schedule)

        # Weekly: weekly(monday) or weekly(monday|friday)
        weekly_match = self.WEEKLY_PATTERN.match(schedule)
        if weekly_match:
            days_str = weekly_match.group(1)
            days = [d.strip() for d in days_str.split("|")]
            return ParsedSchedule(
                schedule_type=ScheduleType.WEEKLY,
                raw=schedule,
                days=days
            )

        # Monthly: monthly(15)
        monthly_match = self.MONTHLY_PATTERN.match(schedule)
        if monthly_match:
            day = int(monthly_match.group(1))
            return ParsedSchedule(
                schedule_type=ScheduleType.MONTHLY,
                raw=schedule,
                day_of_month=day
            )

        # Yearly: yearly(12/25)
        yearly_match = self.YEARLY_PATTERN.match(schedule)
        if yearly_match:
            month = int(yearly_match.group(1))
            day = int(yearly_match.group(2))
            return ParsedSchedule(
                schedule_type=ScheduleType.YEARLY,
                raw=schedule,
                yearly_date=(month, day)
            )

        # Range: range(12/01-12/31) or range(12/01-01/05)
        range_match = self.RANGE_PATTERN.match(schedule)
        if range_match:
            start_month = int(range_match.group(1))
            start_day = int(range_match.group(2))
            end_month = int(range_match.group(3))
            end_day = int(range_match.group(4))
            return ParsedSchedule(
                schedule_type=ScheduleType.RANGE,
                raw=schedule,
                range_dates=(start_month, start_day, end_month, end_day)
            )

        # All: all[weekly(sunday), range(06/01-07/01)]
        all_match = self.ALL_PATTERN.match(schedule)
        if all_match:
            inner = all_match.group(1)
            sub_schedules = self._parse_compound_inner(inner)
            return ParsedSchedule(
                schedule_type=ScheduleType.ALL,
                raw=schedule,
                sub_schedules=sub_schedules
            )

        # Any: any[schedule1, schedule2]
        any_match = self.ANY_PATTERN.match(schedule)
        if any_match:
            inner = any_match.group(1)
            sub_schedules = self._parse_compound_inner(inner)
            return ParsedSchedule(
                schedule_type=ScheduleType.ANY,
                raw=schedule,
                sub_schedules=sub_schedules
            )

        # Unknown format - log warning and treat as always
        logger.warning(f"Unknown schedule format: {schedule}, treating as always active")
        return ParsedSchedule(
            schedule_type=ScheduleType.ALWAYS,
            raw=schedule
        )

    def _parse_compound_inner(self, inner: str) -> list[ParsedSchedule]:
        """Parse the inner content of all[] or any[] blocks."""
        # Split by comma, but be careful of nested brackets
        parts = []
        current = ""
        depth = 0

        for char in inner:
            if char == "[":
                depth += 1
                current += char
            elif char == "]":
                depth -= 1
                current += char
            elif char == "," and depth == 0:
                parts.append(current.strip())
                current = ""
            else:
                current += char

        if current.strip():
            parts.append(current.strip())

        return [self.parse(p) for p in parts]

    def is_active(self, schedule: str | list | None, at: datetime) -> bool:
        """
        Check if a schedule is active at a given datetime.

        Args:
            schedule: Raw schedule string/list from Kometa YAML
            at: Datetime to check

        Returns:
            True if the schedule is active at the given time
        """
        parsed = self.parse(schedule)
        return self._evaluate_parsed(parsed, at)

    def _evaluate_parsed(self, parsed: ParsedSchedule, at: datetime) -> bool:
        """Evaluate a parsed schedule at a given datetime."""

        if parsed.schedule_type == ScheduleType.ALWAYS:
            return True

        if parsed.schedule_type == ScheduleType.NEVER:
            return False

        if parsed.schedule_type == ScheduleType.DAILY:
            return True  # Daily is always active (runs every day)

        if parsed.schedule_type == ScheduleType.WEEKLY:
            current_day = at.strftime("%A").lower()
            return any(
                DAY_NAMES.get(day, -1) == DAY_NAMES.get(current_day, -2)
                for day in (parsed.days or [])
            )

        if parsed.schedule_type == ScheduleType.MONTHLY:
            return at.day == parsed.day_of_month

        if parsed.schedule_type == ScheduleType.YEARLY:
            if parsed.yearly_date:
                return at.month == parsed.yearly_date[0] and at.day == parsed.yearly_date[1]
            return False

        if parsed.schedule_type == ScheduleType.RANGE:
            return self._is_in_range(parsed.range_dates, at)

        if parsed.schedule_type == ScheduleType.ALL:
            # All sub-schedules must be active
            return all(
                self._evaluate_parsed(sub, at)
                for sub in (parsed.sub_schedules or [])
            )

        if parsed.schedule_type == ScheduleType.ANY:
            # Any sub-schedule can be active
            return any(
                self._evaluate_parsed(sub, at)
                for sub in (parsed.sub_schedules or [])
            )

        return True  # Default to active for unknown types

    def _is_in_range(self, range_dates: tuple[int, int, int, int] | None, at: datetime) -> bool:
        """Check if datetime is within a date range (handles year wraparound)."""
        if not range_dates:
            return False

        start_month, start_day, end_month, end_day = range_dates

        # Create comparison dates using just month/day
        check_mmdd = (at.month, at.day)
        start_mmdd = (start_month, start_day)
        end_mmdd = (end_month, end_day)

        # Normal range (e.g., 06/01-08/31)
        if start_mmdd <= end_mmdd:
            return start_mmdd <= check_mmdd <= end_mmdd

        # Wraparound range (e.g., 12/01-01/05)
        # Active if: after start OR before end
        return check_mmdd >= start_mmdd or check_mmdd <= end_mmdd

    def get_range_boundaries(
        self,
        schedule: str | list | None,
        reference_date: datetime
    ) -> tuple[date | None, date | None]:
        """
        Get the start and end dates of a range schedule for the current/next occurrence.

        Returns (start_date, end_date) or (None, None) if not a range schedule.
        """
        parsed = self.parse(schedule)

        if parsed.schedule_type == ScheduleType.RANGE and parsed.range_dates:
            start_month, start_day, end_month, end_day = parsed.range_dates
            year = reference_date.year

            # Determine which year's occurrence we're in/near
            start_date = date(year, start_month, start_day)

            # Handle wraparound (e.g., Dec 1 - Jan 5)
            if end_month < start_month or (end_month == start_month and end_day < start_day):
                # Range wraps around year boundary
                if reference_date.month >= start_month:
                    # We're in the start year, end is next year
                    end_date = date(year + 1, end_month, end_day)
                else:
                    # We're in the end year, start was last year
                    start_date = date(year - 1, start_month, start_day)
                    end_date = date(year, end_month, end_day)
            else:
                end_date = date(year, end_month, end_day)

            return start_date, end_date

        # For ANY schedules, find range sub-schedules
        if parsed.schedule_type == ScheduleType.ANY and parsed.sub_schedules:
            for sub in parsed.sub_schedules:
                if sub.schedule_type == ScheduleType.RANGE:
                    return self.get_range_boundaries(sub.raw, reference_date)

        return None, None

    def evaluate(
        self,
        collection_name: str,
        schedule: str | list | None,
        at: datetime
    ) -> ScheduleEvaluation:
        """
        Fully evaluate a schedule and return detailed information.

        Args:
            collection_name: Name of the collection (for reporting)
            schedule: Raw schedule string/list
            at: Datetime to evaluate at

        Returns:
            ScheduleEvaluation with full details
        """
        parsed = self.parse(schedule)
        is_active = self._evaluate_parsed(parsed, at)

        # Calculate next change date for range schedules
        next_change = None
        next_change_type = None

        if parsed.schedule_type == ScheduleType.RANGE and parsed.range_dates:
            start_date, end_date = self.get_range_boundaries(schedule, at)
            if start_date and end_date:
                if is_active:
                    # Currently active, will become inactive after end_date
                    next_change = end_date + timedelta(days=1)
                    next_change_type = "becomes_inactive"
                else:
                    # Currently inactive
                    if at.date() < start_date:
                        next_change = start_date
                        next_change_type = "becomes_active"
                    else:
                        # Past this year's range, calculate next year
                        next_change = date(start_date.year + 1, start_date.month, start_date.day)
                        next_change_type = "becomes_active"

        # Build explanation
        explanation = self._build_explanation(parsed, is_active, at)

        return ScheduleEvaluation(
            collection_name=collection_name,
            is_active=is_active,
            schedule_raw=parsed.raw if parsed.raw != "(always)" else None,
            schedule_type=parsed.schedule_type,
            next_change=next_change,
            next_change_type=next_change_type,
            explanation=explanation
        )

    def _build_explanation(self, parsed: ParsedSchedule, is_active: bool, at: datetime) -> str:
        """Build a human-readable explanation of the schedule status."""
        status = "active" if is_active else "inactive"

        if parsed.schedule_type == ScheduleType.ALWAYS:
            return "No schedule defined - always active"

        if parsed.schedule_type == ScheduleType.NEVER:
            return "Schedule set to 'never' - always inactive"

        if parsed.schedule_type == ScheduleType.DAILY:
            return "Runs daily - always active"

        if parsed.schedule_type == ScheduleType.WEEKLY:
            days = ", ".join(d.title() for d in (parsed.days or []))
            return f"Runs on {days} - currently {status}"

        if parsed.schedule_type == ScheduleType.MONTHLY:
            return f"Runs on day {parsed.day_of_month} of each month - currently {status}"

        if parsed.schedule_type == ScheduleType.YEARLY:
            if parsed.yearly_date:
                return f"Runs on {parsed.yearly_date[0]}/{parsed.yearly_date[1]:02d} each year - currently {status}"
            return f"Yearly schedule - currently {status}"

        if parsed.schedule_type == ScheduleType.RANGE:
            if parsed.range_dates:
                sm, sd, em, ed = parsed.range_dates
                return f"Active from {sm}/{sd:02d} to {em}/{ed:02d} - currently {status}"
            return f"Date range schedule - currently {status}"

        if parsed.schedule_type in (ScheduleType.ALL, ScheduleType.ANY):
            logic = "all" if parsed.schedule_type == ScheduleType.ALL else "any"
            return f"Compound schedule ({logic} of {len(parsed.sub_schedules or [])} conditions) - currently {status}"

        return f"Schedule: {parsed.raw} - currently {status}"


class ConflictDetector:
    """Detects conflicts between layout blocks and Kometa schedules."""

    def __init__(self, delete_not_scheduled: bool = True):
        """
        Initialize conflict detector.

        Args:
            delete_not_scheduled: Whether Kometa's delete_not_scheduled is enabled.
                                 If True, collections are deleted when outside schedule.
        """
        self.parser = KometaScheduleParser()
        self.delete_not_scheduled = delete_not_scheduled

    def find_conflicts(
        self,
        block_name: str,
        block_start: datetime,
        block_end: datetime,
        collections: list[dict]  # List of {id, name, schedule, ...}
    ) -> list[ScheduleConflict]:
        """
        Find conflicts between a layout block and its collections' Kometa schedules.

        Args:
            block_name: Name of the layout block
            block_start: Block start datetime
            block_end: Block end datetime
            collections: List of collection dicts with 'id', 'name', 'schedule' keys

        Returns:
            List of ScheduleConflict objects
        """
        conflicts = []

        for coll in collections:
            conflict = self._check_collection_conflict(
                coll, block_name, block_start, block_end
            )
            if conflict:
                conflicts.append(conflict)

        return conflicts

    def _check_collection_conflict(
        self,
        collection: dict,
        block_name: str,
        block_start: datetime,
        block_end: datetime
    ) -> ScheduleConflict | None:
        """Check if a single collection conflicts with the block."""
        schedule = collection.get("schedule")
        name = collection.get("name", "Unknown")
        coll_id = collection.get("id", "")

        # No schedule = always active, no conflict possible
        if schedule is None:
            return None

        parsed = self.parser.parse(schedule)

        # NEVER schedule - collection will never exist
        if parsed.schedule_type == ScheduleType.NEVER:
            return ScheduleConflict(
                collection_name=name,
                collection_id=coll_id,
                conflict_type="never_created",
                block_name=block_name,
                block_start=block_start,
                block_end=block_end,
                kometa_schedule_raw=str(schedule),
                message=f"'{name}' has schedule: never - it will never be created by Kometa"
            )

        # DAILY or ALWAYS - no conflict possible
        if parsed.schedule_type in (ScheduleType.DAILY, ScheduleType.ALWAYS):
            return None

        # For RANGE schedules, check if block extends beyond range
        if parsed.schedule_type == ScheduleType.RANGE:
            return self._check_range_conflict(
                collection, parsed, block_name, block_start, block_end
            )

        # For ANY schedules containing RANGE, check those
        if parsed.schedule_type == ScheduleType.ANY and parsed.sub_schedules:
            for sub in parsed.sub_schedules:
                if sub.schedule_type == ScheduleType.RANGE:
                    conflict = self._check_range_conflict(
                        collection, sub, block_name, block_start, block_end
                    )
                    if conflict:
                        return conflict

        # WEEKLY/MONTHLY - these run on specific days but don't delete
        # Only a concern if delete_not_scheduled is true, but typically
        # these just control when Kometa updates, not when collection exists

        return None

    def _check_range_conflict(
        self,
        collection: dict,
        parsed: ParsedSchedule,
        block_name: str,
        block_start: datetime,
        block_end: datetime
    ) -> ScheduleConflict | None:
        """Check for conflicts with a range schedule."""
        if not parsed.range_dates:
            return None

        name = collection.get("name", "Unknown")
        coll_id = collection.get("id", "")

        # Get the range boundaries for the block's time period
        range_start, range_end = self.parser.get_range_boundaries(
            parsed.raw, block_start
        )

        if not range_start or not range_end:
            return None

        block_start_date = block_start.date()
        block_end_date = block_end.date()

        # Check various conflict scenarios

        # Scenario 1: Block starts before collection is active
        if block_start_date < range_start:
            return ScheduleConflict(
                collection_name=name,
                collection_id=coll_id,
                conflict_type="not_yet_created",
                block_name=block_name,
                block_start=block_start,
                block_end=block_end,
                kometa_schedule_raw=parsed.raw,
                conflict_start=block_start_date,
                conflict_end=range_start - timedelta(days=1),
                message=f"'{name}' won't exist until {range_start} but block starts {block_start_date}",
                suggested_schedule=self._suggest_extended_range(
                    parsed.range_dates, block_start_date, block_end_date
                )
            )

        # Scenario 2: Block ends after collection is deleted
        if self.delete_not_scheduled and block_end_date > range_end:
            return ScheduleConflict(
                collection_name=name,
                collection_id=coll_id,
                conflict_type="deleted_during_block",
                block_name=block_name,
                block_start=block_start,
                block_end=block_end,
                kometa_schedule_raw=parsed.raw,
                conflict_start=range_end + timedelta(days=1),
                conflict_end=block_end_date,
                message=f"'{name}' will be deleted after {range_end} but block runs until {block_end_date}",
                suggested_schedule=self._suggest_extended_range(
                    parsed.range_dates, block_start_date, block_end_date
                )
            )

        return None

    def _suggest_extended_range(
        self,
        current_range: tuple[int, int, int, int],
        block_start: date,
        block_end: date
    ) -> str:
        """Suggest an extended range schedule that covers the block."""
        start_month, start_day, end_month, end_day = current_range

        # Use earliest of current start and block start
        new_start_month = min(start_month, block_start.month)
        new_start_day = start_day if new_start_month == start_month else block_start.day
        if block_start.month < start_month or (block_start.month == start_month and block_start.day < start_day):
            new_start_month = block_start.month
            new_start_day = block_start.day

        # Use latest of current end and block end
        new_end_month = block_end.month
        new_end_day = block_end.day

        return f"range({new_start_month:02d}/{new_start_day:02d}-{new_end_month:02d}/{new_end_day:02d})"


# Convenience functions for direct use
_parser = KometaScheduleParser()

def is_schedule_active(schedule: str | list | None, at: datetime = None) -> bool:
    """Check if a Kometa schedule is active at the given time (default: now)."""
    if at is None:
        at = datetime.now()
    return _parser.is_active(schedule, at)

def evaluate_schedule(
    collection_name: str,
    schedule: str | list | None,
    at: datetime = None
) -> ScheduleEvaluation:
    """Evaluate a schedule and return detailed information."""
    if at is None:
        at = datetime.now()
    return _parser.evaluate(collection_name, schedule, at)

def find_block_conflicts(
    block_name: str,
    block_start: datetime,
    block_end: datetime,
    collections: list[dict],
    delete_not_scheduled: bool = True
) -> list[ScheduleConflict]:
    """Find conflicts between a layout block and Kometa schedules."""
    detector = ConflictDetector(delete_not_scheduled)
    return detector.find_conflicts(block_name, block_start, block_end, collections)


# Also parse visibility schedules (visible_home, visible_shared can have schedule values)
def parse_visibility_schedule(value: bool | str | None) -> tuple[bool, str | None]:
    """
    Parse a visibility value which can be:
    - True/False (simple boolean)
    - A schedule string like "range(12/01-12/31)"
    - None (defaults to False)

    Returns (is_scheduled, schedule_string):
    - (True, None) = always visible
    - (False, None) = never visible
    - (True, "range(...)") = visible according to schedule
    """
    if value is None:
        return (False, None)
    if isinstance(value, bool):
        return (value, None)
    if isinstance(value, str):
        # It's a schedule string
        return (True, value)
    return (False, None)


def is_visibility_active(value: bool | str | None, at: datetime = None) -> bool:
    """
    Check if a visibility setting is active at the given time.

    Handles both boolean values and schedule strings.
    """
    if at is None:
        at = datetime.now()

    is_scheduled, schedule = parse_visibility_schedule(value)

    if schedule is None:
        return is_scheduled

    # It's a schedule string, evaluate it
    return is_schedule_active(schedule, at)


# Test function to verify parser works with real Kometa patterns
if __name__ == "__main__":
    from datetime import datetime

    print("=" * 60)
    print("Kometa Schedule Parser Test")
    print("=" * 60)

    parser = KometaScheduleParser()

    # Test cases from actual Kometa configs
    test_cases = [
        # (schedule, test_date, expected_active, description)
        ("daily", datetime(2025, 6, 15, 12, 0), True, "Daily - always active"),
        ("never", datetime(2025, 6, 15, 12, 0), False, "Never - always inactive"),
        (None, datetime(2025, 6, 15, 12, 0), True, "No schedule - always active"),

        # Weekly
        ("weekly(monday)", datetime(2025, 1, 27, 12, 0), True, "Weekly Monday on a Monday"),
        ("weekly(monday)", datetime(2025, 1, 28, 12, 0), False, "Weekly Monday on a Tuesday"),
        ("weekly(monday|friday)", datetime(2025, 1, 31, 12, 0), True, "Weekly Mon|Fri on Friday"),
        ("weekly(sunday)", datetime(2025, 1, 26, 12, 0), True, "Weekly Sunday on a Sunday"),

        # Monthly
        ("monthly(1)", datetime(2025, 6, 1, 12, 0), True, "Monthly 1st on the 1st"),
        ("monthly(1)", datetime(2025, 6, 15, 12, 0), False, "Monthly 1st on the 15th"),
        ("monthly(15)", datetime(2025, 6, 15, 12, 0), True, "Monthly 15th on the 15th"),

        # Yearly
        ("yearly(12/25)", datetime(2025, 12, 25, 12, 0), True, "Yearly 12/25 on Christmas"),
        ("yearly(12/25)", datetime(2025, 6, 15, 12, 0), False, "Yearly 12/25 in June"),
        ("yearly(03/01)", datetime(2025, 3, 1, 12, 0), True, "Yearly 3/1 on March 1"),

        # Range (normal)
        ("range(10/01-10/31)", datetime(2025, 10, 15, 12, 0), True, "Halloween range in October"),
        ("range(10/01-10/31)", datetime(2025, 11, 1, 12, 0), False, "Halloween range in November"),
        ("range(06/01-08/31)", datetime(2025, 7, 4, 12, 0), True, "Summer range in July"),

        # Range (year wraparound)
        ("range(11/20-01/06)", datetime(2025, 12, 25, 12, 0), True, "Christmas range on Dec 25"),
        ("range(11/20-01/06)", datetime(2025, 1, 5, 12, 0), True, "Christmas range on Jan 5"),
        ("range(11/20-01/06)", datetime(2025, 1, 7, 12, 0), False, "Christmas range on Jan 7"),
        ("range(11/20-01/06)", datetime(2025, 6, 15, 12, 0), False, "Christmas range in June"),
        ("range(12/01-01/05)", datetime(2025, 12, 15, 12, 0), True, "Dec-Jan range in Dec"),
        ("range(12/01-01/05)", datetime(2025, 1, 3, 12, 0), True, "Dec-Jan range in early Jan"),

        # Compound: ALL (AND logic)
        ("all[weekly(sunday), range(06/01-07/01)]", datetime(2025, 6, 15, 12, 0), True,
         "All[weekly(sun), range(6/1-7/1)] on a Sunday in June"),
        ("all[weekly(sunday), range(06/01-07/01)]", datetime(2025, 6, 16, 12, 0), False,
         "All[weekly(sun), range(6/1-7/1)] on Monday in June"),
        ("all[weekly(sunday), range(06/01-07/01)]", datetime(2025, 8, 3, 12, 0), False,
         "All[weekly(sun), range(6/1-7/1)] on Sunday in August"),

        # List of schedules (ANY/OR logic)
        (["weekly(sunday)", "range(12/01-12/31)"], datetime(2025, 12, 15, 12, 0), True,
         "List [weekly(sun), range(12)] in Dec (range matches)"),
        (["weekly(sunday)", "range(12/01-12/31)"], datetime(2025, 6, 15, 12, 0), True,
         "List [weekly(sun), range(12)] on Sunday in June"),
        (["weekly(sunday)", "range(12/01-12/31)"], datetime(2025, 6, 16, 12, 0), False,
         "List [weekly(sun), range(12)] on Monday in June"),
    ]

    passed = 0
    failed = 0

    for schedule, test_date, expected, description in test_cases:
        result = parser.is_active(schedule, test_date)
        status = "PASS" if result == expected else "FAIL"
        if result == expected:
            passed += 1
        else:
            failed += 1
        print(f"[{status}] {description}")
        if result != expected:
            print(f"       Schedule: {schedule}")
            print(f"       Date: {test_date}")
            print(f"       Expected: {expected}, Got: {result}")

    print()
    print("=" * 60)
    print(f"Results: {passed} passed, {failed} failed")
    print("=" * 60)

    # Test conflict detection
    print()
    print("=" * 60)
    print("Conflict Detection Test")
    print("=" * 60)

    detector = ConflictDetector(delete_not_scheduled=True)

    # Christmas collection scheduled Dec 1-31, but block runs Dec 1 - Jan 5
    conflicts = detector.find_conflicts(
        block_name="Holiday Season",
        block_start=datetime(2025, 12, 1, 0, 0),
        block_end=datetime(2026, 1, 5, 23, 59),
        collections=[
            {"id": "1", "name": "Christmas Movies", "schedule": "range(12/01-12/31)"},
            {"id": "2", "name": "Holiday Classics", "schedule": "range(11/15-01/10)"},  # No conflict
            {"id": "3", "name": "Always Available", "schedule": None},  # No conflict
            {"id": "4", "name": "Never Created", "schedule": "never"},
        ]
    )

    print(f"\nFound {len(conflicts)} conflict(s):")
    for conflict in conflicts:
        print(f"\n  Collection: {conflict.collection_name}")
        print(f"  Type: {conflict.conflict_type}")
        print(f"  Message: {conflict.message}")
        if conflict.suggested_schedule:
            print(f"  Suggested fix: {conflict.suggested_schedule}")

    # Test visibility schedule parsing
    print()
    print("=" * 60)
    print("Visibility Schedule Test")
    print("=" * 60)

    vis_tests = [
        (True, datetime(2025, 6, 15), True, "Boolean True"),
        (False, datetime(2025, 6, 15), False, "Boolean False"),
        (None, datetime(2025, 6, 15), False, "None"),
        ("range(12/01-12/31)", datetime(2025, 12, 15), True, "Range in December"),
        ("range(12/01-12/31)", datetime(2025, 6, 15), False, "Range in June"),
    ]

    for value, test_date, expected, description in vis_tests:
        result = is_visibility_active(value, test_date)
        status = "PASS" if result == expected else "FAIL"
        print(f"[{status}] {description}: {value} -> {result}")
