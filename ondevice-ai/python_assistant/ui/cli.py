"""Command-line interface for the privacy-first assistant."""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Dict, Optional

import httpx
import typer
from rich.console import Console
from rich.table import Table

app = typer.Typer(help="Interact with the privacy assistant service")
console = Console()

DEFAULT_API = "http://127.0.0.1:5000"


async def _post(endpoint: str, payload: dict) -> dict:
    async with httpx.AsyncClient(timeout=60) as client:
        res = await client.post(endpoint, json=payload)
        res.raise_for_status()
        return res.json()


async def _get(endpoint: str, params: Optional[dict] = None) -> dict:
    async with httpx.AsyncClient(timeout=60) as client:
        res = await client.get(endpoint, params=params)
        res.raise_for_status()
        return res.json()


@app.command()
def ping(server: str = DEFAULT_API) -> None:
    """Check server health."""
    async def _run() -> None:
        async with httpx.AsyncClient(timeout=10) as client:
            res = await client.get(f"{server}/ping")
            res.raise_for_status()
            console.print(res.json())

    asyncio.run(_run())


@app.command()
def index(
    path: Path = typer.Argument(..., help="Path to a text/markdown/json file"),
    doc_id: Optional[str] = typer.Option(None, help="Override document ID"),
    server: str = DEFAULT_API,
) -> None:
    """Index a document into the personal knowledge base."""
    async def _run() -> None:
        text = path.read_text(encoding="utf-8")
        payload = {
            "document_id": doc_id or path.stem,
            "text": text,
            "metadata": {"source": "file", "path": str(path.resolve())},
        }
        data = await _post(f"{server}/v1/index", payload)
        console.print(data)

    asyncio.run(_run())


@app.command()
def documents(limit: int = 20, server: str = DEFAULT_API) -> None:
    """List indexed documents."""

    async def _run() -> None:
        data = await _get(f"{server}/v1/documents", params={"limit": limit})
        table = Table(title="Indexed Documents")
        table.add_column("ID")
        table.add_column("Score")
        table.add_column("Preview")
        for doc in data:
            table.add_row(doc["document_id"], f"{doc['score']:.2f}", doc["text"][:80])
        console.print(table)

    asyncio.run(_run())


def _render_plan_table(plan: dict) -> Table:
    table = Table(title="Proposed Steps")
    table.add_column("ID", style="cyan")
    table.add_column("Action", style="magenta")
    table.add_column("Description")
    table.add_column("Needs OK?", justify="center")
    for step in plan.get("steps", []):
        table.add_row(
            step.get("id", ""),
            step.get("action", ""),
            step.get("description", "")[:80],
            "✅" if step.get("requires_confirmation") else "",
        )
    return table


@app.command()
def query(prompt: str, top_k: int = 5, server: str = DEFAULT_API) -> None:
    """Query the indexed knowledge."""
    async def _run() -> None:
        payload = {"query": prompt, "top_k": top_k}
        data = await _post(f"{server}/v1/query", payload)
        console.print(f"Answer: {data['answer']}")
        table = Table(title="Matches")
        table.add_column("Score")
        table.add_column("Document ID")
        table.add_column("Snippet")
        for match in data.get("matches", []):
            table.add_row(f"{match['score']:.3f}", match['document_id'], match['text'][:80])
        console.print(table)

    asyncio.run(_run())


@app.command()
def plan(
    goal: str,
    run: bool = typer.Option(False, help="Execute plan after interactive approval."),
    server: str = DEFAULT_API,
) -> None:
    """Request an automation plan for a goal (optionally executing it)."""

    async def _run() -> None:
        payload = {
            "goal": {"goal": goal, "sources": {"calendar": True}},
            "history": [],
        }
        data = await _post(f"{server}/v1/task", payload)
        plan_data = data["plan"]
        console.print(f"Audit ID: {data['audit_id']}")
        console.print(_render_plan_table(plan_data))
        if not run:
            return
        approvals: Dict[str, bool] = {}
        for step in plan_data.get("steps", []):
            if not step.get("requires_confirmation"):
                approvals[step["id"]] = True
                continue
            approvals[step["id"]] = typer.confirm(
                f"Approve step {step['id']} ({step.get('description', '')})?",
                default=True,
            )
        exec_resp = await _post(
            f"{server}/v1/task/execute",
            {"plan": plan_data, "approvals": approvals},
        )
        exec_table = Table(title="Execution Results")
        exec_table.add_column("Step")
        exec_table.add_column("Status")
        exec_table.add_column("Summary")
        for item in exec_resp.get("executions", []):
            result = item.get("result", {})
            summary = result.get("summary") or result.get("output", "")
            exec_table.add_row(item["step_id"], item["status"], str(summary)[:80])
        console.print(exec_table)

    asyncio.run(_run())


if __name__ == "__main__":
    app()
