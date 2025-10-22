"""Placeholder desktop UI launcher (future PyQt/Electron integration)."""

from __future__ import annotations

import webbrowser

from ..core.config import get_settings


def launch() -> None:
    """Open the local control panel in the default browser."""
    settings = get_settings()
    url = f"http://{settings.api_host}:{settings.api_port}"  # could point to a desktop-app shell
    webbrowser.open(url)


if __name__ == "__main__":
    launch()
