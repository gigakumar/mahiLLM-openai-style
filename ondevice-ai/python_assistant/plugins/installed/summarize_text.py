"""Example plugin that returns a short summary of provided text."""

from __future__ import annotations

import asyncio
from typing import Any, Dict

import textwrap


async def run(params: Dict[str, Any]) -> Dict[str, Any]:
    text = str(params.get("text", "")).strip()
    if not text:
        return {"summary": "No text provided."}
    await asyncio.sleep(0)  # allow event loop switch
    paragraphs = [p.strip() for p in text.splitlines() if p.strip()]
    combined = " ".join(paragraphs)
    if len(combined) <= 320:
        summary = combined
    else:
        summary = textwrap.shorten(combined, width=320, placeholder="…")
    return {
        "summary": summary,
        "length": len(combined),
    }
