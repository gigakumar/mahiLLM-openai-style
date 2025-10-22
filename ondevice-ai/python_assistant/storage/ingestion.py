"""Local ingestion pipeline for the personal knowledge index."""

from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass
from pathlib import Path
from typing import AsyncIterator, Dict, Iterable, List, Optional

from .vector_store import VectorStore


@dataclass
class IngestedItem:
    doc_id: str
    text: str
    metadata: Dict[str, str]


async def read_text_file(path: Path) -> Optional[str]:
    try:
        return path.read_text(encoding="utf-8")
    except Exception:
        return None


async def ingest_files(store: VectorStore, files: Iterable[Path], embedder, batch_size: int = 8) -> int:
    """Ingest a list of files into the vector store."""
    tasks: List[IngestedItem] = []
    count = 0
    for idx, file_path in enumerate(files):
        if not file_path.exists() or file_path.suffix.lower() not in {".txt", ".md", ".markdown", ".json"}:
            continue
        content = await read_text_file(file_path)
        if not content:
            continue
        doc_id = f"file::{file_path.name}::{file_path.stat().st_mtime_ns}"
        tasks.append(
            IngestedItem(
                doc_id=doc_id,
                text=content,
                metadata={
                    "source": "file",
                    "path": str(file_path.resolve()),
                },
            )
        )
        if len(tasks) >= batch_size:
            await _flush(store, tasks, embedder)
            count += len(tasks)
            tasks.clear()
    if tasks:
        await _flush(store, tasks, embedder)
        count += len(tasks)
    return count


async def _flush(store: VectorStore, items: List[IngestedItem], embedder) -> None:
    vectors = await embedder.embed([item.text for item in items])
    await store.bulk_upsert(
        (
            item.doc_id,
            item.text,
            vector,
            item.metadata,
        )
        for item, vector in zip(items, vectors)
    )


async def incremental_cleanup(store: VectorStore, max_items: int = 10_000) -> int:
    return await store.garbage_collect(max_items=max_items)
