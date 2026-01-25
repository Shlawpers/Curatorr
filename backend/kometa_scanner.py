"""Kometa YAML scanner for discovering collection definitions."""
import os
import yaml
from pathlib import Path
from dataclasses import dataclass, field
from typing import Optional
import logging

logger = logging.getLogger(__name__)


@dataclass
class KometaCollection:
    """A collection definition found in Kometa YAML files."""
    name: str
    file_path: str
    file_name: str

    # Optional metadata from Kometa config
    sort_title: Optional[str] = None
    collection_order: Optional[str] = None

    # Visibility can be bool OR schedule string (e.g., "range(12/01-12/31)")
    visible_home: Optional[bool | str] = None
    visible_library: Optional[bool | str] = None
    visible_shared: Optional[bool | str] = None

    # Schedule info if defined in Kometa (controls when collection runs/exists)
    # Can be string, list of strings, or None
    schedule: Optional[str | list] = None

    # Template info
    template_name: Optional[str] = None
    template_variables: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        """Convert to dictionary for API responses."""
        return {
            "name": self.name,
            "file_path": self.file_path,
            "file_name": self.file_name,
            "sort_title": self.sort_title,
            "collection_order": self.collection_order,
            "visible_home": self.visible_home,
            "visible_library": self.visible_library,
            "visible_shared": self.visible_shared,
            "schedule": self.schedule,
            "template_name": self.template_name,
        }


class KometaScanner:
    """Scans Kometa configuration files for collection definitions."""

    def __init__(self, config_path: str):
        """
        Initialize scanner with Kometa config directory.

        Args:
            config_path: Path to Kometa config directory (containing config.yml
                        and collections folder).
        """
        self.config_path = Path(config_path)
        self.collections_path = self.config_path / "collections"
        self._collections_cache: list[KometaCollection] = []

    # Map Plex library types to Kometa subdirectory names
    LIBRARY_TYPE_TO_SUBDIR = {
        "movie": "movies",
        "show": "tv-shows",
    }

    def scan(self, library_type: str = None) -> list[KometaCollection]:
        """
        Scan Kometa collection files and extract collection definitions.

        Args:
            library_type: Optional Plex library type ("movie" or "show") to filter
                         collections to only those for that library type.
                         If None, scans all subdirectories.

        Returns:
            List of KometaCollection objects.
        """
        collections = []

        if not self.collections_path.exists():
            logger.warning(f"Collections path does not exist: {self.collections_path}")
            return collections

        # Determine which subdirectories to scan
        if library_type and library_type in self.LIBRARY_TYPE_TO_SUBDIR:
            # Only scan the subdirectory for this library type
            subdir_name = self.LIBRARY_TYPE_TO_SUBDIR[library_type]
            subdir = self.collections_path / subdir_name
            if subdir.exists() and subdir.is_dir():
                for yaml_file in subdir.glob("*.yml"):
                    file_collections = self._parse_collection_file(yaml_file)
                    collections.extend(file_collections)
                logger.info(f"Scanned {len(collections)} collections from {subdir_name}/ for library_type={library_type}")
            else:
                logger.warning(f"Kometa subdirectory not found: {subdir}")
        else:
            # Scan all subdirectories (movies, tv-shows, playlists)
            for subdir in self.collections_path.iterdir():
                if subdir.is_dir() and subdir.name not in ["archived", ".DS_Store"]:
                    for yaml_file in subdir.glob("*.yml"):
                        file_collections = self._parse_collection_file(yaml_file)
                        collections.extend(file_collections)

            # Also scan root collections folder
            for yaml_file in self.collections_path.glob("*.yml"):
                file_collections = self._parse_collection_file(yaml_file)
                collections.extend(file_collections)

            logger.info(f"Scanned {len(collections)} collections from all Kometa config")

        self._collections_cache = collections
        return collections

    def _parse_collection_file(self, file_path: Path) -> list[KometaCollection]:
        """Parse a single Kometa collection YAML file."""
        collections = []

        try:
            with open(file_path, "r", encoding="utf-8") as f:
                content = yaml.safe_load(f)

            if not content:
                return collections

            # Handle 'collections' key
            if "collections" in content:
                for name, config in content["collections"].items():
                    collection = self._parse_collection_entry(
                        name, config, file_path
                    )
                    collections.append(collection)

            # Handle 'dynamic_collections' key
            if "dynamic_collections" in content:
                for name, config in content["dynamic_collections"].items():
                    # Dynamic collections create multiple actual collections
                    # For now, just track the definition
                    collection = KometaCollection(
                        name=f"{name} (dynamic)",
                        file_path=str(file_path),
                        file_name=file_path.name,
                    )
                    collections.append(collection)

        except yaml.YAMLError as e:
            logger.error(f"YAML parse error in {file_path}: {e}")
        except Exception as e:
            logger.error(f"Error reading {file_path}: {e}")

        return collections

    def _parse_collection_entry(
        self,
        name: str,
        config: dict,
        file_path: Path
    ) -> KometaCollection:
        """Parse a single collection entry from YAML."""
        if config is None:
            config = {}

        collection = KometaCollection(
            name=name,
            file_path=str(file_path),
            file_name=file_path.name,
            sort_title=config.get("sort_title"),
            collection_order=config.get("collection_order"),
            visible_home=config.get("visible_home"),
            visible_library=config.get("visible_library"),
            visible_shared=config.get("visible_shared"),
            schedule=config.get("schedule"),
        )

        # Handle template usage
        if "template" in config:
            template_config = config["template"]
            if isinstance(template_config, dict):
                collection.template_name = template_config.get("name")
                collection.template_variables = {
                    k: v for k, v in template_config.items() if k != "name"
                }
            elif isinstance(template_config, str):
                collection.template_name = template_config

        return collection

    def get_collection_by_name(self, name: str) -> Optional[KometaCollection]:
        """Find a collection by name from the cached scan results."""
        for collection in self._collections_cache:
            if collection.name == name:
                return collection
        return None

    def get_collections_by_file(self, file_name: str) -> list[KometaCollection]:
        """Get all collections defined in a specific file."""
        return [c for c in self._collections_cache if c.file_name == file_name]

    def get_collection_files(self) -> list[str]:
        """Get list of all scanned collection file names."""
        return list(set(c.file_name for c in self._collections_cache))
