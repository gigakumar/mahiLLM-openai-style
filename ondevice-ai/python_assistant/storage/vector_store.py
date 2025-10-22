"""SQLite-backed personal knowledge index with optional FAISS acceleration."""

from __future__ import annotations

import asyncio
import json
import math
import sqlite3
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

import numpy as np

try:  # Optional FAISS for faster similarity search
    import faiss  # type: ignore

    FAISS_AVAILABLE = True
except Exception:  # pragma: no cover - optional dependency
    faiss = None  # type: ignore
    FAISS_AVAILABLE = False


EMBED_DTYPE = np.float32


@dataclass
class Document:
    doc_id: str
    text: str
    metadata: Dict[str, Any]
    score: float


class VectorStore:
    """Hybrid vector store that persists embeddings in SQLite."""

    def __init__(self, db_path: Path) -> None:
        self.db_path = db_path
        self._conn: Optional[sqlite3.Connection] = None
        self._faiss_index: Optional[Any] = None
        self._faiss_ids: List[str] = []
        self._faiss_dim: Optional[int] = None
        self._lock = asyncio.Lock()

    async def connect(self) -> None:
        if self._conn is not None:
            return
        await asyncio.to_thread(self._connect_sync)

    def _connect_sync(self) -> None:
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(self.db_path)
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS documents (
              id TEXT PRIMARY KEY,
              text TEXT NOT NULL,
              embedding BLOB NOT NULL,
              metadata TEXT,
              created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
              updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        conn.execute(
            """
            CREATE TRIGGER IF NOT EXISTS documents_updated
            AFTER UPDATE ON documents
            BEGIN
              UPDATE documents SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
            END;
            """
        )
        conn.commit()
        conn.row_factory = sqlite3.Row
        self._conn = conn

    async def close(self) -> None:
        if self._conn is None:
            return
        await asyncio.to_thread(self._conn.close)
        self._conn = None

    async def upsert(self, doc_id: str, text: str, embedding: Sequence[float], metadata: Optional[Dict[str, Any]] = None) -> None:
        await self.connect()
        blob = np.asarray(embedding, dtype=EMBED_DTYPE).tobytes()
        meta = json.dumps(metadata or {})
        async with self._lock:
            await asyncio.to_thread(
                self._conn.execute,  # type: ignore[arg-type]
                "INSERT OR REPLACE INTO documents(id, text, embedding, metadata) VALUES (?, ?, ?, ?)",
                (doc_id, text, blob, meta),
            )
            await asyncio.to_thread(self._conn.commit)  # type: ignore[arg-type]
        self._invalidate_faiss()

    async def bulk_upsert(
        self,
        items: Iterable[Tuple[str, str, Sequence[float], Optional[Dict[str, Any]]]],
    ) -> None:
        await self.connect()
        records = [
            (
                doc_id,
                text,
                np.asarray(embedding, dtype=EMBED_DTYPE).tobytes(),
                json.dumps(metadata or {}),
            )
            for doc_id, text, embedding, metadata in items
        ]
        async with self._lock:
            await asyncio.to_thread(
                self._conn.executemany,  # type: ignore[arg-type]
                "INSERT OR REPLACE INTO documents(id, text, embedding, metadata) VALUES (?, ?, ?, ?)",
                records,
            )
            await asyncio.to_thread(self._conn.commit)  # type: ignore[arg-type]
        self._invalidate_faiss()

    async def delete(self, doc_id: str) -> None:
        await self.connect()
        async with self._lock:
            await asyncio.to_thread(
                self._conn.execute,  # type: ignore[arg-type]
                "DELETE FROM documents WHERE id = ?",
                (doc_id,),
            )
            await asyncio.to_thread(self._conn.commit)  # type: ignore[arg-type]
        self._invalidate_faiss()

    async def list_documents(self, limit: int = 100) -> List[Document]:
        await self.connect()
        rows = await asyncio.to_thread(
            self._conn.execute,  # type: ignore[arg-type]
            "SELECT id, text, metadata, 1.0 as score FROM documents ORDER BY updated_at DESC LIMIT ?",
            (limit,),
        )
        fetched = await asyncio.to_thread(rows.fetchall)
        return [
            Document(doc_id=row["id"], text=row["text"], metadata=json.loads(row["metadata"] or "{}"), score=row["score"])
            for row in fetched
        ]

    async def query(self, embedding: Sequence[float], top_k: int = 5) -> List[Document]:
        await self.connect()
        vector = np.asarray(embedding, dtype=EMBED_DTYPE)
        if FAISS_AVAILABLE:
            results = await asyncio.to_thread(self._query_faiss, vector, top_k)
            if results:
                return results
        return await asyncio.to_thread(self._query_cosine, vector, top_k)

    def _query_cosine(self, vector: np.ndarray, top_k: int) -> List[Document]:
        cur = self._conn.execute("SELECT id, text, metadata, embedding FROM documents")  # type: ignore[union-attr]
        rows = cur.fetchall()
        if not rows:
            return []
        embeddings = np.vstack([np.frombuffer(row["embedding"], dtype=EMBED_DTYPE) for row in rows])
        norms = np.linalg.norm(embeddings, axis=1) * np.linalg.norm(vector)
        sims = embeddings @ vector / np.where(norms == 0, 1e-8, norms)
        idx = np.argsort(sims)[::-1][:top_k]
        docs = []
        for i in idx:
            row = rows[int(i)]
            docs.append(
                Document(
                    doc_id=row["id"],
                    text=row["text"],
                    metadata=json.loads(row["metadata"] or "{}"),
                    score=float(sims[int(i)]),
                )
            )
        return docs

    def _query_faiss(self, vector: np.ndarray, top_k: int) -> List[Document]:  # pragma: no cover - requires faiss
        self._ensure_faiss()
        if self._faiss_index is None or self._faiss_dim is None:
            return []
        sims, indices = self._faiss_index.search(vector.reshape(1, -1), top_k)
        docs: List[Document] = []
        for idx, score in zip(indices[0], sims[0]):
            if idx < 0 or idx >= len(self._faiss_ids):
                continue
            doc_id = self._faiss_ids[idx]
            row = self._conn.execute(  # type: ignore[union-attr]
                "SELECT id, text, metadata FROM documents WHERE id = ?",
                (doc_id,),
            ).fetchone()
            if row:
                docs.append(
                    Document(
                        doc_id=row["id"],
                        text=row["text"],
                        metadata=json.loads(row["metadata"] or "{}"),
                        score=float(score),
                    )
                )
        return docs

    def _ensure_faiss(self) -> None:  # pragma: no cover - requires faiss
        if not FAISS_AVAILABLE or faiss is None:
            return
        if self._faiss_index is not None:
            return
        cur = self._conn.execute("SELECT id, embedding FROM documents")  # type: ignore[union-attr]
        rows = cur.fetchall()
        if not rows:
            return
        embeddings = np.vstack([np.frombuffer(row["embedding"], dtype=EMBED_DTYPE) for row in rows])
        dim = embeddings.shape[1]
        index = faiss.IndexFlatIP(dim)
        faiss.normalize_L2(embeddings)
        index.add(embeddings)
        self._faiss_index = index
        self._faiss_ids = [row["id"] for row in rows]
        self._faiss_dim = dim

    def _invalidate_faiss(self) -> None:
        self._faiss_index = None
        self._faiss_ids = []
        self._faiss_dim = None

    async def garbage_collect(self, max_items: int = 10_000) -> int:
        """Simple GC: keep latest *max_items* documents, delete stale ones."""
        await self.connect()
        cur = await asyncio.to_thread(
            self._conn.execute,  # type: ignore[arg-type]
            "SELECT id FROM documents ORDER BY updated_at DESC LIMIT -1 OFFSET ?",
            (max_items,),
        )
        stale = await asyncio.to_thread(cur.fetchall)
        if not stale:
            return 0
        async with self._lock:
            await asyncio.to_thread(
                self._conn.executemany,  # type: ignore[arg-type]
                "DELETE FROM documents WHERE id = ?",
                [(row["id"],) for row in stale],
            )
            await asyncio.to_thread(self._conn.commit)  # type: ignore[arg-type]
        self._invalidate_faiss()
        return len(stale)
