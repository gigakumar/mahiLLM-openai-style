"""Plugin registry for sandboxed automation actions."""

from __future__ import annotations

import asyncio
import importlib.util
import json
import logging
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Awaitable, Callable, Dict, Optional

logger = logging.getLogger(__name__)

ActionHandler = Callable[[Dict[str, Any]], Awaitable[Dict[str, Any]]]


@dataclass
class PluginManifest:
    name: str
    version: str
    scopes: Dict[str, bool]
    entrypoint: str
    path: Path


class PluginRegistry:
    """Load YAML/JSON plugin manifests and expose async handlers."""

    def __init__(self, root: Path) -> None:
        self.root = root
        self._handlers: Dict[str, ActionHandler] = {}
        self._manifests: Dict[str, PluginManifest] = {}
        self._load_lock = asyncio.Lock()

    async def load(self) -> None:
        async with self._load_lock:
            self._handlers.clear()
            self._manifests.clear()
            if not self.root.exists():
                return
            for manifest_path in self.root.glob("**/*.json"):
                try:
                    manifest = self._parse_manifest(manifest_path)
                except Exception as exc:
                    logger.warning("Skipping plugin manifest %s: %s", manifest_path, exc)
                    continue
                handler = await self._import_handler(manifest)
                if handler is None:
                    continue
                self._manifests[manifest.name] = manifest
                self._handlers[manifest.name] = handler

    def resolve(self, action: str) -> Optional[ActionHandler]:
        return self._handlers.get(action)

    def _parse_manifest(self, path: Path) -> PluginManifest:
        data = json.loads(path.read_text())
        return PluginManifest(
            name=data["name"],
            version=data.get("version", "0.1.0"),
            scopes=data.get("scopes", {}),
            entrypoint=data["entrypoint"],
            path=path.parent,
        )

    async def _import_handler(self, manifest: PluginManifest) -> Optional[ActionHandler]:
        entry = manifest.path / manifest.entrypoint
        if not entry.exists():
            logger.warning("Plugin entrypoint missing: %s", entry)
            return None
        spec = importlib.util.spec_from_file_location(f"plugin_{manifest.name}", entry)
        if spec is None or spec.loader is None:
            logger.warning("Unable to load plugin module: %s", entry)
            return None
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)  # type: ignore[call-arg]
        handler = getattr(module, "run", None)
        if handler is None or not asyncio.iscoroutinefunction(handler):
            logger.warning("Plugin %s must expose async run(params) -> dict", manifest.name)
            return None
        return handler  # type: ignore[return-value]
