"""Data models for Plex Collection Scheduler."""
from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime, date, time
from enum import Enum


class VisibilityType(str, Enum):
    """Collection visibility settings."""
    HOME = "home"  # Visible on Home
    LIBRARY = "library"  # Visible in Library (Recommended)
    HIDDEN = "hidden"  # Not visible


class RecurrenceType(str, Enum):
    """Types of schedule recurrence."""
    NONE = "none"  # One-time window
    DAILY = "daily"
    WEEKLY = "weekly"
    MONTHLY = "monthly"
    YEARLY = "yearly"


class CollectionSource(str, Enum):
    """Where a collection is defined."""
    PLEX = "plex"  # Exists in Plex
    KOMETA = "kometa"  # Defined in Kometa config
    BOTH = "both"  # Exists in both


class ScheduleStatus(str, Enum):
    """Current status of a scheduled collection."""
    ACTIVE = "active"  # Currently visible according to schedule
    SCHEDULED = "scheduled"  # Has future schedule
    KOMETA_ONLY = "kometa_only"  # Only in Kometa, not yet in Plex
    MANUAL = "manual"  # No schedule, manual control
    CONFLICT = "conflict"  # Has scheduling conflicts


class VisibilityZone(str, Enum):
    """Zone for collection visibility within a window."""
    PINNED = "pinned"    # Pinned at top
    NORMAL = "normal"    # Normal visibility
    HIDDEN = "hidden"    # Explicitly hidden


# ================== Schedule Window Models ==================

class ScheduleWindow(BaseModel):
    """A time window during which a collection should be visible."""
    id: Optional[str] = None
    collection_id: str  # Reference to collection
    start_date: date
    end_date: date
    start_time: Optional[time] = None  # If None, all day
    end_time: Optional[time] = None
    recurrence: RecurrenceType = RecurrenceType.NONE
    recurrence_end_date: Optional[date] = None

    # Ordering within this window
    pin_priority: Optional[int] = None  # Lower = higher in list
    explicit_position: Optional[int] = None  # Exact position (0-indexed)

    # Metadata
    title: Optional[str] = None  # Human-readable label
    color: Optional[str] = None  # Calendar display color

    # Window group association
    window_group_id: Optional[str] = None  # Reference to WindowGroup
    zone: VisibilityZone = VisibilityZone.NORMAL  # Visibility zone


class WindowGroup(BaseModel):
    """A named time-range window that groups schedule entries."""
    id: Optional[str] = None
    library_section_id: str
    name: str
    start_at: datetime
    end_at: datetime
    recurrence_rule: Optional[str] = None  # iCal RRULE format
    priority: int = 50  # Lower = higher priority for overlap
    color: Optional[str] = None


class RecurringSchedule(BaseModel):
    """Recurring schedule definition for FullCalendar integration."""
    days_of_week: list[int] = Field(default_factory=list)  # 0=Sun, 6=Sat
    start_time: time
    end_time: time
    start_recur: Optional[date] = None
    end_recur: Optional[date] = None


# ================== Collection Models ==================

class ScheduledCollection(BaseModel):
    """A collection with its schedule configuration."""
    id: str  # Plex ratingKey or Kometa key
    title: str
    source: CollectionSource = CollectionSource.PLEX
    library_section_id: str

    # Current state
    current_visibility: VisibilityType = VisibilityType.HIDDEN
    current_position: Optional[int] = None

    # Base ordering (default when no window active)
    base_order_index: int = 0

    # Schedule windows
    windows: list[ScheduleWindow] = Field(default_factory=list)

    # Metadata
    thumb: Optional[str] = None
    child_count: int = 0
    smart: bool = False
    kometa_file: Optional[str] = None  # Source Kometa YAML file

    # Default visibility on home
    default_visible_on_home: bool = True


class OrderOverride(BaseModel):
    """Override ordering for a specific collection in a window."""
    collection_id: str
    pin_priority: Optional[int] = None
    explicit_position: Optional[int] = None


# ================== Snapshot Models ==================

class HiddenSnapshotItem(BaseModel):
    """A hidden item in a snapshot with reason info."""
    collection_id: str
    title: str
    hidden_by_window_id: Optional[str] = None
    hidden_by_window_group_id: Optional[str] = None


class SnapshotItem(BaseModel):
    """A single item in a home stack snapshot."""
    collection_id: str
    title: str
    position: int
    source: CollectionSource
    active_window_id: Optional[str] = None
    active_window_group_id: Optional[str] = None
    zone: VisibilityZone = VisibilityZone.NORMAL
    pin_priority: Optional[int] = None


class HomeSnapshot(BaseModel):
    """Computed state of Home at a specific time."""
    timestamp: datetime
    library_section_id: str
    visible_collections: list[SnapshotItem] = Field(default_factory=list)
    hidden_collections: list[HiddenSnapshotItem] = Field(default_factory=list)


# ================== Diff Models ==================

class VisibilityChange(BaseModel):
    """A visibility change operation."""
    collection_id: str
    title: str
    from_visibility: VisibilityType
    to_visibility: VisibilityType


class OrderChange(BaseModel):
    """An ordering change operation."""
    collection_id: str
    title: str
    from_position: Optional[int]
    to_position: int


class ScheduleDiff(BaseModel):
    """Diff between current Plex state and desired state."""
    computed_at: datetime
    target_time: datetime
    library_section_id: str

    visibility_changes: list[VisibilityChange] = Field(default_factory=list)
    order_changes: list[OrderChange] = Field(default_factory=list)

    # Summary
    total_changes: int = 0
    has_conflicts: bool = False
    conflict_messages: list[str] = Field(default_factory=list)


# ================== Apply Result Models ==================

class ApplyResult(BaseModel):
    """Result of applying changes to Plex."""
    success: bool
    timestamp: datetime
    library_section_id: str

    visibility_applied: int = 0
    visibility_failed: int = 0
    order_applied: bool = False
    order_verified: bool = False

    reorder_attempts: int = 0
    before_order: list[str] = Field(default_factory=list)
    after_order: list[str] = Field(default_factory=list)
    desired_order: list[str] = Field(default_factory=list)

    error_messages: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


# ================== Rollback Models ==================

class RollbackSnapshot(BaseModel):
    """Snapshot for manual rollback if needed."""
    id: str
    created_at: datetime
    library_section_id: str
    hub_order: list[str]
    # hub_identifier -> {own_home: bool, shared_home: bool, recommended: bool}
    hub_visibility: dict[str, dict[str, bool]]
    note: Optional[str] = None


# ================== API Response Models ==================

class LibraryResponse(BaseModel):
    """API response for library list."""
    key: str
    title: str
    type: str


class CollectionResponse(BaseModel):
    """API response for collection details."""
    id: str
    title: str
    source: CollectionSource
    library_section_id: str
    current_visibility: VisibilityType
    current_position: Optional[int]
    base_order_index: int
    status: ScheduleStatus
    windows_count: int
    next_change: Optional[datetime]
    thumb: Optional[str]
    child_count: int
    smart: bool
    kometa_file: Optional[str]


class HubOrderResponse(BaseModel):
    """API response for current hub order."""
    library_section_id: str
    hubs: list[dict]  # Full hub data
    order: list[str]  # Just the ordered identifiers
    promoted_count: int


# ================== Layout Block Models ==================

class LayoutBlockItem(BaseModel):
    """An item within a layout block representing a collection with visibility settings."""
    id: Optional[str] = None
    block_id: str
    collection_id: str  # hub_identifier from Plex
    order_index: int
    visible_home: bool = False
    visible_shared_home: bool = False
    visible_shared_friends: bool = False
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class LayoutBlock(BaseModel):
    """A scheduled home layout block for a specific time range."""
    id: Optional[str] = None
    library_section_id: str
    name: str
    start_at: datetime
    end_at: datetime
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    items: list[LayoutBlockItem] = Field(default_factory=list)


class LayoutBlockCreate(BaseModel):
    """Request model for creating a layout block."""
    name: str
    start_at: datetime
    end_at: datetime


class LayoutBlockUpdate(BaseModel):
    """Request model for updating a layout block."""
    name: Optional[str] = None
    start_at: Optional[datetime] = None
    end_at: Optional[datetime] = None


class LayoutBlockItemSave(BaseModel):
    """Request model for saving a layout block item."""
    collection_id: str  # hub_identifier from Plex
    order_index: int
    visible_home: bool = False
    visible_shared_home: bool = False
    visible_shared_friends: bool = False


# ================== Sync Settings Models ==================

class SyncResultStatus(str, Enum):
    """Status of the last sync attempt."""
    IN_SYNC = "in_sync"  # Plex already matches scheduled state
    APPLIED = "applied"  # Changes were applied successfully
    NO_ACTIVE_BLOCK = "no_active_block"  # No block active, did nothing
    ERROR = "error"  # Sync failed


class LibrarySyncSettings(BaseModel):
    """Per-library scheduler sync settings."""
    library_section_id: str
    sync_enabled: bool = False
    interval_minutes: int = 60  # Default 1 hour
    last_checked_at: Optional[datetime] = None
    last_applied_at: Optional[datetime] = None
    last_result: Optional[SyncResultStatus] = None
    last_error: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class LibrarySyncSettingsUpdate(BaseModel):
    """Request model for updating sync settings."""
    sync_enabled: Optional[bool] = None
    interval_minutes: Optional[int] = None


class ApplyIfNeededResult(BaseModel):
    """Result of apply-if-needed operation."""
    status: SyncResultStatus
    library_section_id: str
    checked_at: datetime
    active_block_id: Optional[str] = None
    active_block_name: Optional[str] = None
    changes_applied: int = 0
    visibility_changes: int = 0
    order_changes: int = 0
    error_message: Optional[str] = None
    rollback_snapshot_id: Optional[str] = None
