"""Main FastAPI application for Plex Collection Scheduler."""
import os
import uuid
from datetime import datetime, date, time, timedelta
from pathlib import Path
from typing import Optional
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
import logging

from config import settings
from plex_client import plex_client, PlexHub
from kometa_scanner import KometaScanner
from scheduler import ScheduleEvaluator
from kometa_schedule_parser import (
    KometaScheduleParser,
    ConflictDetector,
    ScheduleConflict,
    evaluate_schedule,
    is_schedule_active,
    find_block_conflicts,
)
from models import (
    ScheduledCollection,
    ScheduleWindow,
    HomeSnapshot,
    ScheduleDiff,
    ApplyResult,
    RollbackSnapshot,
    VisibilityType,
    RecurrenceType,
    CollectionSource,
    ScheduleStatus,
    WindowGroup,
    VisibilityZone,
    HiddenSnapshotItem,
    LayoutBlock,
    LayoutBlockItem,
    LayoutBlockCreate,
    LayoutBlockUpdate,
    LayoutBlockItemSave,
    LibrarySyncSettings,
    LibrarySyncSettingsUpdate,
    ApplyIfNeededResult,
    SyncResultStatus,
)
import database as db
from database import (
    save_window_group,
    get_window_group,
    get_window_groups_for_library,
    delete_window_group,
    init_layout_blocks_tables,
    get_layout_blocks,
    get_layout_block,
    create_layout_block,
    update_layout_block,
    delete_layout_block,
    get_layout_block_items,
    save_layout_block_items,
    get_active_layout_block,
    init_sync_settings_table,
    get_library_sync_settings,
    upsert_library_sync_settings,
    get_all_enabled_sync_libraries,
    update_sync_status,
    get_rollback_snapshot,
)
from sync_scheduler import scheduler

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="Plex Collection Scheduler",
    description="Schedule and order Plex Home collections over time",
    version="0.1.0",
)

# CORS for frontend (dev servers and same-origin in production)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:5173",
        "http://localhost:5100",  # Same origin when served together
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ================== Startup ==================

@app.on_event("startup")
async def startup():
    """Initialize database on startup."""
    await db.init_database()
    await init_layout_blocks_tables()
    await init_sync_settings_table()
    # Start the background scheduler
    await scheduler.start()
    logger.info(f"Plex Collection Scheduler started (mode: {settings.apply_mode})")


@app.on_event("shutdown")
async def shutdown():
    """Cleanup on shutdown."""
    await scheduler.stop()
    logger.info("Plex Collection Scheduler stopped")


# ================== Health & Config ==================

@app.get("/api/health")
async def health():
    """Health check endpoint."""
    return {
        "status": "ok",
        "apply_mode": settings.apply_mode,
        "plex_url": settings.plex_url,
        "kometa_path": settings.kometa_config_path or None,
    }


@app.get("/api/config")
async def get_config():
    """Get current configuration."""
    return {
        "apply_mode": settings.apply_mode,
        "plex_url": settings.plex_url,
        "kometa_config_path": settings.kometa_config_path,
        "max_reorder_retries": settings.max_reorder_retries,
        "simulate_reorder_failure": settings.simulate_reorder_failure,
    }


# ================== Plex Libraries ==================

@app.get("/api/libraries")
async def get_libraries():
    """Get all Plex libraries."""
    try:
        libraries = await plex_client.get_libraries()
        return {
            "libraries": [
                {
                    "key": lib.key,
                    "title": lib.title,
                    "type": lib.type,
                }
                for lib in libraries
            ]
        }
    except Exception as e:
        logger.error(f"Failed to get libraries: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ================== Collections ==================

@app.get("/api/libraries/{section_id}/collections")
async def get_collections(section_id: str, include_kometa: bool = True):
    """
    Get all collections for a library, merging Plex and Kometa sources.
    """
    try:
        # Get Plex collections
        plex_collections = await plex_client.get_collections(section_id)

        # Get library type for Kometa filtering
        library_type = None
        try:
            libraries = await plex_client.get_libraries()
            for lib in libraries:
                if lib.key == section_id:
                    library_type = lib.type  # "movie" or "show"
                    break
        except Exception as e:
            logger.warning(f"Could not get library type for section {section_id}: {e}")

        # Get Kometa collections if configured, filtered by library type
        kometa_collections = []
        if include_kometa and settings.kometa_config_path:
            scanner = KometaScanner(settings.kometa_config_path)
            kometa_collections = scanner.scan(library_type=library_type)

        # Get scheduled collections from database
        db_collections = await db.get_collections_for_library(section_id)
        db_map = {c.id: c for c in db_collections}

        # Merge collections
        result = []
        seen_names = set()

        # Add Plex collections
        for pc in plex_collections:
            seen_names.add(pc.title)

            # Check if in Kometa
            kometa_match = next(
                (kc for kc in kometa_collections if kc.name == pc.title),
                None
            )

            # Get from database or create new
            db_collection = db_map.get(pc.rating_key)

            source = CollectionSource.BOTH if kometa_match else CollectionSource.PLEX

            collection = ScheduledCollection(
                id=pc.rating_key,
                title=pc.title,
                source=source,
                library_section_id=section_id,
                base_order_index=db_collection.base_order_index if db_collection else 0,
                windows=db_collection.windows if db_collection else [],
                thumb=pc.thumb,
                child_count=pc.child_count,
                smart=pc.smart,
                kometa_file=kometa_match.file_name if kometa_match else None,
            )

            # Save to database if new
            if not db_collection:
                await db.save_collection(collection)

            result.append(collection)

        # Add Kometa-only collections
        for kc in kometa_collections:
            if kc.name not in seen_names:
                # Create a synthetic ID for Kometa-only collections
                kometa_id = f"kometa:{kc.name}"
                db_collection = db_map.get(kometa_id)

                collection = ScheduledCollection(
                    id=kometa_id,
                    title=kc.name,
                    source=CollectionSource.KOMETA,
                    library_section_id=section_id,
                    base_order_index=db_collection.base_order_index if db_collection else 999,
                    windows=db_collection.windows if db_collection else [],
                    kometa_file=kc.file_name,
                )

                if not db_collection:
                    await db.save_collection(collection)

                result.append(collection)

        # Sort by base order
        result.sort(key=lambda c: c.base_order_index)

        return {
            "collections": [
                {
                    "id": c.id,
                    "title": c.title,
                    "source": c.source.value,
                    "library_section_id": c.library_section_id,
                    "base_order_index": c.base_order_index,
                    "windows_count": len(c.windows),
                    "thumb": c.thumb,
                    "child_count": c.child_count,
                    "smart": c.smart,
                    "kometa_file": c.kometa_file,
                    "status": _get_collection_status(c),
                }
                for c in result
            ]
        }
    except Exception as e:
        logger.error(f"Failed to get collections: {e}")
        raise HTTPException(status_code=500, detail=str(e))


def _get_collection_status(collection: ScheduledCollection) -> str:
    """Determine current status of a collection."""
    now = datetime.now()

    if collection.source == CollectionSource.KOMETA:
        return ScheduleStatus.KOMETA_ONLY.value

    if not collection.windows:
        return ScheduleStatus.MANUAL.value

    evaluator = ScheduleEvaluator([collection])
    active_windows = evaluator.get_active_windows(collection.id, now)

    if active_windows:
        return ScheduleStatus.ACTIVE.value

    return ScheduleStatus.SCHEDULED.value


# ================== Current Hub Order ==================

@app.get("/api/libraries/{section_id}/hubs")
async def get_hub_order(section_id: str):
    """
    Get current managed hubs order for a library.
    This is the source of truth from Plex.
    """
    try:
        state = await plex_client.get_managed_hubs(section_id)
        return {
            "library_section_id": section_id,
            "hubs": [
                {
                    "hub_identifier": h.hub_identifier,
                    "title": h.title,
                    "type": h.type,
                    "promoted": h.promoted,
                    "promoted_to_own_home": h.promoted_to_own_home,
                    "promoted_to_shared_home": h.promoted_to_shared_home,
                    "promoted_to_recommended": h.promoted_to_recommended,
                    "hub_key": h.hub_key,
                    "context": h.context,
                }
                for h in state.hubs
            ],
            "order": state.hub_order,
            "promoted_count": len(state.hub_order),
        }
    except Exception as e:
        logger.error(f"Failed to get hub order: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ================== Schedule Windows ==================

class WindowCreate(BaseModel):
    collection_id: str
    start_date: date
    end_date: date
    start_time: Optional[time] = None
    end_time: Optional[time] = None
    recurrence: RecurrenceType = RecurrenceType.NONE
    recurrence_end_date: Optional[date] = None
    pin_priority: Optional[int] = None
    explicit_position: Optional[int] = None
    title: Optional[str] = None
    color: Optional[str] = None
    zone: VisibilityZone = VisibilityZone.NORMAL


class WindowUpdate(BaseModel):
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    start_time: Optional[time] = None
    end_time: Optional[time] = None
    recurrence: Optional[RecurrenceType] = None
    recurrence_end_date: Optional[date] = None
    pin_priority: Optional[int] = None
    explicit_position: Optional[int] = None
    title: Optional[str] = None
    color: Optional[str] = None


class WindowGroupCreate(BaseModel):
    library_section_id: str
    name: str
    start_at: datetime
    end_at: datetime
    recurrence_rule: Optional[str] = None
    priority: int = 50
    color: Optional[str] = None


class WindowGroupUpdate(BaseModel):
    name: Optional[str] = None
    start_at: Optional[datetime] = None
    end_at: Optional[datetime] = None
    recurrence_rule: Optional[str] = None
    priority: Optional[int] = None
    color: Optional[str] = None


@app.post("/api/windows")
async def create_window(window: WindowCreate):
    """Create a new schedule window."""
    window_id = str(uuid.uuid4())

    schedule_window = ScheduleWindow(
        id=window_id,
        collection_id=window.collection_id,
        start_date=window.start_date,
        end_date=window.end_date,
        start_time=window.start_time,
        end_time=window.end_time,
        recurrence=window.recurrence,
        recurrence_end_date=window.recurrence_end_date,
        pin_priority=window.pin_priority,
        explicit_position=window.explicit_position,
        title=window.title,
        color=window.color,
        zone=window.zone,
    )

    await db.save_window(schedule_window)

    return {"id": window_id, "message": "Window created"}


@app.put("/api/windows/{window_id}")
async def update_window(window_id: str, updates: WindowUpdate):
    """Update an existing schedule window."""
    # Get existing windows for this collection to find the one we're updating
    # This is a bit roundabout - in production would have direct window lookup
    async with db.aiosqlite.connect(db.DATABASE_PATH) as conn:
        conn.row_factory = db.aiosqlite.Row
        async with conn.execute(
            "SELECT * FROM schedule_windows WHERE id = ?", (window_id,)
        ) as cursor:
            row = await cursor.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Window not found")

            # Build updated window
            schedule_window = ScheduleWindow(
                id=window_id,
                collection_id=row["collection_id"],
                start_date=updates.start_date or date.fromisoformat(row["start_date"]),
                end_date=updates.end_date or date.fromisoformat(row["end_date"]),
                start_time=(
                    updates.start_time if updates.start_time is not None
                    else (time.fromisoformat(row["start_time"]) if row["start_time"] else None)
                ),
                end_time=(
                    updates.end_time if updates.end_time is not None
                    else (time.fromisoformat(row["end_time"]) if row["end_time"] else None)
                ),
                recurrence=(
                    updates.recurrence if updates.recurrence is not None
                    else RecurrenceType(row["recurrence"])
                ),
                recurrence_end_date=(
                    updates.recurrence_end_date if updates.recurrence_end_date is not None
                    else (date.fromisoformat(row["recurrence_end_date"]) if row["recurrence_end_date"] else None)
                ),
                pin_priority=(
                    updates.pin_priority if updates.pin_priority is not None
                    else row["pin_priority"]
                ),
                explicit_position=(
                    updates.explicit_position if updates.explicit_position is not None
                    else row["explicit_position"]
                ),
                title=updates.title if updates.title is not None else row["title"],
                color=updates.color if updates.color is not None else row["color"],
            )

    await db.save_window(schedule_window)
    return {"message": "Window updated"}


@app.delete("/api/windows/{window_id}")
async def delete_window(window_id: str):
    """Delete a schedule window."""
    await db.delete_window(window_id)
    return {"message": "Window deleted"}


@app.get("/api/collections/{collection_id}/windows")
async def get_collection_windows(collection_id: str):
    """Get all schedule windows for a collection."""
    windows = await db.get_windows_for_collection(collection_id)
    return {
        "windows": [
            {
                "id": w.id,
                "collection_id": w.collection_id,
                "start_date": w.start_date.isoformat(),
                "end_date": w.end_date.isoformat(),
                "start_time": w.start_time.isoformat() if w.start_time else None,
                "end_time": w.end_time.isoformat() if w.end_time else None,
                "recurrence": w.recurrence.value,
                "recurrence_end_date": w.recurrence_end_date.isoformat() if w.recurrence_end_date else None,
                "pin_priority": w.pin_priority,
                "explicit_position": w.explicit_position,
                "title": w.title,
                "color": w.color,
            }
            for w in windows
        ]
    }


# ================== Base Order ==================

class BaseOrderUpdate(BaseModel):
    collection_ids: list[str]


@app.get("/api/libraries/{section_id}/base-order")
async def get_base_order(section_id: str):
    """Get the base ordering for a library."""
    order = await db.get_base_order(section_id)
    return {"order": order}


@app.put("/api/libraries/{section_id}/base-order")
async def update_base_order(section_id: str, update: BaseOrderUpdate):
    """Update the base ordering for a library."""
    await db.save_base_order(section_id, update.collection_ids)
    return {"message": "Base order updated"}


# ================== Snapshots & Preview ==================

@app.get("/api/libraries/{section_id}/snapshot")
async def get_snapshot(
    section_id: str,
    at: Optional[str] = Query(None, description="ISO datetime, defaults to now")
):
    """
    Compute and return the home stack snapshot at a specific time.

    Uses Layout Blocks model:
    - Finds active LayoutBlock where start_at <= time < end_at
    - If no active block: returns "no_active_block" (dead time)
    - If active: returns the block's items as the desired state
    """
    try:
        if at:
            target_time = datetime.fromisoformat(at)
        else:
            target_time = datetime.now()

        # Find active layout block at the given time
        active_block = await get_active_layout_block(section_id, target_time)

        if not active_block:
            # Dead time - no active block
            return {
                "timestamp": target_time.isoformat(),
                "library_section_id": section_id,
                "no_active_block": True,
                "message": "No active layout block at this time (dead time)",
                "visible_collections": [],
                "hidden_collections": [],
            }

        # Get current Plex hubs for title lookups (hub_identifier -> title)
        current_state = await plex_client.get_managed_hubs(section_id)
        hub_title_map = {hub.hub_identifier: hub.title for hub in current_state.hubs}

        # Build visible collections from block items
        visible_collections = []
        for item in active_block.items or []:
            # Look up title from Plex hubs using hub_identifier
            title = hub_title_map.get(item.collection_id, item.collection_id)
            source = "plex"

            visible_collections.append({
                "collection_id": item.collection_id,
                "title": title,
                "position": item.order_index,
                "source": source,
                "active_window_id": None,
                "active_block_id": active_block.id,
                "active_block_name": active_block.name,
                "pin_priority": None,
                "zone": "normal",
                "visible_home": item.visible_home,
                "visible_shared_home": item.visible_shared_home,
                "visible_shared_friends": item.visible_shared_friends,
            })

        return {
            "timestamp": target_time.isoformat(),
            "library_section_id": section_id,
            "no_active_block": False,
            "active_block_id": active_block.id,
            "active_block_name": active_block.name,
            "active_block_start": active_block.start_at.isoformat(),
            "active_block_end": active_block.end_at.isoformat(),
            "visible_collections": visible_collections,
            "hidden_collections": [],
        }
    except Exception as e:
        logger.error(f"Failed to compute snapshot: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/libraries/{section_id}/next-changes")
async def get_next_changes(
    section_id: str,
    limit: int = Query(5, ge=1, le=20),
    hours: int = Query(168, ge=1, le=720),  # Default 1 week
):
    """Get the next N schedule boundary times."""
    try:
        collections = await db.get_collections_for_library(section_id)
        evaluator = ScheduleEvaluator(collections)

        now = datetime.now()
        end_time = now + timedelta(hours=hours)

        boundaries = evaluator.get_schedule_boundaries(section_id, now, end_time, limit)

        return {
            "boundaries": [b.isoformat() for b in boundaries],
            "count": len(boundaries),
        }
    except Exception as e:
        logger.error(f"Failed to get next changes: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ================== Diff & Apply ==================

@app.get("/api/libraries/{section_id}/diff")
async def get_diff(
    section_id: str,
    at: Optional[str] = Query(None, description="ISO datetime, defaults to now")
):
    """
    Compute the diff between current Plex state and target Layout Block.

    Uses Layout Blocks model:
    - If no active block at target time: returns 0 changes (dead time)
    - If active block: compares current Plex state to block's desired state
    """
    try:
        if at:
            target_time = datetime.fromisoformat(at)
        else:
            target_time = datetime.now()

        # Find active layout block at the given time
        active_block = await get_active_layout_block(section_id, target_time)

        if not active_block:
            # Dead time - no active block, no changes to apply
            return {
                "computed_at": datetime.now().isoformat(),
                "target_time": target_time.isoformat(),
                "library_section_id": section_id,
                "no_active_block": True,
                "message": "No active layout block at this time (dead time). No changes will be applied.",
                "visibility_changes": [],
                "order_changes": [],
                "total_changes": 0,
                "has_conflicts": False,
                "conflict_messages": [],
            }

        if not active_block.items:
            # Block exists but has no items configured
            return {
                "computed_at": datetime.now().isoformat(),
                "target_time": target_time.isoformat(),
                "library_section_id": section_id,
                "no_active_block": False,
                "active_block_id": active_block.id,
                "active_block_name": active_block.name,
                "message": "Active block has no items configured.",
                "visibility_changes": [],
                "order_changes": [],
                "total_changes": 0,
                "has_conflicts": False,
                "conflict_messages": [],
            }

        # Get current Plex state
        current_state = await plex_client.get_managed_hubs(section_id)

        # Build current state maps
        # Map hub_identifier -> (promoted, position among promoted hubs, hub object)
        current_hubs = {}
        promoted_position = 0
        for hub in current_state.hubs:
            position = promoted_position if hub.promoted else -1
            if hub.promoted:
                promoted_position += 1
            current_hubs[hub.hub_identifier] = {
                "promoted": hub.promoted,
                "position": position,  # Position among promoted hubs only (-1 if not promoted)
                "hub": hub,
                "promoted_to_recommended": hub.promoted_to_recommended,
                "promoted_to_own_home": hub.promoted_to_own_home,
                "promoted_to_shared_home": hub.promoted_to_shared_home,
            }

        # Also build a map by collection title for fallback matching
        current_hubs_by_title = {}
        for hub in current_state.hubs:
            current_hubs_by_title[hub.title] = hub.hub_identifier

        # Compare current state to block's desired state
        visibility_changes = []
        order_changes = []

        # Build list of desired promoted hubs in order (only visible items)
        # This is the target order for Plex's promoted hub list
        desired_promoted_order = []  # List of (hub_id, item) tuples
        desired_promoted_hubs = set()

        # Track collections that can't be managed (not in Plex managed hubs)
        unmanaged_collections = []

        for item in active_block.items:
            # Find the hub identifier for this collection
            hub_id = None

            # Method 1: Direct match - collection_id should BE the hub_identifier
            if item.collection_id in current_hubs:
                hub_id = item.collection_id

            # Method 2: Find by collection ID in hub_key (legacy support)
            if not hub_id:
                for h in current_state.hubs:
                    if f"collections/{item.collection_id}" in h.hub_key:
                        hub_id = h.hub_identifier
                        break

            if not hub_id:
                # This collection is not in Plex's managed hubs list
                # It needs to be promoted via Plex UI first
                logger.warning(f"Could not find hub for collection_id={item.collection_id}")
                unmanaged_collections.append({
                    "collection_id": item.collection_id,
                    "reason": "Not in Plex managed hubs. Must be promoted via Plex UI first."
                })
                continue

            current_hub = current_hubs.get(hub_id)
            if not current_hub:
                continue

            title = current_hub["hub"].title
            hub = current_hub["hub"]

            # Compare individual visibility flags (corrected mapping)
            # visible_home -> promotedToOwnHome (controls YOUR home)
            # visible_shared_home -> promotedToSharedHome
            # visible_shared_friends -> promotedToRecommended
            vis_changed = (
                hub.promoted_to_own_home != item.visible_home or
                hub.promoted_to_shared_home != item.visible_shared_home or
                hub.promoted_to_recommended != item.visible_shared_friends
            )

            if vis_changed:
                # Summarize as "home" if visible_home is true, "hidden" otherwise
                from_state = "home" if hub.promoted_to_own_home else "hidden"
                to_state = "home" if item.visible_home else "hidden"
                visibility_changes.append({
                    "collection_id": item.collection_id,
                    "hub_identifier": hub_id,
                    "title": title,
                    "from": from_state,
                    "to": to_state,
                })

            # Only add to promoted order if visible_home is true
            # (promotedToOwnHome controls whether it appears on YOUR home)
            if item.visible_home:
                desired_promoted_order.append((hub_id, item, title))
                desired_promoted_hubs.add(hub_id)

        # Check order changes by comparing desired promoted order to current
        for desired_pos, (hub_id, item, title) in enumerate(desired_promoted_order):
            current_hub = current_hubs.get(hub_id)
            if current_hub:
                current_pos = current_hub["position"]
                if current_pos != desired_pos:
                    order_changes.append({
                        "collection_id": item.collection_id,
                        "hub_identifier": hub_id,
                        "title": title,
                        "from_position": current_pos,
                        "to_position": desired_pos,
                    })

        # Check for items currently promoted but not in the block (should be hidden)
        # Track hubs we've already processed to avoid duplicates
        processed_hub_ids = {item.collection_id for item in active_block.items if item.collection_id}
        for hub_id, hub_info in current_hubs.items():
            if hub_info["promoted"] and hub_id not in desired_promoted_hubs and hub_id not in processed_hub_ids:
                # This hub is promoted in Plex but not in our block - should be hidden
                hub = hub_info["hub"]
                visibility_changes.append({
                    "collection_id": None,
                    "hub_identifier": hub_id,
                    "title": hub.title,
                    "from": "home",
                    "to": "hidden",
                })

        total_changes = len(visibility_changes) + (1 if order_changes else 0)

        # Build warnings for unmanaged collections
        warnings = []
        if unmanaged_collections:
            for uc in unmanaged_collections:
                warnings.append(
                    f"Collection '{uc['collection_id']}' cannot be managed: {uc['reason']}"
                )

        return {
            "computed_at": datetime.now().isoformat(),
            "target_time": target_time.isoformat(),
            "library_section_id": section_id,
            "no_active_block": False,
            "active_block_id": active_block.id,
            "active_block_name": active_block.name,
            "visibility_changes": visibility_changes,
            "order_changes": order_changes,
            "total_changes": total_changes,
            "has_conflicts": False,
            "conflict_messages": [],
            "unmanaged_collections": unmanaged_collections,
            "warnings": warnings,
        }
    except Exception as e:
        logger.error(f"Failed to compute diff: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/libraries/{section_id}/apply")
async def apply_changes(section_id: str):
    """
    Apply the active Layout Block's state to Plex.

    Uses Layout Blocks model:
    - Finds active LayoutBlock at current time
    - If no active block: returns 409 (dead time - cannot apply)
    - If active: applies the block's visibility and order to Plex
    - Creates rollback snapshot before applying
    - Verifies reorder succeeded
    """
    if settings.apply_mode == "dry-run":
        raise HTTPException(
            status_code=403,
            detail="Cannot apply changes in dry-run mode. Set APPLY_MODE=apply to enable."
        )

    try:
        now = datetime.now()

        # Find active layout block
        active_block = await get_active_layout_block(section_id, now)

        if not active_block:
            # Dead time - no active block
            raise HTTPException(
                status_code=409,
                detail="No active layout block at this time (dead time). Cannot apply changes."
            )

        if not active_block.items:
            # Block has no items
            raise HTTPException(
                status_code=409,
                detail=f"Layout block '{active_block.name}' has no items configured. Cannot apply."
            )

        # Get current state for rollback snapshot
        current_state = await plex_client.get_managed_hubs(section_id)

        # Create rollback snapshot
        rollback = RollbackSnapshot(
            id=str(uuid.uuid4()),
            created_at=now,
            library_section_id=section_id,
            hub_order=current_state.hub_order,
            hub_visibility={
                h.hub_identifier: {
                    "own_home": h.promoted_to_own_home,
                    "shared_home": h.promoted_to_shared_home,
                    "recommended": h.promoted_to_recommended,
                }
                for h in current_state.hubs
            },
            note=f"Pre-apply snapshot for block '{active_block.name}' at {now.isoformat()}",
        )
        await db.save_rollback_snapshot(rollback)

        # Get collections for lookups
        collections = await db.get_collections_for_library(section_id)
        collection_map = {c.id: c for c in collections}

        # Build current state maps
        current_hubs_by_title = {}
        for hub in current_state.hubs:
            current_hubs_by_title[hub.title] = hub

        # Initialize result
        result = ApplyResult(
            success=True,
            timestamp=now,
            library_section_id=section_id,
            before_order=current_state.hub_order,
            desired_order=[item.collection_id for item in active_block.items],
        )

        # Build list of desired hub identifiers and their promoted state
        desired_hub_order = []
        hub_visibility_changes = []

        # Track which hubs should be promoted
        desired_promoted_hubs = set()

        # Track hub creation results
        hubs_created = []
        hubs_creation_failed = []

        # Track unmanaged collections (not in Plex managed hubs)
        unmanaged_collections = []

        # Helper to extract ratingKey from collection_id
        def extract_rating_key(collection_id: str) -> str:
            """Extract the ratingKey from a collection_id.
            'custom.collection.3.138563' -> '138563'
            '138563' -> '138563'
            """
            if '.' in collection_id:
                parts = collection_id.split('.')
                return parts[-1]
            return collection_id

        for item in active_block.items:
            collection = collection_map.get(item.collection_id)
            hub_id = None
            hub = None

            # Method 1: Direct match - collection_id might BE the hub_identifier
            for h in current_state.hubs:
                if h.hub_identifier == item.collection_id:
                    hub_id = h.hub_identifier
                    hub = h
                    break

            # Method 2: Find hub by collection ID in hub_key
            if not hub_id:
                for h in current_state.hubs:
                    if f"collections/{item.collection_id}" in h.hub_key:
                        hub_id = h.hub_identifier
                        hub = h
                        break

            # Method 3: Fallback - find by title
            if not hub_id and collection:
                hub = current_hubs_by_title.get(collection.title)
                if hub:
                    hub_id = hub.hub_identifier

            # If hub not found and ANY visibility flag is ON, attempt first-time promotion
            if not hub_id:
                needs_promotion = item.visible_home or item.visible_shared_home or item.visible_shared_friends
                title = collection.title if collection else item.collection_id

                if needs_promotion:
                    # Extract ratingKey for the POST call
                    rating_key = extract_rating_key(item.collection_id)

                    # Skip non-collection items (built-in hubs like tv.recentlyadded)
                    if not rating_key.isdigit():
                        logger.info(f"Skipping non-collection hub {item.collection_id} - cannot create")
                        continue

                    logger.info(f"Attempting first-time promotion for collection '{title}' (ratingKey={rating_key})")

                    # Attempt to create the hub
                    success, error_msg, created_hub_id = await plex_client.create_hub(
                        section_id,
                        rating_key,
                        item.visible_home,
                        item.visible_shared_home,
                        item.visible_shared_friends,
                    )

                    if success and created_hub_id:
                        logger.info(f"Successfully created hub {created_hub_id} for '{title}'")
                        hubs_created.append({
                            "collection_id": item.collection_id,
                            "hub_identifier": created_hub_id,
                            "title": title,
                        })
                        hub_id = created_hub_id
                        # Re-fetch the hub object for visibility comparison
                        # (visibility was already set during creation, so no change needed)
                        hub = None  # Will skip visibility change check since we just set it
                    else:
                        logger.error(f"Failed to create hub for '{title}': {error_msg}")
                        hubs_creation_failed.append({
                            "collection_id": item.collection_id,
                            "title": title,
                            "error": error_msg,
                        })
                        unmanaged_collections.append({
                            "collection_id": item.collection_id,
                            "title": title,
                            "reason": f"First-time promotion failed: {error_msg}"
                        })
                        continue  # Skip this item
                else:
                    # Collection not in managed hubs and no visibility requested
                    # This is fine - nothing to do
                    logger.debug(f"Collection '{title}' not in managed hubs and no visibility requested - skipping")
                    continue

            if hub_id:
                # Only add to order if visible_home is true
                # promotedToOwnHome controls whether item appears on YOUR home (the promoted order)
                if item.visible_home:
                    desired_hub_order.append(hub_id)
                    desired_promoted_hubs.add(hub_id)

                # Check if any visibility flag needs to change
                # Compare individual flags against Plex's actual flags
                if hub:
                    # Check if visibility flags need to change
                    # Mapping: visible_home -> promotedToOwnHome, visible_shared_home -> promotedToSharedHome
                    needs_change = (
                        hub.promoted_to_own_home != item.visible_home or
                        hub.promoted_to_shared_home != item.visible_shared_home or
                        hub.promoted_to_recommended != item.visible_shared_friends
                    )
                    if needs_change:
                        hub_visibility_changes.append({
                            "hub_id": hub_id,
                            "title": hub.title,
                            "visible_home": item.visible_home,
                            "visible_shared_home": item.visible_shared_home,
                            "visible_shared_friends": item.visible_shared_friends,
                        })

        # Find hubs that should be hidden (currently promoted but not in block)
        for hub in current_state.hubs:
            if hub.promoted and hub.hub_identifier not in desired_promoted_hubs:
                hub_visibility_changes.append({
                    "hub_id": hub.hub_identifier,
                    "title": hub.title,
                    "visible_home": False,
                    "visible_shared_home": False,
                    "visible_shared_friends": False,
                })

        # Apply visibility changes with correct Plex parameters and verification
        for change in hub_visibility_changes:
            success, error_msg = await plex_client.set_hub_visibility(
                section_id,
                change["hub_id"],
                change["visible_home"],
                change["visible_shared_home"],
                change["visible_shared_friends"],
            )
            if success:
                result.visibility_applied += 1
            else:
                result.visibility_failed += 1
                result.error_messages.append(
                    f"Failed to set visibility for {change['title']}: {error_msg}"
                )

        # Apply reorder
        if desired_hub_order:
            reorder_result = await plex_client.reorder_hubs_with_verify(
                section_id,
                desired_hub_order
            )

            result.order_applied = True
            result.order_verified = reorder_result.success
            result.reorder_attempts = reorder_result.attempts
            result.after_order = reorder_result.after_order

            if not reorder_result.success:
                result.success = False
                result.error_messages.append(reorder_result.error_message or "Reorder verification failed")
                result.warnings.append(
                    "Plex may not have applied the reorder. "
                    "You may need to manually adjust the order in Plex."
                )

        # Add warnings for unmanaged collections
        if unmanaged_collections:
            for uc in unmanaged_collections:
                result.warnings.append(
                    f"Collection '{uc['title']}' could not be managed: {uc['reason']}"
                )

        return {
            "success": result.success,
            "timestamp": result.timestamp.isoformat(),
            "library_section_id": result.library_section_id,
            "active_block_id": active_block.id,
            "active_block_name": active_block.name,
            # Hub creation results (first-time promotion)
            "hubs_created": len(hubs_created),
            "hubs_creation_failed": len(hubs_creation_failed),
            "created_hubs": hubs_created,
            "failed_creations": hubs_creation_failed,
            # Visibility results
            "visibility_applied": result.visibility_applied,
            "visibility_failed": result.visibility_failed,
            # Order results
            "order_applied": result.order_applied,
            "order_verified": result.order_verified,
            "reorder_attempts": result.reorder_attempts,
            "before_order": result.before_order,
            "after_order": result.after_order,
            "desired_order": result.desired_order,
            # Errors and warnings
            "error_messages": result.error_messages,
            "warnings": result.warnings,
            "unmanaged_collections": unmanaged_collections,
            "rollback_snapshot_id": rollback.id,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to apply changes: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ================== Rollback ==================

@app.get("/api/libraries/{section_id}/rollback-snapshots")
async def get_rollback_snapshots(section_id: str, limit: int = Query(10, ge=1, le=50)):
    """Get recent rollback snapshots for a library."""
    snapshots = await db.get_rollback_snapshots(section_id, limit)
    return {
        "snapshots": [
            {
                "id": s.id,
                "library_section_id": s.library_section_id,
                "hub_order": s.hub_order,
                "hub_visibility": s.hub_visibility,
                "note": s.note,
                "created_at": s.created_at.isoformat(),
            }
            for s in snapshots
        ]
    }


@app.post("/api/libraries/{section_id}/rollback/{snapshot_id}")
async def rollback_to_snapshot(section_id: str, snapshot_id: str):
    """
    Restore Plex to a previous snapshot state.

    1. Load snapshot from database
    2. Apply hub order from snapshot
    3. Apply visibility settings from snapshot
    4. Verify changes
    5. Return result
    """
    if settings.apply_mode == "dry-run":
        raise HTTPException(status_code=400, detail="Cannot rollback in dry-run mode")

    # Get the snapshot
    snapshot = await get_rollback_snapshot(snapshot_id)
    if not snapshot:
        raise HTTPException(status_code=404, detail="Rollback snapshot not found")

    if snapshot.library_section_id != section_id:
        raise HTTPException(status_code=400, detail="Snapshot does not belong to this library")

    now = datetime.now()
    logger.info(f"Rolling back library {section_id} to snapshot {snapshot_id}")

    # Get current state for comparison
    current_state = await plex_client.get_managed_hubs(section_id)
    current_hubs_by_id = {h.hub_identifier: h for h in current_state.hubs}

    # Create a rollback snapshot of current state (before rollback)
    pre_rollback_snapshot = RollbackSnapshot(
        id=str(uuid.uuid4()),
        created_at=now,
        library_section_id=section_id,
        hub_order=[h.hub_identifier for h in current_state.hubs],
        hub_visibility={
                h.hub_identifier: {
                    "own_home": h.promoted_to_own_home,
                    "shared_home": h.promoted_to_shared_home,
                    "recommended": h.promoted_to_recommended,
                }
                for h in current_state.hubs
            },
        note=f"Pre-rollback snapshot at {now.isoformat()} (rolling back to {snapshot_id})",
    )
    await db.save_rollback_snapshot(pre_rollback_snapshot)

    visibility_applied = 0
    visibility_failed = 0
    order_applied = False
    errors = []

    # Apply visibility settings from snapshot
    for hub_id, visibility_flags in snapshot.hub_visibility.items():
        if hub_id not in current_hubs_by_id:
            logger.warning(f"Hub {hub_id} not found in current state, skipping")
            continue

        current_hub = current_hubs_by_id[hub_id]

        # Handle both old format (bool) and new format (dict)
        if isinstance(visibility_flags, bool):
            # Old snapshot format - single boolean
            target_own = target_shared = target_rec = visibility_flags
        else:
            # New snapshot format - dict with three flags
            target_own = visibility_flags.get("own_home", False)
            target_shared = visibility_flags.get("shared_home", False)
            target_rec = visibility_flags.get("recommended", False)

        # Check if any visibility differs
        if (current_hub.promoted_to_own_home != target_own or
            current_hub.promoted_to_shared_home != target_shared or
            current_hub.promoted_to_recommended != target_rec):
            try:
                success, error_msg = await plex_client.set_hub_visibility(
                    section_id,
                    hub_id,
                    visible_home=target_own,
                    visible_shared_home=target_shared,
                    visible_shared_friends=target_rec,
                )
                if success:
                    visibility_applied += 1
                else:
                    logger.error(f"Failed to set visibility for {hub_id}: {error_msg}")
                    visibility_failed += 1
                    errors.append(f"Failed to update {hub_id}: {error_msg}")
            except Exception as e:
                logger.error(f"Failed to update visibility for {hub_id}: {e}")
                visibility_failed += 1
                errors.append(f"Failed to update {hub_id}: {str(e)}")

    # Apply order from snapshot
    if snapshot.hub_order:
        try:
            # Filter to only include hubs that currently exist
            order_to_apply = [
                hub_id for hub_id in snapshot.hub_order
                if hub_id in current_hubs_by_id
            ]

            if order_to_apply:
                reorder_result = await plex_client.reorder_hubs_with_verify(
                    section_id, order_to_apply
                )
                if reorder_result.success:
                    order_applied = True
                else:
                    errors.append(f"Reorder failed: {reorder_result.error_message}")
        except Exception as e:
            logger.error(f"Failed to apply hub order: {e}")
            errors.append(f"Failed to apply order: {str(e)}")

    success = visibility_failed == 0 and not errors

    return {
        "success": success,
        "timestamp": now.isoformat(),
        "library_section_id": section_id,
        "snapshot_id": snapshot_id,
        "visibility_applied": visibility_applied,
        "visibility_failed": visibility_failed,
        "order_applied": order_applied,
        "errors": errors,
        "pre_rollback_snapshot_id": pre_rollback_snapshot.id,
    }


# ================== Apply If Needed (Internal) ==================

async def apply_if_needed_internal(section_id: str) -> ApplyIfNeededResult:
    """
    Internal function to check if Plex needs to be synced and apply changes if needed.

    This is idempotent and safe to call repeatedly. It:
    1. Finds active block for current time
    2. If no active block -> returns NO_ACTIVE_BLOCK (do nothing)
    3. Computes diff vs current Plex state
    4. If no diff -> returns IN_SYNC
    5. If diff exists -> applies changes, returns APPLIED

    Returns:
        ApplyIfNeededResult with status and details
    """
    now = datetime.now()

    try:
        # Find active layout block
        active_block = await get_active_layout_block(section_id, now)

        if not active_block:
            # No active block - this is fine, just don't do anything
            return ApplyIfNeededResult(
                status=SyncResultStatus.NO_ACTIVE_BLOCK,
                library_section_id=section_id,
                checked_at=now,
            )

        if not active_block.items:
            # Block has no items - treat as no changes needed
            return ApplyIfNeededResult(
                status=SyncResultStatus.IN_SYNC,
                library_section_id=section_id,
                checked_at=now,
                active_block_id=active_block.id,
                active_block_name=active_block.name,
            )

        # Get current Plex state
        current_state = await plex_client.get_managed_hubs(section_id)

        # Build maps for comparison
        current_hubs_by_id = {h.hub_identifier: h for h in current_state.hubs}
        current_hubs_by_title = {h.title: h for h in current_state.hubs}

        # Get collections for lookups
        collections = await db.get_collections_for_library(section_id)
        collection_map = {c.id: c for c in collections}

        # Track what needs to change
        visibility_changes_needed = []
        desired_hub_order = []
        desired_promoted_hubs = set()

        # Helper to extract ratingKey
        def extract_rating_key(collection_id: str) -> str:
            if '.' in collection_id:
                return collection_id.split('.')[-1]
            return collection_id

        # Process each block item
        for item in active_block.items:
            collection = collection_map.get(item.collection_id)
            hub_id = None
            hub = None

            # Find hub by collection_id (direct match)
            if item.collection_id in current_hubs_by_id:
                hub_id = item.collection_id
                hub = current_hubs_by_id[item.collection_id]
            # Find hub by hub_key
            if not hub_id:
                for h in current_state.hubs:
                    if f"collections/{item.collection_id}" in h.hub_key:
                        hub_id = h.hub_identifier
                        hub = h
                        break
            # Find hub by title
            if not hub_id and collection:
                hub = current_hubs_by_title.get(collection.title)
                if hub:
                    hub_id = hub.hub_identifier

            if not hub_id:
                # Hub not in managed list - may need first-time promotion
                needs_promotion = item.visible_home or item.visible_shared_home or item.visible_shared_friends
                if needs_promotion:
                    rating_key = extract_rating_key(item.collection_id)
                    if rating_key.isdigit():
                        visibility_changes_needed.append({
                            "type": "create",
                            "collection_id": item.collection_id,
                            "rating_key": rating_key,
                            "visible_home": item.visible_home,
                            "visible_shared_home": item.visible_shared_home,
                            "visible_shared_friends": item.visible_shared_friends,
                        })
                continue

            # Track desired order
            if item.visible_home:
                desired_hub_order.append(hub_id)
                desired_promoted_hubs.add(hub_id)

            # Check visibility changes
            if hub:
                needs_vis_change = (
                    hub.promoted_to_own_home != item.visible_home or
                    hub.promoted_to_shared_home != item.visible_shared_home or
                    hub.promoted_to_recommended != item.visible_shared_friends
                )
                if needs_vis_change:
                    visibility_changes_needed.append({
                        "type": "update",
                        "hub_id": hub_id,
                        "title": hub.title,
                        "visible_home": item.visible_home,
                        "visible_shared_home": item.visible_shared_home,
                        "visible_shared_friends": item.visible_shared_friends,
                    })

        # Check for hubs that need to be hidden
        for hub in current_state.hubs:
            if hub.promoted and hub.hub_identifier not in desired_promoted_hubs:
                visibility_changes_needed.append({
                    "type": "update",
                    "hub_id": hub.hub_identifier,
                    "title": hub.title,
                    "visible_home": False,
                    "visible_shared_home": False,
                    "visible_shared_friends": False,
                })

        # Check order changes
        current_promoted_order = [h for h in current_state.hub_order if h in desired_promoted_hubs]
        order_changed = current_promoted_order != desired_hub_order

        # If no changes needed, return IN_SYNC
        if not visibility_changes_needed and not order_changed:
            return ApplyIfNeededResult(
                status=SyncResultStatus.IN_SYNC,
                library_section_id=section_id,
                checked_at=now,
                active_block_id=active_block.id,
                active_block_name=active_block.name,
            )

        # Changes needed - apply them
        logger.info(f"Sync needed for library {section_id}: {len(visibility_changes_needed)} visibility changes, order_changed={order_changed}")

        # Create rollback snapshot
        rollback = RollbackSnapshot(
            id=str(uuid.uuid4()),
            created_at=now,
            library_section_id=section_id,
            hub_order=current_state.hub_order,
            hub_visibility={
                h.hub_identifier: {
                    "own_home": h.promoted_to_own_home,
                    "shared_home": h.promoted_to_shared_home,
                    "recommended": h.promoted_to_recommended,
                }
                for h in current_state.hubs
            },
            note=f"Auto-sync snapshot for block '{active_block.name}' at {now.isoformat()}",
        )
        await db.save_rollback_snapshot(rollback)

        # Apply visibility changes
        visibility_applied = 0
        for change in visibility_changes_needed:
            if change["type"] == "create":
                success, error, created_hub = await plex_client.create_hub(
                    section_id,
                    change["rating_key"],
                    change["visible_home"],
                    change["visible_shared_home"],
                    change["visible_shared_friends"],
                )
                if success:
                    visibility_applied += 1
                    # Add to order if visible_home
                    if change["visible_home"] and created_hub:
                        desired_hub_order.append(created_hub)
            else:
                success, error = await plex_client.set_hub_visibility(
                    section_id,
                    change["hub_id"],
                    change["visible_home"],
                    change["visible_shared_home"],
                    change["visible_shared_friends"],
                )
                if success:
                    visibility_applied += 1

        # Apply order changes
        order_applied = 0
        if desired_hub_order:
            reorder_result = await plex_client.reorder_hubs_with_verify(section_id, desired_hub_order)
            if reorder_result.success:
                order_applied = 1

        return ApplyIfNeededResult(
            status=SyncResultStatus.APPLIED,
            library_section_id=section_id,
            checked_at=now,
            active_block_id=active_block.id,
            active_block_name=active_block.name,
            changes_applied=visibility_applied + order_applied,
            visibility_changes=visibility_applied,
            order_changes=order_applied,
            rollback_snapshot_id=rollback.id,
        )

    except Exception as e:
        logger.error(f"apply_if_needed failed for library {section_id}: {e}")
        return ApplyIfNeededResult(
            status=SyncResultStatus.ERROR,
            library_section_id=section_id,
            checked_at=now,
            error_message=str(e),
        )


# ================== Sync Settings ==================

@app.get("/api/libraries/{section_id}/sync-settings")
async def get_sync_settings(section_id: str):
    """Get sync settings for a library."""
    settings = await get_library_sync_settings(section_id)
    if not settings:
        # Return defaults if not configured yet
        return {
            "library_section_id": section_id,
            "sync_enabled": False,
            "interval_minutes": 60,
            "last_checked_at": None,
            "last_applied_at": None,
            "last_result": None,
            "last_error": None,
        }
    return {
        "library_section_id": settings.library_section_id,
        "sync_enabled": settings.sync_enabled,
        "interval_minutes": settings.interval_minutes,
        "last_checked_at": settings.last_checked_at.isoformat() if settings.last_checked_at else None,
        "last_applied_at": settings.last_applied_at.isoformat() if settings.last_applied_at else None,
        "last_result": settings.last_result.value if settings.last_result else None,
        "last_error": settings.last_error,
    }


@app.put("/api/libraries/{section_id}/sync-settings")
async def update_sync_settings(section_id: str, update: LibrarySyncSettingsUpdate):
    """Update sync settings for a library."""
    # Get existing or create new
    existing = await get_library_sync_settings(section_id)
    if existing:
        # Update only provided fields
        new_settings = LibrarySyncSettings(
            library_section_id=section_id,
            sync_enabled=update.sync_enabled if update.sync_enabled is not None else existing.sync_enabled,
            interval_minutes=update.interval_minutes if update.interval_minutes is not None else existing.interval_minutes,
            last_checked_at=existing.last_checked_at,
            last_applied_at=existing.last_applied_at,
            last_result=existing.last_result,
            last_error=existing.last_error,
        )
    else:
        # Create new with defaults
        new_settings = LibrarySyncSettings(
            library_section_id=section_id,
            sync_enabled=update.sync_enabled if update.sync_enabled is not None else False,
            interval_minutes=update.interval_minutes if update.interval_minutes is not None else 60,
        )

    await upsert_library_sync_settings(new_settings)
    logger.info(f"Updated sync settings for library {section_id}: enabled={new_settings.sync_enabled}, interval={new_settings.interval_minutes}min")

    return {
        "library_section_id": new_settings.library_section_id,
        "sync_enabled": new_settings.sync_enabled,
        "interval_minutes": new_settings.interval_minutes,
        "last_checked_at": new_settings.last_checked_at.isoformat() if new_settings.last_checked_at else None,
        "last_applied_at": new_settings.last_applied_at.isoformat() if new_settings.last_applied_at else None,
        "last_result": new_settings.last_result.value if new_settings.last_result else None,
        "last_error": new_settings.last_error,
    }


@app.post("/api/libraries/{section_id}/sync-now")
async def trigger_sync_now(section_id: str):
    """
    Manually trigger a sync check for a library.
    This calls apply-if-needed and returns the result.
    """
    result = await apply_if_needed_internal(section_id)
    return {
        "status": result.status.value,
        "library_section_id": result.library_section_id,
        "checked_at": result.checked_at.isoformat(),
        "active_block_id": result.active_block_id,
        "active_block_name": result.active_block_name,
        "changes_applied": result.changes_applied,
        "visibility_changes": result.visibility_changes,
        "order_changes": result.order_changes,
        "error_message": result.error_message,
        "rollback_snapshot_id": result.rollback_snapshot_id,
    }


# ================== Scheduler Control ==================

@app.get("/api/scheduler/status")
async def get_scheduler_status():
    """Get the current status of the background scheduler."""
    return {
        "running": scheduler.running,
    }


@app.post("/api/scheduler/start")
async def start_scheduler():
    """Start the background scheduler."""
    await scheduler.start()
    return {"status": "started", "running": scheduler.running}


@app.post("/api/scheduler/stop")
async def stop_scheduler():
    """Stop the background scheduler."""
    await scheduler.stop()
    return {"status": "stopped", "running": scheduler.running}


# ================== Window Groups ==================

@app.get("/api/libraries/{section_id}/window-groups")
async def get_library_window_groups(section_id: str):
    """Get all window groups for a library."""
    groups = await get_window_groups_for_library(section_id)
    return {
        "window_groups": [
            {
                "id": g.id,
                "library_section_id": g.library_section_id,
                "name": g.name,
                "start_at": g.start_at.isoformat(),
                "end_at": g.end_at.isoformat(),
                "recurrence_rule": g.recurrence_rule,
                "priority": g.priority,
                "color": g.color,
            }
            for g in groups
        ]
    }


@app.post("/api/window-groups")
async def create_window_group(group: WindowGroupCreate):
    """Create a new window group."""
    group_id = str(uuid.uuid4())
    window_group = WindowGroup(
        id=group_id,
        library_section_id=group.library_section_id,
        name=group.name,
        start_at=group.start_at,
        end_at=group.end_at,
        recurrence_rule=group.recurrence_rule,
        priority=group.priority,
        color=group.color,
    )
    await save_window_group(window_group)
    return {"id": group_id, "message": "Window group created"}


@app.put("/api/window-groups/{group_id}")
async def update_window_group_endpoint(group_id: str, updates: WindowGroupUpdate):
    """Update a window group."""
    existing = await get_window_group(group_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Window group not found")

    updated = WindowGroup(
        id=group_id,
        library_section_id=existing.library_section_id,
        name=updates.name if updates.name is not None else existing.name,
        start_at=updates.start_at if updates.start_at is not None else existing.start_at,
        end_at=updates.end_at if updates.end_at is not None else existing.end_at,
        recurrence_rule=updates.recurrence_rule if updates.recurrence_rule is not None else existing.recurrence_rule,
        priority=updates.priority if updates.priority is not None else existing.priority,
        color=updates.color if updates.color is not None else existing.color,
    )
    await save_window_group(updated)
    return {"message": "Window group updated"}


@app.delete("/api/window-groups/{group_id}")
async def delete_window_group_endpoint(group_id: str):
    """Delete a window group."""
    await delete_window_group(group_id)
    return {"message": "Window group deleted"}


@app.get("/api/window-groups/{group_id}/windows")
async def get_windows_for_group(group_id: str):
    """Get all schedule windows in a window group."""
    # Query windows with this group_id
    async with db.aiosqlite.connect(db.DATABASE_PATH) as conn:
        conn.row_factory = db.aiosqlite.Row
        async with conn.execute(
            "SELECT * FROM schedule_windows WHERE window_group_id = ?",
            (group_id,)
        ) as cursor:
            rows = await cursor.fetchall()
            windows = []
            for row in rows:
                windows.append({
                    "id": row["id"],
                    "collection_id": row["collection_id"],
                    "zone": row["zone"] or "normal",
                    "pin_priority": row["pin_priority"],
                    "explicit_position": row["explicit_position"],
                })
            return {"windows": windows}


@app.get("/api/libraries/{section_id}/next-change")
async def get_next_change(
    section_id: str,
    from_time: Optional[str] = Query(None, alias="from", description="ISO datetime, defaults to now")
):
    """Get the next time the home stack will change."""
    try:
        if from_time:
            start = datetime.fromisoformat(from_time)
        else:
            start = datetime.now()

        collections = await db.get_collections_for_library(section_id)
        evaluator = ScheduleEvaluator(collections)

        next_change = evaluator.get_next_change_time(section_id, start)

        return {
            "from": start.isoformat(),
            "next_change": next_change.isoformat() if next_change else None,
        }
    except Exception as e:
        logger.error(f"Failed to get next change: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ================== Kometa ==================

@app.get("/api/kometa/collections")
async def get_kometa_collections():
    """Get all collections defined in Kometa config."""
    if not settings.kometa_config_path:
        return {"collections": [], "message": "Kometa path not configured"}

    try:
        scanner = KometaScanner(settings.kometa_config_path)
        collections = scanner.scan()

        return {
            "collections": [
                {
                    "name": c.name,
                    "file_path": c.file_path,
                    "file_name": c.file_name,
                    "sort_title": c.sort_title,
                    "collection_order": c.collection_order,
                    "visible_home": c.visible_home,
                    "visible_library": c.visible_library,
                    "schedule": c.schedule,
                    "template_name": c.template_name,
                }
                for c in collections
            ],
            "files": scanner.get_collection_files(),
        }
    except Exception as e:
        logger.error(f"Failed to scan Kometa config: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ================== Layout Blocks ==================

class LayoutBlockItemsUpdate(BaseModel):
    """Request body for bulk updating layout block items."""
    items: list[LayoutBlockItemSave]


@app.get("/api/libraries/{section_id}/layout-blocks")
async def list_layout_blocks(section_id: str):
    """List all layout blocks for a library."""
    try:
        blocks = await get_layout_blocks(section_id)
        return {
            "layout_blocks": [
                {
                    "id": b.id,
                    "library_section_id": b.library_section_id,
                    "name": b.name,
                    "start_at": b.start_at.isoformat(),
                    "end_at": b.end_at.isoformat(),
                    "created_at": b.created_at.isoformat() if b.created_at else None,
                    "updated_at": b.updated_at.isoformat() if b.updated_at else None,
                    "items_count": len(b.items),
                }
                for b in blocks
            ]
        }
    except Exception as e:
        logger.error(f"Failed to list layout blocks: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/libraries/{section_id}/layout-blocks")
async def create_layout_block_endpoint(section_id: str, data: LayoutBlockCreate):
    """Create a new layout block."""
    try:
        block_id = str(uuid.uuid4())
        block = await create_layout_block(
            block_id=block_id,
            library_section_id=section_id,
            name=data.name,
            start_at=data.start_at,
            end_at=data.end_at,
        )
        return {
            "id": block.id,
            "library_section_id": block.library_section_id,
            "name": block.name,
            "start_at": block.start_at.isoformat(),
            "end_at": block.end_at.isoformat(),
            "created_at": block.created_at.isoformat() if block.created_at else None,
            "updated_at": block.updated_at.isoformat() if block.updated_at else None,
            "message": "Layout block created",
        }
    except Exception as e:
        logger.error(f"Failed to create layout block: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/layout-blocks/{block_id}")
async def get_layout_block_endpoint(block_id: str):
    """Get a layout block by ID."""
    try:
        block = await get_layout_block(block_id)
        if not block:
            raise HTTPException(status_code=404, detail="Layout block not found")
        return {
            "id": block.id,
            "library_section_id": block.library_section_id,
            "name": block.name,
            "start_at": block.start_at.isoformat(),
            "end_at": block.end_at.isoformat(),
            "created_at": block.created_at.isoformat() if block.created_at else None,
            "updated_at": block.updated_at.isoformat() if block.updated_at else None,
            "items": [
                {
                    "id": item.id,
                    "block_id": item.block_id,
                    "collection_id": item.collection_id,
                    "order_index": item.order_index,
                    "visible_home": item.visible_home,
                    "visible_shared_home": item.visible_shared_home,
                    "visible_shared_friends": item.visible_shared_friends,
                    "created_at": item.created_at.isoformat() if item.created_at else None,
                    "updated_at": item.updated_at.isoformat() if item.updated_at else None,
                }
                for item in block.items
            ],
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get layout block: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.put("/api/layout-blocks/{block_id}")
async def update_layout_block_endpoint(block_id: str, data: LayoutBlockUpdate):
    """Update a layout block's metadata."""
    try:
        block = await update_layout_block(
            block_id=block_id,
            name=data.name,
            start_at=data.start_at,
            end_at=data.end_at,
        )
        if not block:
            raise HTTPException(status_code=404, detail="Layout block not found")
        return {
            "id": block.id,
            "library_section_id": block.library_section_id,
            "name": block.name,
            "start_at": block.start_at.isoformat(),
            "end_at": block.end_at.isoformat(),
            "created_at": block.created_at.isoformat() if block.created_at else None,
            "updated_at": block.updated_at.isoformat() if block.updated_at else None,
            "message": "Layout block updated",
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to update layout block: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/api/layout-blocks/{block_id}")
async def delete_layout_block_endpoint(block_id: str):
    """Delete a layout block and its items."""
    try:
        existing = await get_layout_block(block_id)
        if not existing:
            raise HTTPException(status_code=404, detail="Layout block not found")
        await delete_layout_block(block_id)
        return {"message": "Layout block deleted"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to delete layout block: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/layout-blocks/{block_id}/items")
async def get_layout_block_items_endpoint(block_id: str):
    """Get all items for a layout block."""
    try:
        existing = await get_layout_block(block_id)
        if not existing:
            raise HTTPException(status_code=404, detail="Layout block not found")
        items = await get_layout_block_items(block_id)
        return {
            "items": [
                {
                    "id": item.id,
                    "block_id": item.block_id,
                    "collection_id": item.collection_id,
                    "order_index": item.order_index,
                    "visible_home": item.visible_home,
                    "visible_shared_home": item.visible_shared_home,
                    "visible_shared_friends": item.visible_shared_friends,
                    "created_at": item.created_at.isoformat() if item.created_at else None,
                    "updated_at": item.updated_at.isoformat() if item.updated_at else None,
                }
                for item in items
            ]
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get layout block items: {e}")
        raise HTTPException(status_code=500, detail=str(e))


def normalize_collection_id(collection_id: str, section_id: str) -> str:
    """
    Normalize a collection_id to the full hub identifier format.

    - If it's already a hub identifier (contains '.'), return as-is
    - If it's just a ratingKey number, convert to 'custom.collection.{section_id}.{ratingKey}'

    Examples:
        '79192' -> 'custom.collection.3.79192'
        'custom.collection.3.79192' -> 'custom.collection.3.79192' (unchanged)
        'tv.recentlyadded' -> 'tv.recentlyadded' (unchanged)
    """
    if not collection_id:
        return collection_id

    # If it contains a dot, it's likely already a hub identifier
    if '.' in collection_id:
        return collection_id

    # If it's numeric only, it's a bare ratingKey - convert to hub identifier
    if collection_id.isdigit():
        return f"custom.collection.{section_id}.{collection_id}"

    # Otherwise, return as-is
    return collection_id


@app.put("/api/layout-blocks/{block_id}/items")
async def save_layout_block_items_endpoint(block_id: str, data: LayoutBlockItemsUpdate):
    """Bulk save items for a layout block (replaces all existing items)."""
    try:
        existing = await get_layout_block(block_id)
        if not existing:
            raise HTTPException(status_code=404, detail="Layout block not found")

        # Get the section_id from the block for normalizing collection IDs
        section_id = existing.library_section_id

        # Convert Pydantic models to dicts, normalizing collection_ids
        items_data = [
            {
                # Normalize collection_id to full hub identifier format
                "collection_id": normalize_collection_id(item.collection_id, section_id),
                "order_index": item.order_index,
                "visible_home": item.visible_home,
                "visible_shared_home": item.visible_shared_home,
                "visible_shared_friends": item.visible_shared_friends,
            }
            for item in data.items
        ]

        logger.info(f"Saving {len(items_data)} items to block {block_id} (section {section_id})")
        await save_layout_block_items(block_id, items_data)

        # Return the updated items
        items = await get_layout_block_items(block_id)
        return {
            "message": "Layout block items saved",
            "items_count": len(items),
            "items": [
                {
                    "id": item.id,
                    "block_id": item.block_id,
                    "collection_id": item.collection_id,
                    "order_index": item.order_index,
                    "visible_home": item.visible_home,
                    "visible_shared_home": item.visible_shared_home,
                    "visible_shared_friends": item.visible_shared_friends,
                    "created_at": item.created_at.isoformat() if item.created_at else None,
                    "updated_at": item.updated_at.isoformat() if item.updated_at else None,
                }
                for item in items
            ]
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to save layout block items: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ================== Schedule Conflict Detection ==================

@app.get("/api/layout-blocks/{block_id}/conflicts")
async def get_layout_block_conflicts(
    block_id: str,
    delete_not_scheduled: bool = Query(
        default=True,
        description="Whether Kometa's delete_not_scheduled is enabled (affects conflict detection)"
    )
):
    """
    Detect conflicts between a layout block's time range and the Kometa schedules
    of collections in the block.

    Returns conflicts like:
    - Collection will be deleted by Kometa before block ends
    - Collection doesn't exist yet when block starts
    - Collection has 'never' schedule
    """
    try:
        # Get the layout block
        block = await get_layout_block(block_id)
        if not block:
            raise HTTPException(status_code=404, detail="Layout block not found")

        # Get the block's items
        items = await get_layout_block_items(block_id)
        if not items:
            return {"conflicts": [], "message": "No items in block"}

        # Get Kometa collections to find schedule info
        library_type = None
        # Determine library type from section_id if possible
        try:
            libraries = await plex_client.get_libraries()
            for lib in libraries:
                if lib.get("key") == block.library_section_id:
                    library_type = lib.get("type")
                    break
        except Exception as e:
            logger.warning(f"Could not determine library type: {e}")

        # Scan Kometa collections
        kometa_scanner = KometaScanner(settings.kometa_config_path)
        kometa_collections = kometa_scanner.scan(library_type=library_type)

        # Build a lookup of collection name -> schedule
        kometa_schedules = {}
        for kc in kometa_collections:
            kometa_schedules[kc.name] = {
                "schedule": kc.schedule,
                "file_name": kc.file_name,
                "visible_home": kc.visible_home,
                "visible_shared": kc.visible_shared,
            }

        # Also get Plex collections to map IDs to names
        plex_collections = await plex_client.get_collections(block.library_section_id)
        plex_name_map = {
            f"custom.collection.{block.library_section_id}.{c.rating_key}": c.title
            for c in plex_collections
        }

        # Build collection data for conflict detection
        collections_for_check = []
        for item in items:
            # Try to get the collection name
            coll_id = item.collection_id
            coll_name = plex_name_map.get(coll_id)

            # If it's a kometa-only ID like "kometa:Collection Name"
            if coll_id.startswith("kometa:"):
                coll_name = coll_id[7:]  # Strip "kometa:" prefix

            if not coll_name:
                # Try to extract from hub identifier
                parts = coll_id.split(".")
                if len(parts) >= 4:
                    # custom.collection.{section}.{ratingKey} - need to look up
                    pass
                else:
                    coll_name = coll_id

            # Get schedule info from Kometa
            schedule_info = kometa_schedules.get(coll_name, {})

            collections_for_check.append({
                "id": coll_id,
                "name": coll_name or coll_id,
                "schedule": schedule_info.get("schedule"),
                "kometa_file": schedule_info.get("file_name"),
            })

        # Detect conflicts
        conflicts = find_block_conflicts(
            block_name=block.name,
            block_start=block.start_at,
            block_end=block.end_at,
            collections=collections_for_check,
            delete_not_scheduled=delete_not_scheduled
        )

        # Format response
        return {
            "block_id": block_id,
            "block_name": block.name,
            "block_start": block.start_at.isoformat(),
            "block_end": block.end_at.isoformat(),
            "delete_not_scheduled": delete_not_scheduled,
            "conflicts": [
                {
                    "collection_name": c.collection_name,
                    "collection_id": c.collection_id,
                    "conflict_type": c.conflict_type,
                    "message": c.message,
                    "conflict_start": c.conflict_start.isoformat() if c.conflict_start else None,
                    "conflict_end": c.conflict_end.isoformat() if c.conflict_end else None,
                    "kometa_schedule": c.kometa_schedule_raw,
                    "suggested_schedule": c.suggested_schedule,
                }
                for c in conflicts
            ],
            "has_conflicts": len(conflicts) > 0,
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to check layout block conflicts: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/collections/{collection_name}/schedule")
async def get_collection_schedule_info(
    collection_name: str,
    at: Optional[str] = Query(
        default=None,
        description="ISO datetime to evaluate schedule at (default: now)"
    )
):
    """
    Get detailed schedule information for a collection.

    Returns the Kometa schedule, whether it's currently active,
    and when it will next change state.
    """
    try:
        # Parse the datetime if provided
        eval_at = datetime.now()
        if at:
            eval_at = datetime.fromisoformat(at.replace("Z", "+00:00"))

        # Scan Kometa collections to find this one
        kometa_scanner = KometaScanner(settings.kometa_config_path)
        kometa_collections = kometa_scanner.scan()

        # Find the collection
        kometa_coll = None
        for kc in kometa_collections:
            if kc.name == collection_name:
                kometa_coll = kc
                break

        if not kometa_coll:
            return {
                "collection_name": collection_name,
                "found_in_kometa": False,
                "schedule": None,
                "is_active": True,  # Assume always active if not in Kometa
                "message": "Collection not found in Kometa config - assuming always active",
            }

        # Evaluate the schedule
        evaluation = evaluate_schedule(
            collection_name=collection_name,
            schedule=kometa_coll.schedule,
            at=eval_at
        )

        return {
            "collection_name": collection_name,
            "found_in_kometa": True,
            "file_name": kometa_coll.file_name,
            "schedule_raw": kometa_coll.schedule,
            "schedule_type": evaluation.schedule_type.value,
            "is_active": evaluation.is_active,
            "explanation": evaluation.explanation,
            "next_change": evaluation.next_change.isoformat() if evaluation.next_change else None,
            "next_change_type": evaluation.next_change_type,
            "evaluated_at": eval_at.isoformat(),
            # Also include visibility schedules
            "visible_home": kometa_coll.visible_home,
            "visible_shared": kometa_coll.visible_shared,
            "visible_library": kometa_coll.visible_library,
        }

    except Exception as e:
        logger.error(f"Failed to get collection schedule info: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ================== Static Files (Production) ==================

# Serve static frontend files in production (when STATIC_DIR is set)
if settings.static_dir and os.path.isdir(settings.static_dir):
    # Mount static assets (js, css, images)
    app.mount("/assets", StaticFiles(directory=os.path.join(settings.static_dir, "assets")), name="assets")

    # Catch-all route for SPA - must be LAST
    @app.get("/{full_path:path}")
    async def serve_spa(request: Request, full_path: str):
        """Serve the React SPA for all non-API routes."""
        # Don't intercept API routes
        if full_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="Not found")

        # Serve index.html for SPA routing
        index_path = Path(settings.static_dir) / "index.html"
        if index_path.exists():
            return FileResponse(index_path)
        raise HTTPException(status_code=404, detail="Frontend not found")

    logger.info(f"Serving static files from {settings.static_dir}")


# ================== Main ==================

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host=settings.host,
        port=settings.port,
        reload=True,
    )
