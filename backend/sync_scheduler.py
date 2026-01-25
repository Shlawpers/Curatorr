"""Background scheduler service for automatic sync."""
import asyncio
import logging
from datetime import datetime, timedelta
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from models import ApplyIfNeededResult

logger = logging.getLogger(__name__)


class SyncScheduler:
    """Background scheduler that periodically checks and syncs enabled libraries."""

    def __init__(self):
        self._running = False
        self._task: asyncio.Task | None = None
        self._check_interval = 60  # Check every 60 seconds which libraries need sync

    @property
    def running(self) -> bool:
        return self._running

    async def start(self):
        """Start the scheduler loop."""
        if self._running:
            logger.info("Scheduler already running")
            return
        self._running = True
        self._task = asyncio.create_task(self._run_loop())
        logger.info("Sync scheduler started")

    async def stop(self):
        """Stop the scheduler loop."""
        if not self._running:
            return
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
        logger.info("Sync scheduler stopped")

    async def _run_loop(self):
        """Main scheduler loop."""
        logger.info("Scheduler loop starting")
        while self._running:
            try:
                await self._check_libraries()
            except Exception as e:
                logger.error(f"Scheduler error: {e}", exc_info=True)

            # Wait before next check
            try:
                await asyncio.sleep(self._check_interval)
            except asyncio.CancelledError:
                break

    async def _check_libraries(self):
        """Check all enabled libraries and sync if needed."""
        # Import here to avoid circular imports
        from database import get_all_enabled_sync_libraries, update_sync_status

        enabled = await get_all_enabled_sync_libraries()
        if not enabled:
            return

        now = datetime.utcnow()

        for settings in enabled:
            # Check if enough time has passed since last check
            if settings.last_checked_at:
                try:
                    # Handle string or datetime
                    if isinstance(settings.last_checked_at, str):
                        last_checked = datetime.fromisoformat(settings.last_checked_at.replace('Z', '+00:00'))
                        # Convert to naive UTC for comparison
                        if last_checked.tzinfo:
                            last_checked = last_checked.replace(tzinfo=None)
                    else:
                        last_checked = settings.last_checked_at
                    next_check = last_checked + timedelta(minutes=settings.interval_minutes)
                    if now < next_check:
                        continue
                except Exception as e:
                    logger.warning(f"Error parsing last_checked_at for {settings.library_section_id}: {e}")

            # Time to check this library
            logger.info(f"Scheduler checking library {settings.library_section_id}")
            try:
                # Import the internal function
                from main import apply_if_needed_internal
                result = await apply_if_needed_internal(settings.library_section_id)

                # Update status
                await update_sync_status(
                    settings.library_section_id,
                    last_checked=now,
                    last_applied=now if result.status.value == "applied" else settings.last_applied_at,
                    last_result=result.status.value,
                    last_error=result.error_message
                )

                logger.info(f"Library {settings.library_section_id} sync result: {result.status.value}")

            except Exception as e:
                logger.error(f"Failed to sync library {settings.library_section_id}: {e}", exc_info=True)
                await update_sync_status(
                    settings.library_section_id,
                    last_checked=now,
                    last_result="error",
                    last_error=str(e)
                )


# Global scheduler instance
scheduler = SyncScheduler()
