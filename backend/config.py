"""Configuration management for Plex Collection Scheduler."""
import os
from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import Literal


class Settings(BaseSettings):
    """
    Application settings loaded from environment variables.

    All settings can be configured via environment variables:
    - PLEX_URL: Your Plex server URL (e.g., http://192.168.1.100:32400)
    - PLEX_TOKEN: Your Plex authentication token
    - KOMETA_CONFIG_PATH: Path to Kometa config directory (for schedule detection)
    - APPLY_MODE: 'dry-run' (read-only) or 'apply' (allows changes to Plex)
    - DATABASE_PATH: Path to SQLite database file
    - TZ: Timezone (e.g., America/Toronto)
    """

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",  # Ignore extra env vars like TZ
    )

    # Plex Configuration
    plex_url: str = "http://localhost:32400"
    plex_token: str = ""

    # Kometa Configuration (optional - enables schedule conflict detection)
    kometa_config_path: str = "/kometa/config"

    # Application Mode
    # "dry-run" = read-only, no writes to Plex
    # "apply" = allow writes with explicit user action
    apply_mode: Literal["dry-run", "apply"] = "dry-run"

    # Database - stored in /app/data for Docker volume persistence
    database_path: str = "/app/data/plex_scheduler.db"

    @property
    def database_url(self) -> str:
        """Generate SQLite URL from database path."""
        return f"sqlite+aiosqlite:///{self.database_path}"

    # Server
    host: str = "0.0.0.0"
    port: int = 5100

    # Static files (for Docker production mode)
    # Set to /app/static in Docker, empty for development
    static_dir: str = ""

    # Retry configuration for Plex API writes
    max_reorder_retries: int = 2
    retry_delay_ms: tuple[int, int] = (250, 750)

    # Feature flags
    simulate_reorder_failure: bool = False  # For testing error paths

    # Authentication (optional - disabled by default)
    # Set CURATORR_AUTH_ENABLED=true to require password login
    auth_enabled: bool = False
    auth_password: str = ""  # Required if auth_enabled is true
    session_secret: str = "curatorr-dev-secret-change-in-production"  # For signing session cookies

    def ensure_data_dir(self):
        """Ensure the data directory exists for the database."""
        data_dir = os.path.dirname(self.database_path)
        if data_dir and not os.path.exists(data_dir):
            os.makedirs(data_dir, exist_ok=True)


settings = Settings()
# Ensure data directory exists on startup
settings.ensure_data_dir()
