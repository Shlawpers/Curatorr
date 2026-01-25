"""Scheduler module for computing home stack state at any time T."""
from datetime import datetime, date, time, timedelta
from typing import Optional
from models import (
    ScheduledCollection,
    ScheduleWindow,
    HomeSnapshot,
    SnapshotItem,
    HiddenSnapshotItem,
    ScheduleDiff,
    VisibilityChange,
    OrderChange,
    VisibilityType,
    VisibilityZone,
    RecurrenceType,
    CollectionSource,
)
from plex_client import ManagedHubsState
import logging

logger = logging.getLogger(__name__)


class ScheduleEvaluator:
    """Evaluates schedules and computes home stack state at any time."""

    def __init__(self, collections: list[ScheduledCollection]):
        """
        Initialize with scheduled collections.

        Args:
            collections: List of collections with their schedule windows.
        """
        self.collections = {c.id: c for c in collections}

    def is_window_active(self, window: ScheduleWindow, at_time: datetime) -> bool:
        """
        Check if a schedule window is active at the given time.

        Handles one-time windows and recurring patterns.
        """
        check_date = at_time.date()
        check_time = at_time.time()

        # Handle recurrence
        if window.recurrence == RecurrenceType.NONE:
            # One-time window: check date range
            if not (window.start_date <= check_date <= window.end_date):
                return False
        elif window.recurrence == RecurrenceType.WEEKLY:
            # Weekly recurrence: check day of week matches
            start_dow = window.start_date.weekday()
            end_dow = window.end_date.weekday()
            check_dow = check_date.weekday()

            # Check if within recurrence bounds
            if window.recurrence_end_date and check_date > window.recurrence_end_date:
                return False
            if check_date < window.start_date:
                return False

            # Check day of week (handle week wrap)
            if start_dow <= end_dow:
                if not (start_dow <= check_dow <= end_dow):
                    return False
            else:
                # Wraps around weekend (e.g., Fri-Sun)
                if not (check_dow >= start_dow or check_dow <= end_dow):
                    return False

        elif window.recurrence == RecurrenceType.YEARLY:
            # Yearly: check month and day
            if window.recurrence_end_date and check_date > window.recurrence_end_date:
                return False
            if check_date < window.start_date:
                return False

            start_month_day = (window.start_date.month, window.start_date.day)
            end_month_day = (window.end_date.month, window.end_date.day)
            check_month_day = (check_date.month, check_date.day)

            if start_month_day <= end_month_day:
                if not (start_month_day <= check_month_day <= end_month_day):
                    return False
            else:
                # Wraps around year end
                if not (check_month_day >= start_month_day or check_month_day <= end_month_day):
                    return False

        # Check time range if specified
        if window.start_time and window.end_time:
            if window.start_time <= window.end_time:
                if not (window.start_time <= check_time <= window.end_time):
                    return False
            else:
                # Overnight window
                if not (check_time >= window.start_time or check_time <= window.end_time):
                    return False

        return True

    def get_active_windows(
        self,
        collection_id: str,
        at_time: datetime
    ) -> list[ScheduleWindow]:
        """Get all active windows for a collection at the given time."""
        collection = self.collections.get(collection_id)
        if not collection:
            return []

        return [w for w in collection.windows if self.is_window_active(w, at_time)]

    def compute_snapshot(
        self,
        library_section_id: str,
        at_time: datetime
    ) -> HomeSnapshot:
        """
        Compute the home stack state at a specific time.

        Algorithm:
        1. For each collection in the library, check if any window is active
        2. Handle zone logic:
           - HIDDEN zone: add to hidden_collections
           - PINNED zone: add to visible with pin_priority
           - NORMAL zone: add to visible with normal ordering
        3. For collections without active windows:
           - If default_visible_on_home: add to visible
           - Otherwise: add to hidden_collections
        4. Sort by: zone (PINNED first), pin_priority, explicit_position, base_order_index

        Returns:
            HomeSnapshot with ordered visible collections.
        """
        visible: list[SnapshotItem] = []
        hidden: list[HiddenSnapshotItem] = []

        for collection in self.collections.values():
            if collection.library_section_id != library_section_id:
                continue

            active_windows = self.get_active_windows(collection.id, at_time)

            if active_windows:
                # Collection has an active window
                # Use the window with lowest pin_priority or first defined
                best_window = self._get_dominant_window(active_windows)

                if best_window.zone == VisibilityZone.HIDDEN:
                    # Window explicitly hides this collection
                    hidden.append(HiddenSnapshotItem(
                        collection_id=collection.id,
                        title=collection.title,
                        hidden_by_window_id=best_window.id,
                        hidden_by_window_group_id=best_window.window_group_id,
                    ))
                else:
                    # PINNED or NORMAL zone - collection is visible
                    visible.append(SnapshotItem(
                        collection_id=collection.id,
                        title=collection.title,
                        position=0,  # Will be computed after sorting
                        source=collection.source,
                        active_window_id=best_window.id,
                        active_window_group_id=best_window.window_group_id,
                        zone=best_window.zone,
                        pin_priority=best_window.pin_priority if best_window.zone == VisibilityZone.PINNED else None,
                    ))
            else:
                # No active window - check default visibility
                if collection.default_visible_on_home:
                    # Add to visible with normal ordering (no window info)
                    visible.append(SnapshotItem(
                        collection_id=collection.id,
                        title=collection.title,
                        position=0,  # Will be computed after sorting
                        source=collection.source,
                        active_window_id=None,
                        active_window_group_id=None,
                        zone=VisibilityZone.NORMAL,
                        pin_priority=None,
                    ))
                else:
                    # Add to hidden (no window info since no active window)
                    hidden.append(HiddenSnapshotItem(
                        collection_id=collection.id,
                        title=collection.title,
                        hidden_by_window_id=None,
                        hidden_by_window_group_id=None,
                    ))

        # Sort visible collections
        sorted_visible = self._sort_collections(visible, library_section_id)

        # Assign positions
        for i, item in enumerate(sorted_visible):
            item.position = i

        return HomeSnapshot(
            timestamp=at_time,
            library_section_id=library_section_id,
            visible_collections=sorted_visible,
            hidden_collections=hidden,
        )

    def _get_dominant_window(self, windows: list[ScheduleWindow]) -> ScheduleWindow:
        """
        When multiple windows are active, determine which one takes precedence.

        Priority order:
        1. Zone priority (HIDDEN > PINNED > NORMAL)
        2. Lowest pin_priority (if set)
        3. Has explicit_position (over no position)
        4. First defined
        """
        zone_priority = {
            VisibilityZone.HIDDEN: 0,  # HIDDEN takes highest priority
            VisibilityZone.PINNED: 1,
            VisibilityZone.NORMAL: 2,
        }

        def window_key(w: ScheduleWindow):
            return (
                zone_priority.get(w.zone, 2),
                w.pin_priority if w.pin_priority is not None else 999,
                0 if w.explicit_position is not None else 1,
            )

        return min(windows, key=window_key)

    def _sort_collections(
        self,
        items: list[SnapshotItem],
        library_section_id: str
    ) -> list[SnapshotItem]:
        """
        Sort collections according to the ordering algorithm.

        Sort order:
        1. Zone (PINNED first, then NORMAL)
        2. pin_priority (lower = higher in list, for PINNED items)
        3. explicit_position (if defined)
        4. base_order_index
        """
        zone_sort_priority = {
            VisibilityZone.PINNED: 0,
            VisibilityZone.NORMAL: 1,
        }

        def sort_key(item: SnapshotItem):
            collection = self.collections.get(item.collection_id)
            active_window = None
            if collection and item.active_window_id:
                # Get the active window that gave us this pin_priority
                for w in collection.windows:
                    if w.id == item.active_window_id:
                        active_window = w
                        break

            explicit_pos = None
            if active_window and active_window.explicit_position is not None:
                explicit_pos = active_window.explicit_position

            base_idx = collection.base_order_index if collection else 999

            return (
                zone_sort_priority.get(item.zone, 1),  # PINNED first
                item.pin_priority if item.pin_priority is not None else 999,
                explicit_pos if explicit_pos is not None else 999,
                base_idx,
            )

        return sorted(items, key=sort_key)

    def compute_diff(
        self,
        current_state: ManagedHubsState,
        target_snapshot: HomeSnapshot,
    ) -> ScheduleDiff:
        """
        Compute the diff between current Plex state and target snapshot.

        This determines what visibility changes and order changes are needed.
        """
        now = datetime.now()
        diff = ScheduleDiff(
            computed_at=now,
            target_time=target_snapshot.timestamp,
            library_section_id=target_snapshot.library_section_id,
        )

        # Build current state maps
        current_promoted = set()
        current_position = {}
        for i, hub in enumerate(current_state.hubs):
            if hub.promoted:
                current_promoted.add(hub.hub_identifier)
                current_position[hub.hub_identifier] = i

        # Build target state maps
        target_visible = {item.collection_id for item in target_snapshot.visible_collections}
        target_positions = {
            item.collection_id: item.position
            for item in target_snapshot.visible_collections
        }

        # Find visibility changes
        # Note: We need to map collection IDs to hub identifiers
        # For now, assume hub_identifier contains collection ID or title
        # This may need adjustment based on actual Plex hub structure

        for collection in self.collections.values():
            if collection.library_section_id != target_snapshot.library_section_id:
                continue

            # Find corresponding hub (simplified - may need better matching)
            hub_id = self._find_hub_for_collection(collection, current_state)
            if not hub_id:
                continue

            currently_visible = hub_id in current_promoted
            should_be_visible = collection.id in target_visible

            if currently_visible != should_be_visible:
                diff.visibility_changes.append(VisibilityChange(
                    collection_id=collection.id,
                    title=collection.title,
                    from_visibility=(
                        VisibilityType.HOME if currently_visible
                        else VisibilityType.HIDDEN
                    ),
                    to_visibility=(
                        VisibilityType.HOME if should_be_visible
                        else VisibilityType.HIDDEN
                    ),
                ))

        # Find order changes
        desired_order = [item.collection_id for item in target_snapshot.visible_collections]
        current_order = current_state.hub_order  # This is hub_identifiers

        # Map to consistent IDs for comparison
        # (This is simplified - real implementation needs proper ID mapping)
        for item in target_snapshot.visible_collections:
            hub_id = self._find_hub_for_collection(
                self.collections.get(item.collection_id),
                current_state
            )
            if hub_id:
                current_pos = current_position.get(hub_id)
                target_pos = item.position

                if current_pos != target_pos:
                    diff.order_changes.append(OrderChange(
                        collection_id=item.collection_id,
                        title=item.title,
                        from_position=current_pos,
                        to_position=target_pos,
                    ))

        diff.total_changes = len(diff.visibility_changes) + len(diff.order_changes)

        # Check for conflicts
        self._detect_conflicts(diff, target_snapshot)

        return diff

    def _find_hub_for_collection(
        self,
        collection: Optional[ScheduledCollection],
        state: ManagedHubsState
    ) -> Optional[str]:
        """
        Find the hub identifier corresponding to a collection.

        Hub context for collections is typically "hub.custom.collection"
        and the hubKey contains the collection path.
        """
        if not collection:
            return None

        for hub in state.hubs:
            # Check if this hub represents our collection
            # Hub identifiers for collections often contain the collection ID
            if f"collection/{collection.id}" in hub.hub_key:
                return hub.hub_identifier
            # Also check by title as fallback
            if hub.title == collection.title and hub.context == "hub.custom.collection":
                return hub.hub_identifier

        return None

    def _detect_conflicts(
        self,
        diff: ScheduleDiff,
        snapshot: HomeSnapshot
    ) -> None:
        """Detect ordering conflicts (e.g., multiple items with same pin_priority=0)."""
        priority_counts = {}
        for item in snapshot.visible_collections:
            if item.pin_priority is not None:
                priority_counts[item.pin_priority] = (
                    priority_counts.get(item.pin_priority, 0) + 1
                )

        for priority, count in priority_counts.items():
            if count > 1:
                diff.has_conflicts = True
                diff.conflict_messages.append(
                    f"Multiple collections have pin_priority={priority}: "
                    f"order among them is undefined"
                )

    def get_next_change_time(
        self,
        library_section_id: str,
        after_time: datetime,
        limit_hours: int = 168  # 1 week default
    ) -> Optional[datetime]:
        """
        Find the next time when the home stack state will change.

        Scans forward from after_time to find the next window boundary.
        """
        # Get current state
        current_snapshot = self.compute_snapshot(library_section_id, after_time)
        current_visible = {item.collection_id for item in current_snapshot.visible_collections}

        # Scan in 15-minute increments (balance between accuracy and performance)
        check_time = after_time
        end_time = after_time + timedelta(hours=limit_hours)

        while check_time < end_time:
            check_time += timedelta(minutes=15)
            new_snapshot = self.compute_snapshot(library_section_id, check_time)
            new_visible = {item.collection_id for item in new_snapshot.visible_collections}

            if new_visible != current_visible:
                # Found a change - binary search for exact time
                return self._binary_search_change_time(
                    library_section_id,
                    check_time - timedelta(minutes=15),
                    check_time,
                    current_visible,
                )

        return None

    def _binary_search_change_time(
        self,
        library_section_id: str,
        start: datetime,
        end: datetime,
        reference_visible: set[str],
        precision_seconds: int = 60
    ) -> datetime:
        """Binary search to find exact change time within a window."""
        while (end - start).total_seconds() > precision_seconds:
            mid = start + (end - start) / 2
            snapshot = self.compute_snapshot(library_section_id, mid)
            mid_visible = {item.collection_id for item in snapshot.visible_collections}

            if mid_visible == reference_visible:
                start = mid
            else:
                end = mid

        return end

    def get_schedule_boundaries(
        self,
        library_section_id: str,
        start_time: datetime,
        end_time: datetime,
        max_boundaries: int = 50
    ) -> list[datetime]:
        """
        Get all schedule boundary times in a range.

        Returns list of times when the home stack state changes.
        """
        boundaries = []
        current_time = start_time

        while current_time < end_time and len(boundaries) < max_boundaries:
            next_change = self.get_next_change_time(
                library_section_id,
                current_time,
                limit_hours=int((end_time - current_time).total_seconds() / 3600) + 1
            )

            if next_change and next_change < end_time:
                boundaries.append(next_change)
                current_time = next_change
            else:
                break

        return boundaries
