"""Plex API client for managing collections and home hub ordering."""
import httpx
import asyncio
from typing import Optional
from dataclasses import dataclass, field
from config import settings
import logging

logger = logging.getLogger(__name__)


@dataclass
class PlexLibrary:
    """Represents a Plex library section."""
    key: str
    title: str
    type: str  # "movie", "show", etc.
    uuid: str


@dataclass
class PlexCollection:
    """Represents a Plex collection."""
    rating_key: str
    title: str
    library_section_id: str
    thumb: Optional[str] = None
    child_count: int = 0
    smart: bool = False


@dataclass
class PlexHub:
    """Represents a hub (row) on Plex Home for a library."""
    hub_identifier: str  # Maps to Plex "identifier" field
    title: str
    type: str  # Derived from identifier (e.g., "collection", "movie", "custom")
    promoted: bool = False  # True if visible on Home (promotedToOwnHome or homeVisibility == "all")
    promoted_to_own_home: bool = False  # Visible on Library Recommended / own Home
    promoted_to_shared_home: bool = False  # Visible on Shared Users' Home
    promoted_to_recommended: bool = False  # Visible on Friends' Home / Recommended
    hub_key: str = ""  # Collection key extracted from identifier for collections
    context: str = ""  # The identifier itself provides context


@dataclass
class ManagedHubsState:
    """Current state of managed hubs for a library section."""
    section_id: str
    hubs: list[PlexHub] = field(default_factory=list)
    hub_order: list[str] = field(default_factory=list)  # ordered hub identifiers


@dataclass
class ReorderResult:
    """Result of a reorder operation with verification."""
    success: bool
    before_order: list[str]
    desired_order: list[str]
    after_order: list[str]
    attempts: int
    error_message: Optional[str] = None
    recovery_actions: int = 0  # Number of unpromote/re-promote recoveries
    nuclear_reset_used: bool = False  # Whether nuclear reset was triggered


class PlexClient:
    """Client for interacting with Plex API."""

    def __init__(self, base_url: str = None, token: str = None):
        self.base_url = (base_url or settings.plex_url).rstrip("/")
        self.token = token or settings.plex_token
        self.headers = {
            "X-Plex-Token": self.token,
            "Accept": "application/json",
        }

    async def _request(
        self,
        method: str,
        endpoint: str,
        params: dict = None,
        data: dict = None,
    ) -> dict:
        """Make an HTTP request to Plex API."""
        url = f"{self.base_url}{endpoint}"
        async with httpx.AsyncClient() as client:
            response = await client.request(
                method=method,
                url=url,
                headers=self.headers,
                params=params,
                data=data,
                timeout=30.0,
            )
            response.raise_for_status()
            return response.json() if response.content else {}

    async def get_libraries(self) -> list[PlexLibrary]:
        """Get all library sections."""
        data = await self._request("GET", "/library/sections")
        libraries = []
        for section in data.get("MediaContainer", {}).get("Directory", []):
            libraries.append(PlexLibrary(
                key=section["key"],
                title=section["title"],
                type=section["type"],
                uuid=section.get("uuid", ""),
            ))
        return libraries

    async def get_collections(self, section_id: str) -> list[PlexCollection]:
        """Get all collections in a library section."""
        data = await self._request(
            "GET",
            f"/library/sections/{section_id}/collections"
        )
        collections = []
        for item in data.get("MediaContainer", {}).get("Metadata", []):
            collections.append(PlexCollection(
                rating_key=item["ratingKey"],
                title=item["title"],
                library_section_id=section_id,
                thumb=item.get("thumb"),
                child_count=item.get("childCount", 0),
                smart=item.get("smart", False),
            ))
        return collections

    async def get_managed_hubs(self, section_id: str) -> ManagedHubsState:
        """
        Get current managed hubs state for a library section.
        This is the source of truth for Home hub ordering.

        Endpoint: /hubs/sections/{sectionId}/manage

        Plex API returns fields:
        - identifier: e.g., "custom.collection.11.111060" or "movie.recentlyreleased"
        - title: Display name
        - homeVisibility: "all" or "none"
        - promotedToOwnHome: boolean
        - promotedToSharedHome: boolean
        - recommendationsVisibility: "all" or "none"
        - promotedToRecommended: boolean
        - deletable: boolean
        """
        data = await self._request(
            "GET",
            f"/hubs/sections/{section_id}/manage"
        )

        hubs = []
        hub_order = []

        for hub_data in data.get("MediaContainer", {}).get("Hub", []):
            # Get the identifier (this is the unique hub ID in Plex)
            identifier = hub_data.get("identifier", "")

            # Extract all visibility flags from Plex API
            home_visibility = hub_data.get("homeVisibility", "none")
            promoted_to_own = hub_data.get("promotedToOwnHome", False)
            promoted_to_shared = hub_data.get("promotedToSharedHome", False)
            promoted_to_recommended = hub_data.get("promotedToRecommended", False)

            # A hub is on Home if homeVisibility is "all" or promotedToOwnHome is True
            is_promoted = home_visibility == "all" or promoted_to_own

            # Extract type from identifier (e.g., "custom.collection.11.111060" -> "collection")
            # Common patterns: "custom.collection.*", "movie.*", "show.*"
            hub_type = ""
            if identifier:
                parts = identifier.split(".")
                if len(parts) >= 2:
                    if parts[0] == "custom" and parts[1] == "collection":
                        hub_type = "collection"
                    else:
                        hub_type = parts[0]  # e.g., "movie", "show"

            # For collections, extract the collection key from identifier
            # "custom.collection.11.111060" -> the last part (111060) is the collection ratingKey
            hub_key = ""
            if "collection" in identifier:
                parts = identifier.split(".")
                if len(parts) >= 4:
                    hub_key = f"/library/collections/{parts[-1]}"

            hub = PlexHub(
                hub_identifier=identifier,
                title=hub_data.get("title", ""),
                type=hub_type,
                promoted=is_promoted,
                promoted_to_own_home=promoted_to_own,
                promoted_to_shared_home=promoted_to_shared,
                promoted_to_recommended=promoted_to_recommended,
                hub_key=hub_key,
                context=identifier,  # Use identifier as context
            )
            hubs.append(hub)
            # Include ALL hubs in order tracking, not just promoted ones
            # Plex maintains positions for all managed hubs regardless of visibility
            # (Aligned with Agregarr's battle-tested approach)
            hub_order.append(hub.hub_identifier)

        return ManagedHubsState(
            section_id=section_id,
            hubs=hubs,
            hub_order=hub_order,
        )

    async def set_hub_visibility(
        self,
        section_id: str,
        hub_identifier: str,
        visible_home: bool,
        visible_shared_home: bool,
        visible_shared_friends: bool,
    ) -> tuple[bool, str]:
        """
        Set hub visibility flags using correct Plex parameter names.

        Endpoint: PUT /hubs/sections/{sectionId}/manage/{hubIdentifier}

        Mapping (our internal -> Plex):
        - visible_home           -> promotedToOwnHome (appears on YOUR home)
        - visible_shared_home    -> promotedToSharedHome (appears on shared users' home)
        - visible_shared_friends -> promotedToRecommended (appears in friends/recommended)

        Returns: (success: bool, error_message: str)
        """
        if settings.apply_mode == "dry-run":
            logger.info(
                f"[DRY-RUN] Would set hub {hub_identifier} "
                f"promotedToOwnHome={visible_home}, "
                f"promotedToSharedHome={visible_shared_home}, "
                f"promotedToRecommended={visible_shared_friends}"
            )
            return True, ""

        try:
            # Apply visibility with correct Plex parameter names
            params = {
                "promotedToOwnHome": int(visible_home),
                "promotedToSharedHome": int(visible_shared_home),
                "promotedToRecommended": int(visible_shared_friends),
            }

            await self._request(
                "PUT",
                f"/hubs/sections/{section_id}/manage/{hub_identifier}",
                params=params,
            )

            # Verify the change took effect
            state = await self.get_managed_hubs(section_id)
            for hub in state.hubs:
                if hub.hub_identifier == hub_identifier:
                    # Check if all flags match
                    if (hub.promoted_to_own_home != visible_home or
                        hub.promoted_to_shared_home != visible_shared_home or
                        hub.promoted_to_recommended != visible_shared_friends):
                        error = (
                            f"Visibility verification failed for {hub_identifier}: "
                            f"expected own={visible_home}/shared={visible_shared_home}/rec={visible_shared_friends}, "
                            f"got own={hub.promoted_to_own_home}/shared={hub.promoted_to_shared_home}/rec={hub.promoted_to_recommended}"
                        )
                        logger.error(error)
                        return False, error
                    logger.info(f"Visibility verified for {hub_identifier}")
                    return True, ""

            return False, f"Hub {hub_identifier} not found after visibility change"
        except Exception as e:
            logger.error(f"Failed to set hub visibility: {e}")
            return False, str(e)

    async def create_hub(
        self,
        section_id: str,
        metadata_item_id: str,
        visible_home: bool,
        visible_shared_home: bool,
        visible_shared_friends: bool,
    ) -> tuple[bool, str, str]:
        """
        Create a new managed hub for a collection (first-time promotion).

        This is used when a collection has never been promoted before and
        doesn't appear in the /manage endpoint response.

        Endpoint: POST /hubs/sections/{sectionId}/manage

        Args:
            section_id: The library section ID
            metadata_item_id: The collection's ratingKey
            visible_home: promotedToOwnHome flag
            visible_shared_home: promotedToSharedHome flag
            visible_shared_friends: promotedToRecommended flag

        Returns: (success: bool, error_message: str, hub_identifier: str)
            - hub_identifier will be the created hub's identifier (e.g., custom.collection.3.12345)
        """
        expected_hub_id = f"custom.collection.{section_id}.{metadata_item_id}"

        if settings.apply_mode == "dry-run":
            logger.info(
                f"[DRY-RUN] Would create hub for collection {metadata_item_id} "
                f"with promotedToOwnHome={visible_home}, "
                f"promotedToSharedHome={visible_shared_home}, "
                f"promotedToRecommended={visible_shared_friends}"
            )
            return True, "", expected_hub_id

        try:
            params = {
                "metadataItemId": metadata_item_id,
                "promotedToOwnHome": int(visible_home),
                "promotedToSharedHome": int(visible_shared_home),
                "promotedToRecommended": int(visible_shared_friends),
            }

            logger.info(f"Creating hub for collection {metadata_item_id} in section {section_id}")

            await self._request(
                "POST",
                f"/hubs/sections/{section_id}/manage",
                params=params,
            )

            # Verify the hub was created by re-reading managed hubs
            state = await self.get_managed_hubs(section_id)
            for hub in state.hubs:
                if hub.hub_identifier == expected_hub_id:
                    # Verify visibility flags match
                    if (hub.promoted_to_own_home != visible_home or
                        hub.promoted_to_shared_home != visible_shared_home or
                        hub.promoted_to_recommended != visible_shared_friends):
                        # Hub was created but visibility didn't match - try to fix it
                        logger.warning(
                            f"Hub {expected_hub_id} created but visibility mismatch, "
                            f"attempting to set correct visibility"
                        )
                        success, error = await self.set_hub_visibility(
                            section_id, expected_hub_id,
                            visible_home, visible_shared_home, visible_shared_friends
                        )
                        if not success:
                            return False, f"Hub created but visibility fix failed: {error}", expected_hub_id

                    logger.info(f"Successfully created and verified hub {expected_hub_id}")
                    return True, "", expected_hub_id

            # Hub not found after creation attempt
            error = f"Hub {expected_hub_id} not found after POST. Collection may not exist in Plex."
            logger.error(error)
            return False, error, ""

        except httpx.HTTPStatusError as e:
            error = f"HTTP {e.response.status_code} creating hub: {e.response.text}"
            logger.error(error)
            return False, error, ""
        except Exception as e:
            error = f"Failed to create hub: {str(e)}"
            logger.error(error)
            return False, error, ""

    async def set_hub_promoted(
        self,
        section_id: str,
        hub_identifier: str,
        promoted: bool
    ) -> bool:
        """
        Legacy wrapper - sets all visibility flags to the same value.
        Use set_hub_visibility for granular control.
        """
        success, _ = await self.set_hub_visibility(
            section_id, hub_identifier, promoted, promoted, promoted
        )
        return success

    async def move_hub(
        self,
        section_id: str,
        hub_identifier: str,
        after_hub_identifier: str = ""
    ) -> bool:
        """
        Move a hub to a new position in the Home order.

        Endpoint: PUT /hubs/sections/{sectionId}/manage/{hubIdentifier}/move

        If after_hub_identifier is empty, moves to first position.

        NOTE: This endpoint can be unreliable on some Plex versions.
        Always verify the result after calling.
        """
        if settings.apply_mode == "dry-run":
            logger.info(
                f"[DRY-RUN] Would move hub {hub_identifier} "
                f"after {after_hub_identifier or 'START'}"
            )
            return True

        if settings.simulate_reorder_failure:
            logger.warning("[SIMULATE] Faking reorder failure for testing")
            return True  # Pretend success but don't actually move

        try:
            params = {}
            if after_hub_identifier:
                params["after"] = after_hub_identifier

            await self._request(
                "PUT",
                f"/hubs/sections/{section_id}/manage/{hub_identifier}/move",
                params=params if params else None,
            )
            return True
        except Exception as e:
            logger.error(f"Failed to move hub: {e}")
            return False

    async def delete_hub(
        self,
        section_id: str,
        hub_identifier: str,
    ) -> tuple[bool, str]:
        """
        Delete a managed hub entirely from the library.

        This removes the hub from the managed hubs list, not just hides it.
        Only works for deletable hubs (collections), not built-in hubs.

        Endpoint: DELETE /hubs/sections/{sectionId}/manage/{hubIdentifier}

        Returns: (success: bool, error_message: str)
        """
        if settings.apply_mode == "dry-run":
            logger.info(f"[DRY-RUN] Would delete hub {hub_identifier}")
            return True, ""

        try:
            await self._request(
                "DELETE",
                f"/hubs/sections/{section_id}/manage/{hub_identifier}",
            )
            logger.info(f"Deleted hub {hub_identifier}")
            return True, ""
        except Exception as e:
            error = f"Failed to delete hub {hub_identifier}: {e}"
            logger.error(error)
            return False, str(e)

    # ================== Convergence Recovery ==================
    # Pattern inspired by Agregarr (https://github.com/agregarr/agregarr)
    #
    # Plex uses float values for hub positioning. When hubs are moved repeatedly,
    # these floats converge toward each other, eventually causing moves to silently
    # fail. Agregarr discovered that unpromoting and re-promoting a hub gives it
    # fresh 1000-unit spacing, effectively resetting its position tracking.
    #
    # This implementation adapts that pattern for Curatorr's async architecture.
    # ============================================================

    async def recover_hub_position(
        self,
        section_id: str,
        hub_identifier: str,
        visible_home: bool,
        visible_shared_home: bool,
        visible_shared_friends: bool,
    ) -> tuple[bool, str]:
        """
        Delete and re-create a hub to get fresh positioning values.
        This fixes Plex's float precision convergence issue.

        When hubs are moved repeatedly, Plex's internal float positioning values
        converge toward each other, eventually causing moves to silently fail.
        Re-promoting a hub gives it fresh 1000-unit spacing.

        Returns: (success, new_hub_identifier or error_message)
        """
        # Extract rating_key from hub_identifier (e.g., "custom.collection.11.12345" -> "12345")
        parts = hub_identifier.split(".")
        if len(parts) < 4 or parts[1] != "collection":
            return False, "Can only recover collection hubs"

        rating_key = parts[-1]

        if settings.apply_mode == "dry-run":
            logger.info(
                f"[DRY-RUN] Would recover hub {hub_identifier} (delete + re-promote)"
            )
            return True, hub_identifier

        logger.info(f"Recovering hub position for {hub_identifier} via delete + re-promote")

        # Step 1: Delete the hub from management
        success, error = await self.delete_hub(section_id, hub_identifier)
        if not success:
            return False, f"Recovery failed during delete: {error}"

        await asyncio.sleep(0.2)  # Let Plex process the deletion

        # Step 2: Re-promote it (this gives fresh positioning)
        success, error, new_hub_id = await self.create_hub(
            section_id, rating_key,
            visible_home, visible_shared_home, visible_shared_friends
        )

        if success:
            logger.info(f"Hub recovery successful: {hub_identifier} -> {new_hub_id}")
            return True, new_hub_id
        return False, f"Recovery failed during re-promote: {error}"

    async def reset_hub_management(self, section_id: str) -> bool:
        """
        Nuclear reset: Clear ALL hub positioning for a library.
        Use only when convergence recovery has failed repeatedly.

        This removes all hubs from the managed state, giving each one
        fresh positioning when re-promoted.

        After this, you must re-promote all collections in desired order.

        Endpoint: DELETE /hubs/sections/{sectionId}/manage
        """
        if settings.apply_mode == "dry-run":
            logger.info(f"[DRY-RUN] Would reset all hub management for section {section_id}")
            return True

        try:
            await self._request("DELETE", f"/hubs/sections/{section_id}/manage")
            logger.warning(f"Nuclear reset: cleared all hub management for section {section_id}")
            return True
        except Exception as e:
            logger.error(f"Nuclear reset failed: {e}")
            return False

    async def _verify_single_move(
        self,
        section_id: str,
        hub_id: str,
        after_id: str
    ) -> bool:
        """
        Verify a single move succeeded by checking hub position.

        Args:
            section_id: Library section
            hub_id: The hub that was moved
            after_id: The hub it should be after (empty string = first position)

        Returns: True if hub is in expected position.
                 Always returns True for non-collection hubs since they behave unpredictably.
        """
        # Skip verification for non-collection hubs - they can't be reliably controlled
        if not hub_id.startswith("custom.collection."):
            return True

        state = await self.get_managed_hubs(section_id)
        order = state.hub_order

        if hub_id not in order:
            return False

        hub_pos = order.index(hub_id)

        if after_id == "":
            # Should be first position
            return hub_pos == 0

        if after_id not in order:
            return False

        after_pos = order.index(after_id)
        return hub_pos == after_pos + 1

    async def reorder_hubs_with_verify(
        self,
        section_id: str,
        desired_order: list[str],
        hub_visibility: dict[str, tuple[bool, bool, bool]] = None,
    ) -> ReorderResult:
        """
        Attempt to reorder hubs with verification, recovery, and retry.

        This is the core ordering function that implements the Agregarr pattern:
        1. Reads current order
        2. Computes minimal moves needed
        3. Applies each move with immediate verification
        4. If a move fails due to float convergence, recovers via unpromote/re-promote
        5. If recovery fails repeatedly, falls back to nuclear reset + rebuild
        6. Returns explicit success/failure status

        Args:
            section_id: The library section ID
            desired_order: List of hub_identifiers in desired order
            hub_visibility: Optional dict mapping hub_identifier to (visible_home, visible_shared, visible_friends)
                           Required for recovery operations. If not provided, defaults to (True, True, True).
        """
        # Step 1: Read current order and build hub visibility map
        current_state = await self.get_managed_hubs(section_id)
        before_order = current_state.hub_order.copy()

        # Build visibility map from current state if not provided
        if hub_visibility is None:
            hub_visibility = {}
            for hub in current_state.hubs:
                hub_visibility[hub.hub_identifier] = (
                    hub.promoted_to_own_home,
                    hub.promoted_to_shared_home,
                    hub.promoted_to_recommended,
                )

        result = ReorderResult(
            success=False,
            before_order=before_order,
            desired_order=desired_order,
            after_order=before_order,
            attempts=0,
            recovery_actions=0,
            nuclear_reset_used=False,
        )

        # Quick check: already in desired order?
        if before_order == desired_order:
            result.success = True
            return result

        # Step 2: Two-phase move computation
        # Phase 1: Position collections correctly (these we can verify and recover)
        # Phase 2: Best-effort positioning of built-in hubs
        def is_collection_hub(h: str) -> bool:
            return h.startswith("custom.collection.")

        # Separate collections and built-in hubs
        desired_collections = [h for h in desired_order if is_collection_hub(h)]
        desired_builtin = [h for h in desired_order if not is_collection_hub(h)]
        current_collections = [h for h in before_order if is_collection_hub(h)]
        current_builtin = [h for h in before_order if not is_collection_hub(h) and h in set(desired_builtin)]

        # Compute moves for collections (primary - these we verify)
        collection_moves = self._compute_minimal_moves(current_collections, desired_collections)

        # Compute moves for built-in hubs (best-effort - not verified)
        # Only move built-in hubs relative to each other and collections
        builtin_moves = []
        for i, hub_id in enumerate(desired_builtin):
            # Find where this built-in hub should go
            # Look for the item before it in desired_order
            desired_idx = desired_order.index(hub_id)
            if desired_idx > 0:
                after_hub = desired_order[desired_idx - 1]
                builtin_moves.append((hub_id, after_hub))

        logger.info(f"Computed {len(collection_moves)} collection moves + {len(builtin_moves)} built-in moves")

        # Step 3: Apply moves in two phases, then verify
        for attempt in range(settings.max_reorder_retries + 1):
            result.attempts = attempt + 1

            # Phase 1: Apply collection moves (these are verified)
            for hub_id, after_id in collection_moves:
                success = await self.move_hub(section_id, hub_id, after_id)
                if not success:
                    logger.error(f"Move API call failed for {hub_id}")
                await asyncio.sleep(0.15)

            # Phase 2: Apply built-in hub moves (best effort, not verified)
            for hub_id, after_id in builtin_moves:
                await self.move_hub(section_id, hub_id, after_id)
                await asyncio.sleep(0.15)

            # Single verification after all moves complete
            await asyncio.sleep(0.2)
            new_state = await self.get_managed_hubs(section_id)
            result.after_order = new_state.hub_order

            actual_collections = [h for h in new_state.hub_order if is_collection_hub(h) and h in set(desired_collections)]

            if actual_collections == desired_collections:
                result.success = True
                logger.info(
                    f"Reorder successful after {result.attempts} attempt(s), "
                    f"{result.recovery_actions} recovery actions, "
                    f"nuclear reset: {result.nuclear_reset_used}"
                )
                return result

            # Order doesn't match - try recovery if enabled
            if settings.enable_convergence_recovery and attempt < settings.max_reorder_retries:
                # Find which hubs are misplaced
                misplaced = []
                for i, hub_id in enumerate(desired_collections):
                    if i >= len(actual_collections) or actual_collections[i] != hub_id:
                        misplaced.append(hub_id)

                if misplaced:
                    logger.warning(f"Found {len(misplaced)} misplaced hubs, attempting recovery")

                    # Try recovery on misplaced hubs (limit to first few to avoid excessive calls)
                    for hub_id in misplaced[:3]:  # Recover max 3 hubs per attempt
                        if not is_collection_hub(hub_id):
                            continue

                        vis = hub_visibility.get(hub_id, (True, True, True))
                        result.recovery_actions += 1

                        success, _ = await self.recover_hub_position(
                            section_id, hub_id, vis[0], vis[1], vis[2]
                        )
                        if success:
                            logger.info(f"Recovery completed for {hub_id}")
                        await asyncio.sleep(0.1)

                    # Recompute collection moves for next attempt
                    new_state = await self.get_managed_hubs(section_id)
                    current_collections = [h for h in new_state.hub_order if is_collection_hub(h)]
                    collection_moves = self._compute_minimal_moves(current_collections, desired_collections)

            # If still failing after recovery attempts, try nuclear reset
            if attempt == settings.max_reorder_retries - 1 and settings.enable_convergence_recovery:
                logger.warning("Recovery attempts exhausted, trying nuclear reset")
                result.nuclear_reset_used = True

                if await self.reset_hub_management(section_id):
                    await asyncio.sleep(0.3)

                    # Re-promote ALL collection hubs in desired order
                    # (built-in hubs will reappear at default positions)
                    for hub_id in desired_collections:
                        vis = hub_visibility.get(hub_id, (True, True, True))
                        parts = hub_id.split(".")
                        if len(parts) >= 4:
                            rating_key = parts[-1]
                            await self.create_hub(section_id, rating_key, vis[0], vis[1], vis[2])
                            await asyncio.sleep(0.1)

                    # After nuclear rebuild, recompute collection moves
                    new_state = await self.get_managed_hubs(section_id)
                    current_collections = [h for h in new_state.hub_order if is_collection_hub(h)]
                    collection_moves = self._compute_minimal_moves(current_collections, desired_collections)

            # Retry delay
            if attempt < settings.max_reorder_retries:
                delay_ms = settings.retry_delay_ms[min(attempt, len(settings.retry_delay_ms) - 1)]
                logger.warning(
                    f"Reorder verification failed, retrying in {delay_ms}ms "
                    f"(attempt {attempt + 1}/{settings.max_reorder_retries + 1})"
                )
                await asyncio.sleep(delay_ms / 1000)

        # All retries exhausted
        # Get final state for error message
        final_state = await self.get_managed_hubs(section_id)
        result.after_order = final_state.hub_order

        final_actual_collections = [h for h in final_state.hub_order if is_collection_hub(h) and h in set(desired_collections)]

        result.error_message = (
            f"Reorder failed after {result.attempts} attempts, "
            f"{result.recovery_actions} recovery actions, "
            f"nuclear reset: {result.nuclear_reset_used}. "
            f"Collection order mismatch: expected {desired_collections}, got {final_actual_collections}"
        )
        logger.error(result.error_message)
        return result

    def _compute_minimal_moves(
        self,
        current: list[str],
        desired: list[str]
    ) -> list[tuple[str, str]]:
        """
        Compute minimal move operations to transform current order to desired.

        Returns list of (hub_to_move, place_after_this_hub) tuples.

        NOTE: Moves to START (after="") are unreliable in Plex API.
        When we need item X at position 0, instead of moving X to START,
        we move the current item at position 0 to be AFTER X.

        Uses a greedy approach: iterate through desired order,
        move items that aren't in the right position.
        """
        moves = []
        working = current.copy()

        for i, hub_id in enumerate(desired):
            if hub_id not in working:
                continue  # Skip hubs not in current set

            current_pos = working.index(hub_id)
            if current_pos != i:
                # Need to move this hub
                working.remove(hub_id)
                if i == 0:
                    # WORKAROUND: Moving to START is unreliable
                    # Instead, move the current first item AFTER this one
                    # This effectively makes hub_id the first item
                    if working:
                        current_first = working[0]
                        # Move current_first after hub_id (hub_id goes to position 0)
                        moves.append((current_first, hub_id))
                        working.remove(current_first)
                        working.insert(0, hub_id)
                        working.insert(1, current_first)
                    else:
                        # List is empty, just insert
                        working.insert(0, hub_id)
                else:
                    after = desired[i - 1]
                    moves.append((hub_id, after))
                    working.insert(i, hub_id)

        return moves


# Singleton instance
plex_client = PlexClient()
