"""Database module for persisting schedules and configuration."""
import aiosqlite
import json
import os
from datetime import datetime, date, time, timezone
from typing import Optional
from pathlib import Path
import logging

from models import (
    ScheduledCollection,
    ScheduleWindow,
    RollbackSnapshot,
    VisibilityType,
    RecurrenceType,
    CollectionSource,
    WindowGroup,
    VisibilityZone,
    LayoutBlock,
    LayoutBlockItem,
    LibrarySyncSettings,
    SyncResultStatus,
    Promotion,
    PromotionItem,
)

logger = logging.getLogger(__name__)

# Use DATABASE_PATH from environment, fallback to local file for development
DATABASE_PATH = Path(os.environ.get("DATABASE_PATH", "./plex_scheduler.db"))


async def init_database():
    """Initialize database schema."""
    async with aiosqlite.connect(DATABASE_PATH) as db:
        # Collections table (base order and metadata)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS collections (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                source TEXT NOT NULL,
                library_section_id TEXT NOT NULL,
                base_order_index INTEGER DEFAULT 0,
                thumb TEXT,
                child_count INTEGER DEFAULT 0,
                smart INTEGER DEFAULT 0,
                kometa_file TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
        """)

        # Schedule windows table
        await db.execute("""
            CREATE TABLE IF NOT EXISTS schedule_windows (
                id TEXT PRIMARY KEY,
                collection_id TEXT NOT NULL,
                start_date TEXT NOT NULL,
                end_date TEXT NOT NULL,
                start_time TEXT,
                end_time TEXT,
                recurrence TEXT DEFAULT 'none',
                recurrence_end_date TEXT,
                pin_priority INTEGER,
                explicit_position INTEGER,
                title TEXT,
                color TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (collection_id) REFERENCES collections(id)
            )
        """)

        # Rollback snapshots table
        await db.execute("""
            CREATE TABLE IF NOT EXISTS rollback_snapshots (
                id TEXT PRIMARY KEY,
                library_section_id TEXT NOT NULL,
                hub_order TEXT NOT NULL,
                hub_visibility TEXT NOT NULL,
                note TEXT,
                created_at TEXT NOT NULL
            )
        """)

        # Base order table (defines default ordering per library)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS base_orders (
                library_section_id TEXT NOT NULL,
                collection_id TEXT NOT NULL,
                position INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (library_section_id, collection_id)
            )
        """)

        # Window groups table
        await db.execute("""
            CREATE TABLE IF NOT EXISTS window_groups (
                id TEXT PRIMARY KEY,
                library_section_id TEXT NOT NULL,
                name TEXT NOT NULL,
                start_at TEXT NOT NULL,
                end_at TEXT NOT NULL,
                recurrence_rule TEXT,
                priority INTEGER DEFAULT 50,
                color TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
        """)

        # Migration: add new columns to schedule_windows if they don't exist
        try:
            await db.execute("ALTER TABLE schedule_windows ADD COLUMN window_group_id TEXT")
        except:
            pass  # Column already exists
        try:
            await db.execute("ALTER TABLE schedule_windows ADD COLUMN zone TEXT DEFAULT 'normal'")
        except:
            pass  # Column already exists

        # Migration: add default_visible_on_home to collections if it doesn't exist
        try:
            await db.execute("ALTER TABLE collections ADD COLUMN default_visible_on_home INTEGER DEFAULT 1")
        except:
            pass  # Column already exists

        await db.commit()
        logger.info("Database initialized")


async def save_collection(collection: ScheduledCollection):
    """Save or update a collection."""
    now = datetime.now().isoformat()
    async with aiosqlite.connect(DATABASE_PATH) as db:
        await db.execute("""
            INSERT INTO collections
            (id, title, source, library_section_id, base_order_index,
             thumb, child_count, smart, kometa_file, default_visible_on_home,
             created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                title = excluded.title,
                source = excluded.source,
                library_section_id = excluded.library_section_id,
                base_order_index = excluded.base_order_index,
                thumb = excluded.thumb,
                child_count = excluded.child_count,
                smart = excluded.smart,
                kometa_file = excluded.kometa_file,
                default_visible_on_home = excluded.default_visible_on_home,
                updated_at = excluded.updated_at
        """, (
            collection.id,
            collection.title,
            collection.source.value,
            collection.library_section_id,
            collection.base_order_index,
            collection.thumb,
            collection.child_count,
            1 if collection.smart else 0,
            collection.kometa_file,
            1 if collection.default_visible_on_home else 0,
            now,
            now,
        ))
        await db.commit()


async def get_collection(collection_id: str) -> Optional[ScheduledCollection]:
    """Get a collection by ID."""
    async with aiosqlite.connect(DATABASE_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM collections WHERE id = ?", (collection_id,)
        ) as cursor:
            row = await cursor.fetchone()
            if not row:
                return None

            # Get windows for this collection
            windows = await get_windows_for_collection(collection_id)

            # Handle default_visible_on_home column (may not exist in older DBs)
            default_visible_on_home = True
            try:
                default_visible_on_home = bool(row["default_visible_on_home"])
            except (KeyError, IndexError):
                pass

            return ScheduledCollection(
                id=row["id"],
                title=row["title"],
                source=CollectionSource(row["source"]),
                library_section_id=row["library_section_id"],
                base_order_index=row["base_order_index"],
                thumb=row["thumb"],
                child_count=row["child_count"],
                smart=bool(row["smart"]),
                kometa_file=row["kometa_file"],
                windows=windows,
                default_visible_on_home=default_visible_on_home,
            )


async def get_collections_for_library(library_section_id: str) -> list[ScheduledCollection]:
    """Get all collections for a library."""
    async with aiosqlite.connect(DATABASE_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM collections WHERE library_section_id = ? ORDER BY base_order_index",
            (library_section_id,)
        ) as cursor:
            rows = await cursor.fetchall()

            collections = []
            for row in rows:
                windows = await get_windows_for_collection(row["id"])
                # Handle default_visible_on_home column (may not exist in older DBs)
                default_visible_on_home = True
                try:
                    default_visible_on_home = bool(row["default_visible_on_home"])
                except (KeyError, IndexError):
                    pass
                collections.append(ScheduledCollection(
                    id=row["id"],
                    title=row["title"],
                    source=CollectionSource(row["source"]),
                    library_section_id=row["library_section_id"],
                    base_order_index=row["base_order_index"],
                    thumb=row["thumb"],
                    child_count=row["child_count"],
                    smart=bool(row["smart"]),
                    kometa_file=row["kometa_file"],
                    windows=windows,
                    default_visible_on_home=default_visible_on_home,
                ))
            return collections


async def save_window(window: ScheduleWindow):
    """Save or update a schedule window."""
    now = datetime.now().isoformat()
    async with aiosqlite.connect(DATABASE_PATH) as db:
        await db.execute("""
            INSERT INTO schedule_windows
            (id, collection_id, start_date, end_date, start_time, end_time,
             recurrence, recurrence_end_date, pin_priority, explicit_position,
             title, color, window_group_id, zone, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                collection_id = excluded.collection_id,
                start_date = excluded.start_date,
                end_date = excluded.end_date,
                start_time = excluded.start_time,
                end_time = excluded.end_time,
                recurrence = excluded.recurrence,
                recurrence_end_date = excluded.recurrence_end_date,
                pin_priority = excluded.pin_priority,
                explicit_position = excluded.explicit_position,
                title = excluded.title,
                color = excluded.color,
                window_group_id = excluded.window_group_id,
                zone = excluded.zone,
                updated_at = excluded.updated_at
        """, (
            window.id,
            window.collection_id,
            window.start_date.isoformat(),
            window.end_date.isoformat(),
            window.start_time.isoformat() if window.start_time else None,
            window.end_time.isoformat() if window.end_time else None,
            window.recurrence.value,
            window.recurrence_end_date.isoformat() if window.recurrence_end_date else None,
            window.pin_priority,
            window.explicit_position,
            window.title,
            window.color,
            window.window_group_id,
            window.zone.value,
            now,
            now,
        ))
        await db.commit()


async def delete_window(window_id: str):
    """Delete a schedule window."""
    async with aiosqlite.connect(DATABASE_PATH) as db:
        await db.execute("DELETE FROM schedule_windows WHERE id = ?", (window_id,))
        await db.commit()


async def get_windows_for_collection(collection_id: str) -> list[ScheduleWindow]:
    """Get all schedule windows for a collection."""
    async with aiosqlite.connect(DATABASE_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM schedule_windows WHERE collection_id = ?",
            (collection_id,)
        ) as cursor:
            rows = await cursor.fetchall()

            windows = []
            for row in rows:
                # Handle zone column (may not exist in older DBs)
                zone = VisibilityZone.NORMAL
                try:
                    zone_value = row["zone"]
                    if zone_value:
                        zone = VisibilityZone(zone_value)
                except (KeyError, IndexError, ValueError):
                    pass

                # Handle window_group_id column (may not exist in older DBs)
                window_group_id = None
                try:
                    window_group_id = row["window_group_id"]
                except (KeyError, IndexError):
                    pass

                windows.append(ScheduleWindow(
                    id=row["id"],
                    collection_id=row["collection_id"],
                    start_date=date.fromisoformat(row["start_date"]),
                    end_date=date.fromisoformat(row["end_date"]),
                    start_time=(
                        time.fromisoformat(row["start_time"])
                        if row["start_time"] else None
                    ),
                    end_time=(
                        time.fromisoformat(row["end_time"])
                        if row["end_time"] else None
                    ),
                    recurrence=RecurrenceType(row["recurrence"]),
                    recurrence_end_date=(
                        date.fromisoformat(row["recurrence_end_date"])
                        if row["recurrence_end_date"] else None
                    ),
                    pin_priority=row["pin_priority"],
                    explicit_position=row["explicit_position"],
                    title=row["title"],
                    color=row["color"],
                    window_group_id=window_group_id,
                    zone=zone,
                ))
            return windows


async def save_base_order(library_section_id: str, ordered_collection_ids: list[str]):
    """Save the base ordering for a library."""
    now = datetime.now().isoformat()
    async with aiosqlite.connect(DATABASE_PATH) as db:
        # Clear existing order
        await db.execute(
            "DELETE FROM base_orders WHERE library_section_id = ?",
            (library_section_id,)
        )

        # Insert new order
        for position, collection_id in enumerate(ordered_collection_ids):
            await db.execute("""
                INSERT INTO base_orders
                (library_section_id, collection_id, position, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?)
            """, (library_section_id, collection_id, position, now, now))

            # Also update the collection's base_order_index
            await db.execute("""
                UPDATE collections SET base_order_index = ?, updated_at = ?
                WHERE id = ?
            """, (position, now, collection_id))

        await db.commit()


async def get_base_order(library_section_id: str) -> list[str]:
    """Get the base ordering for a library."""
    async with aiosqlite.connect(DATABASE_PATH) as db:
        async with db.execute(
            "SELECT collection_id FROM base_orders WHERE library_section_id = ? ORDER BY position",
            (library_section_id,)
        ) as cursor:
            rows = await cursor.fetchall()
            return [row[0] for row in rows]


async def save_rollback_snapshot(snapshot: RollbackSnapshot):
    """Save a rollback snapshot."""
    async with aiosqlite.connect(DATABASE_PATH) as db:
        await db.execute("""
            INSERT INTO rollback_snapshots
            (id, library_section_id, hub_order, hub_visibility, note, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (
            snapshot.id,
            snapshot.library_section_id,
            json.dumps(snapshot.hub_order),
            json.dumps(snapshot.hub_visibility),
            snapshot.note,
            snapshot.created_at.isoformat(),
        ))
        await db.commit()


async def get_rollback_snapshots(
    library_section_id: str,
    limit: int = 10
) -> list[RollbackSnapshot]:
    """Get recent rollback snapshots for a library."""
    async with aiosqlite.connect(DATABASE_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            """SELECT * FROM rollback_snapshots
               WHERE library_section_id = ?
               ORDER BY rowid DESC LIMIT ?""",
            (library_section_id, limit)
        ) as cursor:
            rows = await cursor.fetchall()

            snapshots = []
            for row in rows:
                raw_visibility = json.loads(row["hub_visibility"])
                # Convert old format (bool) to new format (dict) if needed
                hub_visibility = {}
                for hub_id, val in raw_visibility.items():
                    if isinstance(val, bool):
                        # Old format: single boolean -> convert to dict
                        hub_visibility[hub_id] = {
                            "own_home": val,
                            "shared_home": val,
                            "recommended": val,
                        }
                    else:
                        # New format: already a dict
                        hub_visibility[hub_id] = val

                snapshots.append(RollbackSnapshot(
                    id=row["id"],
                    library_section_id=row["library_section_id"],
                    hub_order=json.loads(row["hub_order"]),
                    hub_visibility=hub_visibility,
                    note=row["note"],
                    created_at=datetime.fromisoformat(row["created_at"]),
                ))
            return snapshots


async def get_rollback_snapshot(snapshot_id: str) -> RollbackSnapshot | None:
    """Get a specific rollback snapshot by ID."""
    async with aiosqlite.connect(DATABASE_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM rollback_snapshots WHERE id = ?",
            (snapshot_id,)
        ) as cursor:
            row = await cursor.fetchone()
            if not row:
                return None

            raw_visibility = json.loads(row["hub_visibility"])
            # Convert old format (bool) to new format (dict) if needed
            hub_visibility = {}
            for hub_id, val in raw_visibility.items():
                if isinstance(val, bool):
                    hub_visibility[hub_id] = {
                        "own_home": val,
                        "shared_home": val,
                        "recommended": val,
                    }
                else:
                    hub_visibility[hub_id] = val

            return RollbackSnapshot(
                id=row["id"],
                library_section_id=row["library_section_id"],
                hub_order=json.loads(row["hub_order"]),
                hub_visibility=hub_visibility,
                note=row["note"],
                created_at=datetime.fromisoformat(row["created_at"]),
            )


# ================== Window Group Functions ==================

async def save_window_group(group: WindowGroup):
    """Save or update a window group."""
    now = datetime.now().isoformat()
    # Convert datetime to ISO string if needed
    start_at = group.start_at.isoformat() if isinstance(group.start_at, datetime) else group.start_at
    end_at = group.end_at.isoformat() if isinstance(group.end_at, datetime) else group.end_at
    async with aiosqlite.connect(DATABASE_PATH) as db:
        await db.execute("""
            INSERT INTO window_groups
            (id, library_section_id, name, start_at, end_at, recurrence_rule,
             priority, color, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                library_section_id = excluded.library_section_id,
                name = excluded.name,
                start_at = excluded.start_at,
                end_at = excluded.end_at,
                recurrence_rule = excluded.recurrence_rule,
                priority = excluded.priority,
                color = excluded.color,
                updated_at = excluded.updated_at
        """, (
            group.id,
            group.library_section_id,
            group.name,
            start_at,
            end_at,
            group.recurrence_rule,
            group.priority,
            group.color,
            now,
            now,
        ))
        await db.commit()


async def get_window_group(group_id: str) -> Optional[WindowGroup]:
    """Get a window group by ID."""
    async with aiosqlite.connect(DATABASE_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM window_groups WHERE id = ?", (group_id,)
        ) as cursor:
            row = await cursor.fetchone()
            if not row:
                return None

            return WindowGroup(
                id=row["id"],
                library_section_id=row["library_section_id"],
                name=row["name"],
                start_at=datetime.fromisoformat(row["start_at"]),
                end_at=datetime.fromisoformat(row["end_at"]),
                recurrence_rule=row["recurrence_rule"],
                priority=row["priority"],
                color=row["color"],
            )


async def get_window_groups_for_library(library_section_id: str) -> list[WindowGroup]:
    """Get all window groups for a library."""
    async with aiosqlite.connect(DATABASE_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM window_groups WHERE library_section_id = ? ORDER BY priority, name",
            (library_section_id,)
        ) as cursor:
            rows = await cursor.fetchall()

            groups = []
            for row in rows:
                groups.append(WindowGroup(
                    id=row["id"],
                    library_section_id=row["library_section_id"],
                    name=row["name"],
                    start_at=datetime.fromisoformat(row["start_at"]),
                    end_at=datetime.fromisoformat(row["end_at"]),
                    recurrence_rule=row["recurrence_rule"],
                    priority=row["priority"],
                    color=row["color"],
                ))
            return groups


async def delete_window_group(group_id: str):
    """Delete a window group."""
    async with aiosqlite.connect(DATABASE_PATH) as db:
        await db.execute("DELETE FROM window_groups WHERE id = ?", (group_id,))
        await db.commit()


# ================== Layout Block Functions ==================

async def init_layout_blocks_tables():
    """Initialize layout blocks database tables."""
    async with aiosqlite.connect(DATABASE_PATH) as db:
        # Layout Blocks table
        await db.execute("""
            CREATE TABLE IF NOT EXISTS layout_blocks (
                id TEXT PRIMARY KEY,
                library_section_id TEXT NOT NULL,
                name TEXT NOT NULL,
                start_at TEXT NOT NULL,
                end_at TEXT NOT NULL,
                repeat_yearly INTEGER DEFAULT 0,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # Migration: Add repeat_yearly column if it doesn't exist
        try:
            await db.execute("ALTER TABLE layout_blocks ADD COLUMN repeat_yearly INTEGER DEFAULT 0")
        except Exception:
            pass  # Column already exists

        # Layout Block Items table
        await db.execute("""
            CREATE TABLE IF NOT EXISTS layout_block_items (
                id TEXT PRIMARY KEY,
                block_id TEXT NOT NULL,
                collection_id TEXT NOT NULL,
                order_index INTEGER NOT NULL,
                visible_home INTEGER DEFAULT 0,
                visible_shared_home INTEGER DEFAULT 0,
                visible_shared_friends INTEGER DEFAULT 0,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (block_id) REFERENCES layout_blocks(id) ON DELETE CASCADE
            )
        """)

        # Saved Layouts table (for saving/loading layout templates)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS saved_layouts (
                id TEXT PRIMARY KEY,
                library_section_id TEXT NOT NULL,
                name TEXT NOT NULL,
                description TEXT,
                layout_data TEXT NOT NULL,
                items_count INTEGER DEFAULT 0,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        """)

        await db.commit()
        logger.info("Layout blocks tables initialized")


async def get_layout_blocks(library_section_id: str) -> list[LayoutBlock]:
    """Get all layout blocks for a library."""
    async with aiosqlite.connect(DATABASE_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM layout_blocks WHERE library_section_id = ? ORDER BY start_at",
            (library_section_id,)
        ) as cursor:
            rows = await cursor.fetchall()

            blocks = []
            for row in rows:
                # Get items for this block
                items = await get_layout_block_items(row["id"])
                blocks.append(LayoutBlock(
                    id=row["id"],
                    library_section_id=row["library_section_id"],
                    name=row["name"],
                    start_at=datetime.fromisoformat(row["start_at"]),
                    end_at=datetime.fromisoformat(row["end_at"]),
                    repeat_yearly=bool(row["repeat_yearly"]) if row["repeat_yearly"] is not None else False,
                    created_at=datetime.fromisoformat(row["created_at"]) if row["created_at"] else None,
                    updated_at=datetime.fromisoformat(row["updated_at"]) if row["updated_at"] else None,
                    items=items,
                ))
            return blocks


async def get_layout_block(block_id: str) -> Optional[LayoutBlock]:
    """Get a single layout block by ID."""
    async with aiosqlite.connect(DATABASE_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM layout_blocks WHERE id = ?", (block_id,)
        ) as cursor:
            row = await cursor.fetchone()
            if not row:
                return None

            # Get items for this block
            items = await get_layout_block_items(block_id)
            return LayoutBlock(
                id=row["id"],
                library_section_id=row["library_section_id"],
                name=row["name"],
                start_at=datetime.fromisoformat(row["start_at"]),
                end_at=datetime.fromisoformat(row["end_at"]),
                repeat_yearly=bool(row["repeat_yearly"]) if row["repeat_yearly"] is not None else False,
                created_at=datetime.fromisoformat(row["created_at"]) if row["created_at"] else None,
                updated_at=datetime.fromisoformat(row["updated_at"]) if row["updated_at"] else None,
                items=items,
            )


async def create_layout_block(
    block_id: str,
    library_section_id: str,
    name: str,
    start_at: datetime,
    end_at: datetime,
    repeat_yearly: bool = False
) -> LayoutBlock:
    """Create a new layout block."""
    now = datetime.now().isoformat()
    start_at_str = start_at.isoformat() if isinstance(start_at, datetime) else start_at
    end_at_str = end_at.isoformat() if isinstance(end_at, datetime) else end_at

    async with aiosqlite.connect(DATABASE_PATH) as db:
        await db.execute("""
            INSERT INTO layout_blocks
            (id, library_section_id, name, start_at, end_at, repeat_yearly, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (block_id, library_section_id, name, start_at_str, end_at_str, int(repeat_yearly), now, now))
        await db.commit()

    return LayoutBlock(
        id=block_id,
        library_section_id=library_section_id,
        name=name,
        start_at=start_at,
        end_at=end_at,
        repeat_yearly=repeat_yearly,
        created_at=datetime.fromisoformat(now),
        updated_at=datetime.fromisoformat(now),
        items=[],
    )


async def update_layout_block(
    block_id: str,
    name: Optional[str] = None,
    start_at: Optional[datetime] = None,
    end_at: Optional[datetime] = None,
    repeat_yearly: Optional[bool] = None
) -> Optional[LayoutBlock]:
    """Update a layout block's metadata."""
    existing = await get_layout_block(block_id)
    if not existing:
        return None

    now = datetime.now().isoformat()
    updated_name = name if name is not None else existing.name
    updated_start_at = start_at if start_at is not None else existing.start_at
    updated_end_at = end_at if end_at is not None else existing.end_at
    updated_repeat_yearly = repeat_yearly if repeat_yearly is not None else existing.repeat_yearly

    start_at_str = updated_start_at.isoformat() if isinstance(updated_start_at, datetime) else updated_start_at
    end_at_str = updated_end_at.isoformat() if isinstance(updated_end_at, datetime) else updated_end_at

    async with aiosqlite.connect(DATABASE_PATH) as db:
        await db.execute("""
            UPDATE layout_blocks
            SET name = ?, start_at = ?, end_at = ?, repeat_yearly = ?, updated_at = ?
            WHERE id = ?
        """, (updated_name, start_at_str, end_at_str, int(updated_repeat_yearly), now, block_id))
        await db.commit()

    return await get_layout_block(block_id)


async def delete_layout_block(block_id: str):
    """Delete a layout block and its items."""
    async with aiosqlite.connect(DATABASE_PATH) as db:
        # Delete items first (cascading delete should handle this, but be explicit)
        await db.execute("DELETE FROM layout_block_items WHERE block_id = ?", (block_id,))
        # Delete the block
        await db.execute("DELETE FROM layout_blocks WHERE id = ?", (block_id,))
        await db.commit()


async def get_layout_block_items(block_id: str) -> list[LayoutBlockItem]:
    """Get all items for a layout block."""
    async with aiosqlite.connect(DATABASE_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM layout_block_items WHERE block_id = ? ORDER BY order_index",
            (block_id,)
        ) as cursor:
            rows = await cursor.fetchall()

            items = []
            for row in rows:
                items.append(LayoutBlockItem(
                    id=row["id"],
                    block_id=row["block_id"],
                    collection_id=row["collection_id"],
                    order_index=row["order_index"],
                    visible_home=bool(row["visible_home"]),
                    visible_shared_home=bool(row["visible_shared_home"]),
                    visible_shared_friends=bool(row["visible_shared_friends"]),
                    created_at=datetime.fromisoformat(row["created_at"]) if row["created_at"] else None,
                    updated_at=datetime.fromisoformat(row["updated_at"]) if row["updated_at"] else None,
                ))
            return items


async def get_active_layout_block(
    library_section_id: str,
    at_time: datetime
) -> Optional[LayoutBlock]:
    """
    Find the active layout block at a given time.

    A block is active if: start_at <= at_time < end_at
    For repeat_yearly blocks, we check if the current month/day falls within
    the block's month/day range (adjusted for the current year).

    If multiple blocks overlap, returns the one with the latest start_at (most specific).

    Returns None if no block is active (dead time).
    """
    async with aiosqlite.connect(DATABASE_PATH) as db:
        db.row_factory = aiosqlite.Row

        # Get all blocks for this library and compare datetimes properly
        # (SQLite string comparison doesn't handle timezones correctly)
        async with db.execute(
            """SELECT * FROM layout_blocks
               WHERE library_section_id = ?
               ORDER BY start_at DESC""",
            (library_section_id,)
        ) as cursor:
            rows = await cursor.fetchall()

            # Make at_time timezone-aware if it isn't
            if at_time.tzinfo is None:
                # Assume local time, convert to UTC for comparison
                local_offset = datetime.now().astimezone().utcoffset()
                at_time_utc = at_time - local_offset
            else:
                at_time_utc = at_time.astimezone(timezone.utc).replace(tzinfo=None)

            for row in rows:
                # Parse stored datetime (may have timezone info)
                start_str = row["start_at"]
                end_str = row["end_at"]
                repeat_yearly = bool(row["repeat_yearly"]) if row["repeat_yearly"] is not None else False

                start_at = datetime.fromisoformat(start_str)
                end_at = datetime.fromisoformat(end_str)

                # Remove timezone info for comparison (assume UTC)
                if start_at.tzinfo is not None:
                    start_at = start_at.replace(tzinfo=None)
                if end_at.tzinfo is not None:
                    end_at = end_at.replace(tzinfo=None)

                is_active = False

                if repeat_yearly:
                    # For yearly blocks, check if current month/day falls within range
                    # Adjust block dates to the current year for comparison
                    current_year = at_time_utc.year

                    # Handle year boundary (e.g., Dec 15 - Jan 5)
                    if start_at.month > end_at.month or (start_at.month == end_at.month and start_at.day > end_at.day):
                        # Block spans year boundary
                        # Check if we're in the late part of the year (after start)
                        adjusted_start = start_at.replace(year=current_year)
                        adjusted_end = end_at.replace(year=current_year + 1)

                        if adjusted_start <= at_time_utc < adjusted_end:
                            is_active = True
                        else:
                            # Or we might be in early part of year (before end)
                            adjusted_start_prev = start_at.replace(year=current_year - 1)
                            adjusted_end_prev = end_at.replace(year=current_year)
                            if adjusted_start_prev <= at_time_utc < adjusted_end_prev:
                                is_active = True
                    else:
                        # Block within same year
                        adjusted_start = start_at.replace(year=current_year)
                        adjusted_end = end_at.replace(year=current_year)
                        if adjusted_start <= at_time_utc < adjusted_end:
                            is_active = True
                else:
                    # Standard non-repeating check
                    if start_at <= at_time_utc < end_at:
                        is_active = True

                if is_active:
                    # Get items for this block
                    items = await get_layout_block_items(row["id"])
                    return LayoutBlock(
                        id=row["id"],
                        library_section_id=row["library_section_id"],
                        name=row["name"],
                        start_at=datetime.fromisoformat(row["start_at"]),
                        end_at=datetime.fromisoformat(row["end_at"]),
                        repeat_yearly=repeat_yearly,
                        created_at=datetime.fromisoformat(row["created_at"]) if row["created_at"] else None,
                        updated_at=datetime.fromisoformat(row["updated_at"]) if row["updated_at"] else None,
                        items=items,
                    )

            return None


async def duplicate_layout_block(
    source_block_id: str,
    new_name: str,
    shift_years: int = 1
) -> Optional[LayoutBlock]:
    """
    Duplicate a layout block with all its items.

    Args:
        source_block_id: ID of the block to duplicate
        new_name: Name for the new block
        shift_years: How many years to shift the dates forward (default: 1)

    Returns:
        The newly created LayoutBlock, or None if source not found
    """
    import uuid
    from dateutil.relativedelta import relativedelta

    # Get the source block
    source = await get_layout_block(source_block_id)
    if not source:
        return None

    # Generate new ID
    new_block_id = str(uuid.uuid4())
    now = datetime.now().isoformat()

    # Shift dates forward
    new_start_at = source.start_at + relativedelta(years=shift_years)
    new_end_at = source.end_at + relativedelta(years=shift_years)

    async with aiosqlite.connect(DATABASE_PATH) as db:
        # Create new block
        await db.execute("""
            INSERT INTO layout_blocks
            (id, library_section_id, name, start_at, end_at, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (
            new_block_id,
            source.library_section_id,
            new_name,
            new_start_at.isoformat(),
            new_end_at.isoformat(),
            now,
            now,
        ))

        # Copy all items from source block
        source_items = await get_layout_block_items(source_block_id)
        for item in source_items:
            item_id = str(uuid.uuid4())
            await db.execute("""
                INSERT INTO layout_block_items
                (id, block_id, collection_id, order_index, visible_home,
                 visible_shared_home, visible_shared_friends, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                item_id,
                new_block_id,
                item.collection_id,
                item.order_index,
                1 if item.visible_home else 0,
                1 if item.visible_shared_home else 0,
                1 if item.visible_shared_friends else 0,
                now,
                now,
            ))

        await db.commit()

    # Return the new block
    return await get_layout_block(new_block_id)


async def save_layout_block_items(block_id: str, items: list[dict]):
    """Replace all items for a layout block (bulk save)."""
    import uuid
    now = datetime.now().isoformat()

    async with aiosqlite.connect(DATABASE_PATH) as db:
        # Delete existing items
        await db.execute("DELETE FROM layout_block_items WHERE block_id = ?", (block_id,))

        # Insert new items
        for item in items:
            item_id = str(uuid.uuid4())
            await db.execute("""
                INSERT INTO layout_block_items
                (id, block_id, collection_id, order_index, visible_home,
                 visible_shared_home, visible_shared_friends, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                item_id,
                block_id,
                item["collection_id"],
                item["order_index"],
                1 if item.get("visible_home", False) else 0,
                1 if item.get("visible_shared_home", False) else 0,
                1 if item.get("visible_shared_friends", False) else 0,
                now,
                now,
            ))

        await db.commit()


# ================== Library Sync Settings Functions ==================

async def init_sync_settings_table():
    """Initialize library sync settings table."""
    async with aiosqlite.connect(DATABASE_PATH) as db:
        await db.execute("""
            CREATE TABLE IF NOT EXISTS library_sync_settings (
                library_section_id TEXT PRIMARY KEY,
                sync_enabled INTEGER DEFAULT 0,
                interval_minutes INTEGER DEFAULT 60,
                last_checked_at TEXT,
                last_applied_at TEXT,
                last_result TEXT,
                last_error TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        """)
        await db.commit()
        logger.info("Library sync settings table initialized")


async def get_library_sync_settings(section_id: str) -> Optional[LibrarySyncSettings]:
    """Get sync settings for a library. Returns None if not configured."""
    async with aiosqlite.connect(DATABASE_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM library_sync_settings WHERE library_section_id = ?",
            (section_id,)
        ) as cursor:
            row = await cursor.fetchone()
            if not row:
                return None

            return LibrarySyncSettings(
                library_section_id=row["library_section_id"],
                sync_enabled=bool(row["sync_enabled"]),
                interval_minutes=row["interval_minutes"],
                last_checked_at=datetime.fromisoformat(row["last_checked_at"]) if row["last_checked_at"] else None,
                last_applied_at=datetime.fromisoformat(row["last_applied_at"]) if row["last_applied_at"] else None,
                last_result=SyncResultStatus(row["last_result"]) if row["last_result"] else None,
                last_error=row["last_error"],
                created_at=datetime.fromisoformat(row["created_at"]) if row["created_at"] else None,
                updated_at=datetime.fromisoformat(row["updated_at"]) if row["updated_at"] else None,
            )


async def upsert_library_sync_settings(settings: LibrarySyncSettings):
    """Create or update sync settings for a library."""
    now = datetime.now().isoformat()
    async with aiosqlite.connect(DATABASE_PATH) as db:
        await db.execute("""
            INSERT INTO library_sync_settings
            (library_section_id, sync_enabled, interval_minutes, last_checked_at,
             last_applied_at, last_result, last_error, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(library_section_id) DO UPDATE SET
                sync_enabled = excluded.sync_enabled,
                interval_minutes = excluded.interval_minutes,
                last_checked_at = excluded.last_checked_at,
                last_applied_at = excluded.last_applied_at,
                last_result = excluded.last_result,
                last_error = excluded.last_error,
                updated_at = excluded.updated_at
        """, (
            settings.library_section_id,
            1 if settings.sync_enabled else 0,
            settings.interval_minutes,
            settings.last_checked_at.isoformat() if settings.last_checked_at else None,
            settings.last_applied_at.isoformat() if settings.last_applied_at else None,
            settings.last_result.value if settings.last_result else None,
            settings.last_error,
            now,
            now,
        ))
        await db.commit()


async def get_all_enabled_sync_libraries() -> list[LibrarySyncSettings]:
    """Get all libraries with sync enabled."""
    async with aiosqlite.connect(DATABASE_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM library_sync_settings WHERE sync_enabled = 1"
        ) as cursor:
            rows = await cursor.fetchall()

            settings_list = []
            for row in rows:
                settings_list.append(LibrarySyncSettings(
                    library_section_id=row["library_section_id"],
                    sync_enabled=bool(row["sync_enabled"]),
                    interval_minutes=row["interval_minutes"],
                    last_checked_at=datetime.fromisoformat(row["last_checked_at"]) if row["last_checked_at"] else None,
                    last_applied_at=datetime.fromisoformat(row["last_applied_at"]) if row["last_applied_at"] else None,
                    last_result=SyncResultStatus(row["last_result"]) if row["last_result"] else None,
                    last_error=row["last_error"],
                    created_at=datetime.fromisoformat(row["created_at"]) if row["created_at"] else None,
                    updated_at=datetime.fromisoformat(row["updated_at"]) if row["updated_at"] else None,
                ))
            return settings_list


async def update_sync_status(
    section_id: str,
    last_checked: Optional[datetime] = None,
    last_applied: Optional[datetime] = None,
    last_result: Optional[SyncResultStatus | str] = None,
    last_error: Optional[str] = None
):
    """Update sync status fields after a sync attempt."""
    now = datetime.now().isoformat()
    async with aiosqlite.connect(DATABASE_PATH) as db:
        # Build dynamic update query
        updates = ["updated_at = ?"]
        params = [now]

        if last_checked is not None:
            updates.append("last_checked_at = ?")
            params.append(last_checked.isoformat())
        if last_applied is not None:
            updates.append("last_applied_at = ?")
            params.append(last_applied.isoformat())
        if last_result is not None:
            updates.append("last_result = ?")
            # Handle both enum and string
            params.append(last_result.value if hasattr(last_result, 'value') else last_result)
        if last_error is not None:
            updates.append("last_error = ?")
            params.append(last_error)

        params.append(section_id)

        await db.execute(
            f"UPDATE library_sync_settings SET {', '.join(updates)} WHERE library_section_id = ?",
            params
        )
        await db.commit()


# ================== Promotion Functions ==================

async def init_promotions_tables():
    """Initialize promotions database tables."""
    async with aiosqlite.connect(DATABASE_PATH) as db:
        # Promotions table
        await db.execute("""
            CREATE TABLE IF NOT EXISTS promotions (
                id TEXT PRIMARY KEY,
                library_section_id TEXT NOT NULL,
                name TEXT NOT NULL,
                start_at TEXT NOT NULL,
                end_at TEXT NOT NULL,
                repeat_yearly INTEGER DEFAULT 0,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # Promotion Items table
        await db.execute("""
            CREATE TABLE IF NOT EXISTS promotion_items (
                id TEXT PRIMARY KEY,
                promotion_id TEXT NOT NULL,
                hub_identifier TEXT NOT NULL,
                order_index INTEGER NOT NULL,
                visible_home INTEGER DEFAULT 1,
                visible_shared_home INTEGER DEFAULT 1,
                visible_shared_friends INTEGER DEFAULT 1,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (promotion_id) REFERENCES promotions(id) ON DELETE CASCADE
            )
        """)

        await db.commit()
        logger.info("Promotions tables initialized")


async def get_promotions(library_section_id: str) -> list[Promotion]:
    """Get all promotions for a library."""
    async with aiosqlite.connect(DATABASE_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM promotions WHERE library_section_id = ? ORDER BY start_at",
            (library_section_id,)
        ) as cursor:
            rows = await cursor.fetchall()

            promotions = []
            for row in rows:
                items = await get_promotion_items(row["id"])
                promotions.append(Promotion(
                    id=row["id"],
                    library_section_id=row["library_section_id"],
                    name=row["name"],
                    start_at=datetime.fromisoformat(row["start_at"]),
                    end_at=datetime.fromisoformat(row["end_at"]),
                    repeat_yearly=bool(row["repeat_yearly"]),
                    created_at=datetime.fromisoformat(row["created_at"]) if row["created_at"] else None,
                    updated_at=datetime.fromisoformat(row["updated_at"]) if row["updated_at"] else None,
                    items=items,
                ))
            return promotions


async def get_promotion(promotion_id: str) -> Optional[Promotion]:
    """Get a single promotion by ID."""
    async with aiosqlite.connect(DATABASE_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM promotions WHERE id = ?", (promotion_id,)
        ) as cursor:
            row = await cursor.fetchone()
            if not row:
                return None

            items = await get_promotion_items(promotion_id)
            return Promotion(
                id=row["id"],
                library_section_id=row["library_section_id"],
                name=row["name"],
                start_at=datetime.fromisoformat(row["start_at"]),
                end_at=datetime.fromisoformat(row["end_at"]),
                repeat_yearly=bool(row["repeat_yearly"]),
                created_at=datetime.fromisoformat(row["created_at"]) if row["created_at"] else None,
                updated_at=datetime.fromisoformat(row["updated_at"]) if row["updated_at"] else None,
                items=items,
            )


async def create_promotion(
    promotion_id: str,
    library_section_id: str,
    name: str,
    start_at: datetime,
    end_at: datetime,
    repeat_yearly: bool = False
) -> Promotion:
    """Create a new promotion."""
    now = datetime.now().isoformat()
    start_at_str = start_at.isoformat() if isinstance(start_at, datetime) else start_at
    end_at_str = end_at.isoformat() if isinstance(end_at, datetime) else end_at

    async with aiosqlite.connect(DATABASE_PATH) as db:
        await db.execute("""
            INSERT INTO promotions
            (id, library_section_id, name, start_at, end_at, repeat_yearly, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (promotion_id, library_section_id, name, start_at_str, end_at_str,
              1 if repeat_yearly else 0, now, now))
        await db.commit()

    return Promotion(
        id=promotion_id,
        library_section_id=library_section_id,
        name=name,
        start_at=start_at,
        end_at=end_at,
        repeat_yearly=repeat_yearly,
        created_at=datetime.fromisoformat(now),
        updated_at=datetime.fromisoformat(now),
        items=[],
    )


async def update_promotion(
    promotion_id: str,
    name: Optional[str] = None,
    start_at: Optional[datetime] = None,
    end_at: Optional[datetime] = None,
    repeat_yearly: Optional[bool] = None
) -> Optional[Promotion]:
    """Update a promotion's metadata."""
    existing = await get_promotion(promotion_id)
    if not existing:
        return None

    now = datetime.now().isoformat()
    updated_name = name if name is not None else existing.name
    updated_start_at = start_at if start_at is not None else existing.start_at
    updated_end_at = end_at if end_at is not None else existing.end_at
    updated_repeat_yearly = repeat_yearly if repeat_yearly is not None else existing.repeat_yearly

    start_at_str = updated_start_at.isoformat() if isinstance(updated_start_at, datetime) else updated_start_at
    end_at_str = updated_end_at.isoformat() if isinstance(updated_end_at, datetime) else updated_end_at

    async with aiosqlite.connect(DATABASE_PATH) as db:
        await db.execute("""
            UPDATE promotions
            SET name = ?, start_at = ?, end_at = ?, repeat_yearly = ?, updated_at = ?
            WHERE id = ?
        """, (updated_name, start_at_str, end_at_str,
              1 if updated_repeat_yearly else 0, now, promotion_id))
        await db.commit()

    return await get_promotion(promotion_id)


async def delete_promotion(promotion_id: str):
    """Delete a promotion and its items."""
    async with aiosqlite.connect(DATABASE_PATH) as db:
        await db.execute("DELETE FROM promotion_items WHERE promotion_id = ?", (promotion_id,))
        await db.execute("DELETE FROM promotions WHERE id = ?", (promotion_id,))
        await db.commit()


async def get_promotion_items(promotion_id: str) -> list[PromotionItem]:
    """Get all items for a promotion."""
    async with aiosqlite.connect(DATABASE_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM promotion_items WHERE promotion_id = ? ORDER BY order_index",
            (promotion_id,)
        ) as cursor:
            rows = await cursor.fetchall()

            items = []
            for row in rows:
                items.append(PromotionItem(
                    id=row["id"],
                    promotion_id=row["promotion_id"],
                    hub_identifier=row["hub_identifier"],
                    order_index=row["order_index"],
                    visible_home=bool(row["visible_home"]),
                    visible_shared_home=bool(row["visible_shared_home"]),
                    visible_shared_friends=bool(row["visible_shared_friends"]),
                    created_at=datetime.fromisoformat(row["created_at"]) if row["created_at"] else None,
                    updated_at=datetime.fromisoformat(row["updated_at"]) if row["updated_at"] else None,
                ))
            return items


async def save_promotion_items(promotion_id: str, items: list[dict]):
    """Replace all items for a promotion (bulk save)."""
    import uuid
    now = datetime.now().isoformat()

    async with aiosqlite.connect(DATABASE_PATH) as db:
        # Delete existing items
        await db.execute("DELETE FROM promotion_items WHERE promotion_id = ?", (promotion_id,))

        # Insert new items
        for item in items:
            item_id = str(uuid.uuid4())
            await db.execute("""
                INSERT INTO promotion_items
                (id, promotion_id, hub_identifier, order_index, visible_home,
                 visible_shared_home, visible_shared_friends, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                item_id,
                promotion_id,
                item["hub_identifier"],
                item["order_index"],
                1 if item.get("visible_home", True) else 0,
                1 if item.get("visible_shared_home", True) else 0,
                1 if item.get("visible_shared_friends", True) else 0,
                now,
                now,
            ))

        await db.commit()


async def get_active_promotions(
    library_section_id: str,
    at_time: datetime
) -> list[Promotion]:
    """
    Find all active promotions at a given time.

    A promotion is active if: start_at <= at_time < end_at
    For yearly repeating promotions, checks if the month/day falls within range
    regardless of year.

    Returns all active promotions sorted by start_at.
    """
    all_promotions = await get_promotions(library_section_id)
    active = []

    # Make at_time timezone-naive for comparison
    if at_time.tzinfo is not None:
        at_time = at_time.replace(tzinfo=None)

    for promo in all_promotions:
        start = promo.start_at
        end = promo.end_at

        # Make datetimes timezone-naive
        if start.tzinfo is not None:
            start = start.replace(tzinfo=None)
        if end.tzinfo is not None:
            end = end.replace(tzinfo=None)

        if promo.repeat_yearly:
            # For yearly repeating, check if current month/day falls in range
            # Adjust the year to match at_time
            current_year = at_time.year
            adjusted_start = start.replace(year=current_year)
            adjusted_end = end.replace(year=current_year)

            # Handle year boundary (e.g., Dec 15 - Jan 5)
            if adjusted_end < adjusted_start:
                # Promotion spans year boundary - check two possible active periods:
                # 1. Previous cycle: Dec (year-1) to Jan (year)
                # 2. Current cycle: Dec (year) to Jan (year+1)
                prev_cycle_start = adjusted_start.replace(year=current_year - 1)
                prev_cycle_end = adjusted_end  # Jan of current_year
                curr_cycle_start = adjusted_start  # Dec of current_year
                curr_cycle_end = adjusted_end.replace(year=current_year + 1)  # Jan of next year

                if (prev_cycle_start <= at_time < prev_cycle_end) or \
                   (curr_cycle_start <= at_time < curr_cycle_end):
                    active.append(promo)
            else:
                # Normal case
                if adjusted_start <= at_time < adjusted_end:
                    active.append(promo)
        else:
            # One-time promotion
            if start <= at_time < end:
                active.append(promo)

    return active


# ================== Saved Layouts ==================

async def get_saved_layouts(library_section_id: str) -> list[dict]:
    """Get all saved layouts for a library."""
    async with aiosqlite.connect(DATABASE_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM saved_layouts WHERE library_section_id = ? ORDER BY created_at DESC",
            (library_section_id,)
        ) as cursor:
            rows = await cursor.fetchall()
            return [
                {
                    "id": row["id"],
                    "library_section_id": row["library_section_id"],
                    "name": row["name"],
                    "description": row["description"],
                    "items_count": row["items_count"],
                    "created_at": row["created_at"],
                }
                for row in rows
            ]


async def get_saved_layout(layout_id: str) -> Optional[dict]:
    """Get a saved layout by ID including its data."""
    async with aiosqlite.connect(DATABASE_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM saved_layouts WHERE id = ?",
            (layout_id,)
        ) as cursor:
            row = await cursor.fetchone()
            if not row:
                return None
            return {
                "id": row["id"],
                "library_section_id": row["library_section_id"],
                "name": row["name"],
                "description": row["description"],
                "layout_data": json.loads(row["layout_data"]),
                "items_count": row["items_count"],
                "created_at": row["created_at"],
            }


async def create_saved_layout(
    layout_id: str,
    library_section_id: str,
    name: str,
    layout_data: dict,
    description: str = None
) -> dict:
    """Save a layout template."""
    now = datetime.now().isoformat()
    items_count = len(layout_data.get("items", []))

    async with aiosqlite.connect(DATABASE_PATH) as db:
        await db.execute("""
            INSERT INTO saved_layouts
            (id, library_section_id, name, description, layout_data, items_count, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (layout_id, library_section_id, name, description, json.dumps(layout_data), items_count, now))
        await db.commit()

    return {
        "id": layout_id,
        "library_section_id": library_section_id,
        "name": name,
        "description": description,
        "items_count": items_count,
        "created_at": now,
    }


async def delete_saved_layout(layout_id: str) -> bool:
    """Delete a saved layout."""
    async with aiosqlite.connect(DATABASE_PATH) as db:
        cursor = await db.execute(
            "DELETE FROM saved_layouts WHERE id = ?",
            (layout_id,)
        )
        await db.commit()
        return cursor.rowcount > 0
