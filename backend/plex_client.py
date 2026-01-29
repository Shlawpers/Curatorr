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
            if hub.promoted:
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

    async def reorder_hubs_with_verify(
        self,
        section_id: str,
        desired_order: list[str],
    ) -> ReorderResult:
        """
        Attempt to reorder hubs with verification and retry.

        This is the core ordering function that:
        1. Reads current order
        2. Computes minimal moves needed
        3. Applies moves
        4. Verifies by re-reading order
        5. Retries if mismatch
        6. Returns explicit success/failure status
        """
        # Step 1: Read current order
        current_state = await self.get_managed_hubs(section_id)
        before_order = current_state.hub_order.copy()

        result = ReorderResult(
            success=False,
            before_order=before_order,
            desired_order=desired_order,
            after_order=before_order,
            attempts=0,
        )

        # Quick check: already in desired order?
        if before_order == desired_order:
            result.success = True
            return result

        # Step 2: Compute minimal moves
        moves = self._compute_minimal_moves(before_order, desired_order)

        # Step 3 & 4: Apply and verify with retries
        for attempt in range(settings.max_reorder_retries + 1):
            result.attempts = attempt + 1

            # Apply moves
            for hub_id, after_id in moves:
                success = await self.move_hub(section_id, hub_id, after_id)
                if not success:
                    result.error_message = f"Move API call failed for {hub_id}"

            # Small delay to let Plex process
            await asyncio.sleep(0.1)

            # Verify
            new_state = await self.get_managed_hubs(section_id)
            result.after_order = new_state.hub_order

            if result.after_order == desired_order:
                result.success = True
                logger.info(
                    f"Reorder successful after {result.attempts} attempt(s)"
                )
                return result

            # Retry delay
            if attempt < settings.max_reorder_retries:
                delay_ms = settings.retry_delay_ms[min(attempt, len(settings.retry_delay_ms) - 1)]
                logger.warning(
                    f"Reorder verification failed, retrying in {delay_ms}ms "
                    f"(attempt {attempt + 1}/{settings.max_reorder_retries + 1})"
                )
                await asyncio.sleep(delay_ms / 1000)
                # Recompute moves based on current state
                moves = self._compute_minimal_moves(result.after_order, desired_order)

        # All retries exhausted
        result.error_message = (
            f"Reorder failed after {result.attempts} attempts. "
            f"Order mismatch: expected {desired_order}, got {result.after_order}"
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
        Empty string for place_after means move to start.

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
                    after = ""
                else:
                    after = desired[i - 1]
                moves.append((hub_id, after))
                working.insert(i, hub_id)

        return moves


# Singleton instance
plex_client = PlexClient()
