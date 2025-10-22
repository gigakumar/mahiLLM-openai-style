"""Runtime orchestrator tying together embeddings, retrieval, and automation."""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Dict, Iterable, List, Optional

from .config import get_settings
from .schemas import Message, QueryResponse, RetrievedDocument, TaskGoal, TaskPlan, TaskStep
from ..ml.inference import get_model_manager
from ..plugins.loader import PluginRegistry
from ..storage.vector_store import Document, VectorStore

logger = logging.getLogger(__name__)

SAFE_ACTIONS = {
    "open_app",
    "send_email",
    "summarize_text",
    "set_reminder",
    "draft_reply",
    "call_plugin",
    "noop",
}


@dataclass
class ActionExecution:
    step: TaskStep
    status: str = "pending"
    result: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None


class AssistantRuntime:
    """Coordinate model inference, storage, and automation flows."""

    def __init__(self) -> None:
        self.settings = get_settings()
        self.vector_store = VectorStore(self.settings.vector_db_path)
        self.model_manager = get_model_manager(self.settings.mlx_model_id)
        self.plugins = PluginRegistry(self.settings.plugin_root)
        self._ready = False
        self._lock = asyncio.Lock()

    async def startup(self) -> None:
        if self._ready:
            return
        async with self._lock:
            if self._ready:
                return
            await self.vector_store.connect()
            await self.model_manager.ensure_loaded()
            await self.plugins.load()
            self._ready = True
            logger.info("Assistant runtime ready")

    async def shutdown(self) -> None:
        await self.vector_store.close()
        self._ready = False

    async def embed(self, texts: Iterable[str]) -> List[List[float]]:
        await self.startup()
        return await self.model_manager.embed(list(texts))

    async def index(self, document_id: str, text: str, metadata: Dict[str, str]) -> int:
        await self.startup()
        vectors = await self.embed([text])
        await self.vector_store.upsert(document_id, text, vectors[0], metadata)
        token_estimate = max(1, len(text.split()))
        logger.debug("Indexed %s (%d tokens)", document_id, token_estimate)
        return token_estimate

    async def query(self, query: str, top_k: int = 5) -> QueryResponse:
        await self.startup()
        vector = (await self.embed([query]))[0]
        docs = await self.vector_store.query(vector, top_k=top_k)
        retrieved = [
            RetrievedDocument(
                document_id=doc.doc_id,
                text=doc.text,
                metadata=doc.metadata,
                score=doc.score,
            )
            for doc in docs
        ]
        context_snippets = "\n\n".join(f"[doc] {doc.text[:500]}" for doc in retrieved[:3])
        prompt = (
            "You are a privacy-first automation copilot. Use only the provided documents to answer the query. "
            "If information is missing, say you do not know.\n\nDocuments:\n"
            f"{context_snippets}\n\nQuery: {query}\nAnswer:"
        )
        try:
            answer = await self.model_manager.generate(prompt, max_tokens=self.settings.mlx_max_tokens, temperature=0.3)
        except Exception as exc:  # pragma: no cover - model failure
            logger.warning("Generation failed: %s", exc)
            answer = "I do not have enough information to answer yet."
        return QueryResponse(answer=answer.strip(), matches=retrieved)

    async def plan(self, goal: TaskGoal, history: Iterable[Message]) -> TaskPlan:
        await self.startup()
        prompt = (
            "Design a short automation plan. Respond as JSON {\"steps\": [...]} where each step has keys action, description, params, requires_confirmation. "
            "Allowed actions: open_app, send_email, summarize_text, call_plugin, set_reminder, draft_reply, noop. "
            "Use sources field to decide if external data is available."
        )
        payload = {
            "goal": goal.goal,
            "sources": goal.sources,
            "history": [msg.model_dump() for msg in history],
        }
        try:
            completion = await self.model_manager.generate(
                json.dumps({"prompt": prompt, "payload": payload}),
                max_tokens=256,
                temperature=0.2,
            )
        except Exception as exc:  # pragma: no cover - model failure
            logger.warning("Plan generation failed: %s", exc)
            completion = ""
        steps = self._parse_steps(completion)
        if not steps:
            steps = [
                TaskStep(
                    id="step-1",
                    action="noop",
                    description="Awaiting additional instructions.",
                    params={},
                    requires_confirmation=False,
                )
            ]
        metadata = {
            "raw": completion,
            "goal": goal.goal,
            "sources": json.dumps(goal.sources),
        }
        return TaskPlan(status="draft", steps=steps, metadata=metadata)

    def _parse_steps(self, raw: str) -> List[TaskStep]:
        try:
            data = json.loads(raw)
        except Exception:
            return []
        steps = data.get("steps") if isinstance(data, dict) else None
        if not isinstance(steps, list):
            return []
        parsed: List[TaskStep] = []
        for idx, item in enumerate(steps, start=1):
            action = item.get("action", "noop")
            if action not in SAFE_ACTIONS:
                action = "noop"
            parsed.append(
                TaskStep(
                    id=item.get("id", f"step-{idx}"),
                    action=action,
                    description=item.get("description", ""),
                    params=item.get("params", {}),
                    requires_confirmation=bool(item.get("requires_confirmation", False)),
                )
            )
        return parsed

    async def execute(self, plan: TaskPlan, approvals: Optional[Dict[str, bool]] = None) -> List[ActionExecution]:
        await self.startup()
        approvals = approvals or {}
        executions: List[ActionExecution] = []
        for step in plan.steps:
            execution = ActionExecution(step=step, status="pending")
            executions.append(execution)
            if step.action not in SAFE_ACTIONS:
                execution.status = "skipped"
                execution.error = "unsafe_action"
                continue
            if step.requires_confirmation and not approvals.get(step.id, False):
                execution.status = "skipped"
                execution.error = "requires_approval"
                continue
            handler = self.plugins.resolve(step.action)
            if handler is None:
                execution.status = "skipped"
                execution.error = "missing_plugin"
                continue
            execution.started_at = datetime.utcnow()
            try:
                execution.status = "running"
                result = await handler(step.params)
                execution.result = result if isinstance(result, dict) else {"output": str(result)}
                execution.status = "completed"
            except Exception as exc:  # pragma: no cover - plugin runtime
                execution.status = "failed"
                execution.error = str(exc)
            finally:
                execution.completed_at = datetime.utcnow()
        return executions

    async def list_documents(self, limit: int = 100) -> List[Document]:
        await self.startup()
        return await self.vector_store.list_documents(limit=limit)
