"""FastAPI service exposing assistant automation endpoints."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import AsyncIterator, List, Literal, cast

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .orchestrator import AssistantRuntime
from .schemas import (
    ActionExecutionResult,
    EmbedRequest,
    EmbedResponse,
    IndexRequest,
    IndexResponse,
    RetrievedDocument,
    QueryRequest,
    QueryResponse,
    TaskRequest,
    TaskResponse,
    TaskExecuteRequest,
    TaskExecuteResponse,
)

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)

runtime = AssistantRuntime()


@asynccontextmanager
async def app_lifespan(_: FastAPI) -> AsyncIterator[None]:
    await runtime.startup()
    try:
        yield
    finally:
        await runtime.shutdown()


app = FastAPI(title="Mahi Privacy Assistant", lifespan=app_lifespan)

settings = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allow_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/ping")
async def ping() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/v1/embed", response_model=EmbedResponse)
async def embed(request: EmbedRequest) -> EmbedResponse:
    vectors = await runtime.embed(request.texts)
    return EmbedResponse(vectors=vectors)


@app.post("/v1/index", response_model=IndexResponse)
async def index_document(request: IndexRequest) -> IndexResponse:
    tokens = await runtime.index(request.document_id, request.text, request.metadata)
    return IndexResponse(status="ok", stored_tokens=tokens)


@app.post("/v1/query", response_model=QueryResponse)
async def query_documents(request: QueryRequest) -> QueryResponse:
    return await runtime.query(request.query, top_k=request.top_k)


@app.get("/v1/documents", response_model=List[RetrievedDocument])
async def list_documents(limit: int = 50) -> List[RetrievedDocument]:
    docs = await runtime.list_documents(limit=limit)
    return [
        RetrievedDocument(
            document_id=doc.doc_id,
            text=doc.text,
            metadata=doc.metadata,
            score=doc.score,
        )
        for doc in docs
    ]


@app.post("/v1/task", response_model=TaskResponse)
async def create_task(request: TaskRequest) -> TaskResponse:
    plan = await runtime.plan(request.goal, request.history)
    audit_id = f"plan-{request.goal.goal[:8]}"
    return TaskResponse(plan=plan, audit_id=audit_id)


@app.post("/v1/task/execute", response_model=TaskExecuteResponse)
async def execute_task(request: TaskExecuteRequest) -> TaskExecuteResponse:
    executions = await runtime.execute(request.plan, approvals=request.approvals)
    allowed_status = {"pending", "running", "completed", "failed", "skipped"}
    results = [
        ActionExecutionResult(
            step_id=execution.step.id,
            action=execution.step.action,
            status=cast(Literal["pending", "running", "completed", "failed", "skipped"], (
                execution.status if execution.status in allowed_status else "failed"
            )),
            result=execution.result or {},
            error=execution.error,
        )
        for execution in executions
    ]
    return TaskExecuteResponse(plan=request.plan, executions=results)


def run() -> None:
    """Run the FastAPI application with Uvicorn."""
    import uvicorn

    settings = get_settings()
    uvicorn.run(
        "python_assistant.core.server:app",
        host=settings.api_host,
        port=settings.api_port,
        reload=settings.debug,
    )


if __name__ == "__main__":
    run()
