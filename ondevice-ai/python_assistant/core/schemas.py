"""Pydantic models describing public API contracts."""

from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field


class Message(BaseModel):
    role: Literal["user", "assistant", "system"]
    content: str


class IndexRequest(BaseModel):
    document_id: str = Field(..., description="Stable identifier for the document")
    text: str = Field(..., description="Raw document content")
    metadata: Dict[str, str] = Field(default_factory=dict)


class IndexResponse(BaseModel):
    status: Literal["ok", "error"] = "ok"
    stored_tokens: int = 0


class QueryRequest(BaseModel):
    query: str
    top_k: int = Field(5, ge=1, le=20)


class RetrievedDocument(BaseModel):
    document_id: str
    text: str
    metadata: Dict[str, str] = Field(default_factory=dict)
    score: float


class QueryResponse(BaseModel):
    answer: str
    matches: List[RetrievedDocument] = Field(default_factory=list)


class EmbedRequest(BaseModel):
    texts: List[str]


class EmbedResponse(BaseModel):
    vectors: List[List[float]]


class TaskGoal(BaseModel):
    goal: str
    context: Dict[str, str] = Field(default_factory=dict)
    sources: Dict[str, bool] = Field(default_factory=dict)


class TaskStep(BaseModel):
    id: str
    action: Literal[
        "open_app",
        "send_email",
        "summarize_text",
        "call_plugin",
        "set_reminder",
        "draft_reply",
        "noop",
    ]
    description: str
    params: Dict[str, str] = Field(default_factory=dict)
    requires_confirmation: bool = False


class TaskPlan(BaseModel):
    status: Literal["draft", "approved", "rejected"] = "draft"
    steps: List[TaskStep] = Field(default_factory=list)
    metadata: Dict[str, str] = Field(default_factory=dict)


class TaskRequest(BaseModel):
    goal: TaskGoal
    history: List[Message] = Field(default_factory=list)


class TaskResponse(BaseModel):
    plan: TaskPlan
    audit_id: str


class ActionExecutionResult(BaseModel):
    step_id: str
    action: str
    status: Literal["pending", "running", "completed", "failed", "skipped"]
    result: Dict[str, Any] = Field(default_factory=dict)
    error: Optional[str] = None


class TaskExecuteRequest(BaseModel):
    plan: TaskPlan
    approvals: Dict[str, bool] = Field(default_factory=dict)


class TaskExecuteResponse(BaseModel):
    plan: TaskPlan
    executions: List[ActionExecutionResult] = Field(default_factory=list)
