# MahiLLM Automation Demo

MahiLLM delivers OpenAI-grade product polish while routing real automation workloads through a privacy-first Python runtime. This repo bundles the landing page, Node proxy, FastAPI assistant, and a CLI so you can demo indexing, retrieval, and plan execution end to end.

## ✨ Highlights

- **Marketing-grade UX** – Hero, platform, pricing, and safety sections inspired by openai.com with responsive light/dark themes.
- **Streaming console** – Chat interface powered by Server-Sent Events with markdown rendering and client-side analytics.
- **Automation runtime** – Node proxy forwards document indexing, semantic search, and task planning to the Python FastAPI service (with optional Rust gRPC fallback).
- **CLI + plugins** – Rich Typer CLI for indexing/querying/planning and a sample plugin that executes plan steps.

## 🧭 Architecture

```
┌─────────────┐     ┌─────────────┐     ┌──────────────────────┐
│  Frontend   │ --> │  Node Proxy │ --> │ Python Assistant API │
│ (public/*)  │     │ (server.js) │     │ (FastAPI + plugins)  │
└─────────────┘     └─────────────┘     └──────────────────────┘
                                 ↘ optional ↙
                                  Rust gRPC
```

- **Frontend** (`public/`): marketing site, chat console, automation panel, and DevTools forms.
- **Proxy** (`server.js`): Express server serving static assets, streaming `/api/chat`, and proxying `/api/index|query|documents|plan|task/execute` to FastAPI.
- **Python assistant** (`ondevice-ai/python_assistant/`): FastAPI app with vector store, MLX-backed embeddings, task orchestrator, and plugin system.
- **CLI** (`python_assistant/ui/cli.py`): convenience client for ping/index/query/documents/plan/execute.

## 🔧 Setup

Clone the repo and install Node dependencies:

```bash
git clone https://github.com/gigakumar/mahiLLM-openai-style.git
cd mahiLLM-openai-style
npm install
```

### 1. Python assistant

```bash
cd ondevice-ai/python_assistant
python3 -m venv .venv
source .venv/bin/activate
pip install -e '.[ml]'

# optional: configure settings
export PRIVACY_ASSISTANT_DEBUG=1
export PRIVACY_ASSISTANT_MLX_MODEL_ID=mlx-community/Meta-Llama-3-8B-Instruct

# run the FastAPI service (defaults to http://127.0.0.1:5000)
python -m python_assistant.core.server
```

### 2. Node proxy + web

In another terminal from the repo root:

```bash
export PYTHON_ASSISTANT_URL=http://127.0.0.1:5000   # optional, defaults to this value
# export USE_ASSISTANT_GRPC=1                       # enable Rust gRPC fallback if available
npm run start
```

Visit <http://127.0.0.1:3000> for the marketing site, automation demo, and DevTools console. The proxy will call the Python assistant for all `/api/*` automation endpoints and continue to serve `/api/chat` streaming responses.

## 🖥️ Frontend tours

- **Chat console** – Streams responses via `/api/chat` with markdown + code highlighting and latency metrics.
- **Automation planner** – Collects a goal and data sources, renders the returned plan, and lets you execute it inline with per-step approvals.
- **DevTools** – Index documents, run semantic search, and inspect gRPC streaming (when enabled) directly from the UI.

## 💻 CLI quickstart

```bash
cd ondevice-ai/python_assistant
source .venv/bin/activate

python -m python_assistant.ui.cli ping
python -m python_assistant.ui.cli index ./README.md --doc-id readme
python -m python_assistant.ui.cli documents
python -m python_assistant.ui.cli query "summarize the project goals"
python -m python_assistant.ui.cli plan "draft a launch recap" --run
```

The `--run` flag interactively approves plan steps and calls `/v1/task/execute` through the FastAPI runtime.

## 🔌 API overview

| Node endpoint            | Proxied FastAPI route | Description                               |
|--------------------------|-----------------------|-------------------------------------------|
| `POST /api/index`        | `POST /v1/index`      | Store a document in the personal index     |
| `POST /api/query`        | `POST /v1/query`      | Semantic search + answer synthesis         |
| `GET /api/documents`     | `GET /v1/documents`   | List indexed documents                     |
| `POST /api/plan`         | `POST /v1/task`       | Generate an executable automation plan     |
| `POST /api/task/execute` | `POST /v1/task/execute`| Execute plan steps with approval metadata |
| `POST /api/embed`        | `POST /v1/embed`      | Embed text blobs (used by DevTools)        |
| `POST /api/chat`         | — (mock/OpenAI)       | Streaming chat demo (SSE)                  |

Set `USE_ASSISTANT_GRPC=1` to fall back to the Rust core for `*/assistant/*`, `/api/index`, `/api/query`, and `/api/embed` if the FastAPI service is unavailable.

## 🧩 Plugins

Sample plugin manifests live under `ondevice-ai/python_assistant/plugins/installed/`. Each plugin exposes a JSON manifest plus a Python module with an async `run` coroutine. The orchestrator enforces confirmations and scopes before executing plugin actions.

## ✅ Validation checklist

- `python -m python_assistant.core.server` boots and serves `/ping`.
- `npm run start` serves <http://127.0.0.1:3000> and the `/api/*` endpoints.
- `python -m python_assistant.ui.cli index ...` followed by `query` returns matching documents.
- `/api/plan` returns a multi-step plan and `/api/task/execute` reports step results.

## 🤝 Contributing

Pull requests are welcome! Open an issue for feature ideas or bug reports.

## 📄 License

MIT License © MahiLLM Labs
