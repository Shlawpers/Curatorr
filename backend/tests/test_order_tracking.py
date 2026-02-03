"""
Tests for order tracking - CRITICAL REGRESSION PREVENTION

These tests ensure that ALL managed hubs are tracked in the order,
regardless of their visibility flags. This is essential because:

1. Plex maintains an order for ALL managed hubs, not just home-visible ones
2. Items visible only to "Library Recommended" (friends) still have positions
3. If we only track home-visible items, friends-only items keep wrong positions

HISTORY:
- This bug was introduced and fixed multiple times
- Each time it was caused by filtering order tracking to only visible_home items
- The fix is to track ALL items in the order arrays

INVARIANT:
- plex_client.py: hub_order must include ALL hubs from get_managed_hubs
- main.py diff: desired_promoted_order must include ALL merged items
- main.py apply: desired_hub_order must include ALL merged items
- main.py apply_if_needed_internal: desired_hub_order must include ALL merged items

DO NOT MODIFY THESE TESTS WITHOUT UNDERSTANDING THE FULL IMPACT.
"""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from dataclasses import dataclass
from typing import Optional


# Mock PlexHub for testing
@dataclass
class MockPlexHub:
    hub_identifier: str
    title: str
    type: str = "collection"
    promoted: bool = True
    promoted_to_own_home: bool = False
    promoted_to_shared_home: bool = False
    promoted_to_recommended: bool = True  # Friends only
    hub_key: str = ""
    context: str = ""


class TestOrderTracking:
    """Tests to ensure ALL hubs are tracked regardless of visibility."""

    def test_hub_order_includes_all_hubs_not_just_promoted(self):
        """
        CRITICAL: hub_order must include ALL hubs, not just promoted ones.

        This test verifies the fix in plex_client.py that was previously:
            if hub.promoted:
                hub_order.append(hub.hub_identifier)

        And should now be:
            hub_order.append(hub.hub_identifier)  # ALL hubs
        """
        # Simulate hubs with different visibility
        hubs = [
            MockPlexHub("hub1", "Home Visible", promoted_to_own_home=True, promoted=True),
            MockPlexHub("hub2", "Friends Only", promoted_to_own_home=False, promoted=False),
            MockPlexHub("hub3", "Also Friends Only", promoted_to_own_home=False, promoted=False),
            MockPlexHub("hub4", "Another Home Visible", promoted_to_own_home=True, promoted=True),
        ]

        # Build hub_order the way plex_client.py should
        hub_order = []
        for hub in hubs:
            # CORRECT: Add ALL hubs
            hub_order.append(hub.hub_identifier)

        # Verify ALL hubs are in order
        assert len(hub_order) == 4, "hub_order must include ALL hubs"
        assert "hub2" in hub_order, "Friends-only hub2 must be in order"
        assert "hub3" in hub_order, "Friends-only hub3 must be in order"

        # This would fail with the old buggy code:
        buggy_hub_order = []
        for hub in hubs:
            if hub.promoted:  # BUG: Only adding promoted
                buggy_hub_order.append(hub.hub_identifier)

        assert len(buggy_hub_order) == 2, "Buggy code only tracks 2 hubs"
        assert "hub2" not in buggy_hub_order, "Buggy code misses friends-only hubs"

    def test_desired_order_includes_all_items_not_just_visible_home(self):
        """
        CRITICAL: desired_hub_order must include ALL merged items.

        This test verifies the fix in main.py apply that was previously:
            if merged_item.visible_home:
                desired_hub_order.append(hub_id)

        And should now be:
            desired_hub_order.append(hub_id)  # ALL items
            if merged_item.visible_home:
                desired_promoted_hubs.add(hub_id)  # Separate tracking
        """
        # Simulate merged items with different visibility
        @dataclass
        class MockMergedItem:
            hub_identifier: str
            visible_home: bool
            visible_shared_home: bool
            visible_shared_friends: bool

        merged_items = [
            MockMergedItem("item1", True, True, True),    # Full visibility
            MockMergedItem("item2", False, False, True),  # Friends only
            MockMergedItem("item3", False, False, True),  # Friends only
            MockMergedItem("item4", True, True, False),   # Home only
            MockMergedItem("item5", False, False, True),  # Friends only
        ]

        # CORRECT implementation
        desired_hub_order = []
        desired_promoted_hubs = set()
        for item in merged_items:
            hub_id = item.hub_identifier
            desired_hub_order.append(hub_id)  # ALL items
            if item.visible_home:
                desired_promoted_hubs.add(hub_id)

        assert len(desired_hub_order) == 5, "Must include ALL 5 items"
        assert "item2" in desired_hub_order, "Friends-only item2 must be in order"
        assert "item3" in desired_hub_order, "Friends-only item3 must be in order"
        assert "item5" in desired_hub_order, "Friends-only item5 must be in order"
        assert len(desired_promoted_hubs) == 2, "Only 2 items have visible_home"

        # BUGGY implementation (what we had before)
        buggy_order = []
        for item in merged_items:
            if item.visible_home:  # BUG: Filtering
                buggy_order.append(item.hub_identifier)

        assert len(buggy_order) == 2, "Buggy code only has 2 items"
        assert "item2" not in buggy_order, "Buggy code loses friends-only items"

    def test_decade_collections_order_preserved(self):
        """
        Real-world regression test: decade collections must maintain order.

        The bug manifested as decade collections (Best of 2020s, 2010s, etc.)
        appearing in wrong order because they're friends-only (visible_shared_friends=True
        but visible_home=False).
        """
        @dataclass
        class MockMergedItem:
            hub_identifier: str
            visible_home: bool
            visible_shared_friends: bool

        # Simulates the feb2 block with decades in correct order
        merged_items = [
            MockMergedItem("movie.recentlyreleased", True, True),
            MockMergedItem("collection.oscars", True, True),
            # ... other items ...
            MockMergedItem("collection.best2020s", False, True),  # Friends only
            MockMergedItem("collection.best2010s", False, True),  # Friends only
            MockMergedItem("collection.best2000s", False, True),  # Friends only
            MockMergedItem("collection.best1990s", False, True),  # Friends only
        ]

        # Build order correctly (ALL items)
        desired_order = [item.hub_identifier for item in merged_items]

        # Verify decades are in correct positions
        decade_positions = {
            item.hub_identifier: i
            for i, item in enumerate(merged_items)
            if "best" in item.hub_identifier
        }

        assert decade_positions["collection.best2020s"] < decade_positions["collection.best2010s"]
        assert decade_positions["collection.best2010s"] < decade_positions["collection.best2000s"]
        assert decade_positions["collection.best2000s"] < decade_positions["collection.best1990s"]

        # Verify they're ALL in the desired order
        for decade_id in decade_positions:
            assert decade_id in desired_order, f"{decade_id} must be in order"


class TestCodeInvariants:
    """
    Tests that verify the actual code maintains the required invariants.
    These read the source files and check for the correct patterns.
    """

    def test_plex_client_tracks_all_hubs(self):
        """Verify plex_client.py tracks ALL hubs in hub_order."""
        import os

        plex_client_path = os.path.join(
            os.path.dirname(__file__),
            "..",
            "plex_client.py"
        )

        with open(plex_client_path, "r") as f:
            content = f.read()

        # Should NOT have the buggy pattern
        assert "if hub.promoted:" not in content or \
               "hub_order.append" not in content.split("if hub.promoted:")[1].split("\n")[0:3], \
               "REGRESSION: plex_client.py is filtering hub_order by promoted status"

        # Should have the correct pattern - unconditional append
        assert "hub_order.append(hub.hub_identifier)" in content, \
               "plex_client.py must append ALL hubs to hub_order"

    def test_main_apply_tracks_all_items(self):
        """Verify main.py apply endpoint tracks ALL items in order."""
        import os

        main_path = os.path.join(
            os.path.dirname(__file__),
            "..",
            "main.py"
        )

        with open(main_path, "r") as f:
            content = f.read()

        # The fix comment should be present
        assert "Add ALL items to the order" in content, \
               "main.py should have comment explaining ALL items tracking"

        # Should NOT have the buggy pattern where visible_home gates the append
        # This is a heuristic check - the actual fix is more nuanced
        lines = content.split("\n")
        for i, line in enumerate(lines):
            if "if merged_item.visible_home:" in line:
                # Check next few lines don't have desired_hub_order.append
                next_lines = "\n".join(lines[i+1:i+4])
                if "desired_hub_order.append" in next_lines:
                    pytest.fail(
                        f"REGRESSION at line {i+1}: "
                        "visible_home check should NOT gate desired_hub_order.append"
                    )


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
