# Privacy-First Automation Assistant (Python)

This package hosts a FastAPI service and supporting modules for the on-device automation assistant. It is optimized for Apple Silicon via the [MLX](https://ml-explore.github.io/mlx/) runtime, while keeping a portable fallback.

The root `server.js` Express proxy forwards automation routes to this service via `PYTHON_ASSISTANT_URL`, so starting the FastAPI app enables the web UI and CLI end to end.

## Features

- **Async FastAPI service** exposing `/ping`, `/v1/index`, `/v1/query`, `/v1/embed`, `/v1/documents`, `/v1/task`, and `/v1/task/execute` endpoints.
- **MLX-backed inference layer** (`python_assistant.ml.inference.ModelManager`) with optional SentenceTransformer fallback.
- **Personal Knowledge Index (PKI)** stored in SQLite with optional FAISS acceleration, incremental garbage collection, and batch ingestion helpers.
- **Task orchestrator** that drafts automation plans, validates actions against a safe-list, and delegates to sandboxed plugins.
- **Extensible plugin system** based on JSON manifests and async `run` entrypoints loaded from `plugins/installed/`.
- **CLI client** (`python_assistant.ui.cli`) for quick indexing, querying, listing documents, and planning/executing tasks from the terminal.
- **Standalone MLX runtime** (`tools/mlx_runtime.py`) exposing `/embed` and `/predict` HTTP endpoints.

## Getting started

### 1. Environment setup

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -e '.[ml]'
```

### 2. Install MLX binaries (macOS)

```bash
pip install mlx mlx-lm
# optional system-wide install
brew install mlx
```

### 3. Start the assistant service

```bash
export PRIVACY_ASSISTANT_DEBUG=1
python -m python_assistant
```

The server listens on `http://0.0.0.0:5000` by default.

### 4. Use the CLI

```bash
python -m python_assistant.ui.cli ping
python -m python_assistant.ui.cli index ./notes/product.md --doc-id product-notes
python -m python_assistant.ui.cli documents
python -m python_assistant.ui.cli query "summarize the product brief"
python -m python_assistant.ui.cli plan "prepare email recap for the launch" --run
```

### 5. Optional MLX runtime service

```bash
python python_assistant/tools/mlx_runtime.py
```

### 6. Configuration

Set environment variables with the `PRIVACY_ASSISTANT_` prefix (see `core/config.py`). Key values:

- `PRIVACY_ASSISTANT_MLX_MODEL_ID` – HF repo/path for the MLX-compatible model.
- `PRIVACY_ASSISTANT_VECTOR_DB_PATH` – Path to the SQLite store.
- `PRIVACY_ASSISTANT_PLUGIN_ROOT` – Directory containing plugin manifests.

## Directory map

```
python_assistant/
├── core/           # FastAPI server, settings, schemas, orchestrator
├── ml/             # MLX + fallback inference helpers
├── storage/        # Encryption, vector store, ingestion pipeline
├── plugins/        # Plugin registry and manifests
├── ui/             # CLI and future desktop integration entrypoints
├── tools/          # Utility scripts (MLX runtime, etc.)
└── tests/          # Test suite placeholders
```

## Validation checklist

- [ ] `pip install -e '.[ml]'`
- [ ] `python -m python_assistant` returns `Server started`
- [ ] `/ping` responds with `{ "status": "ok" }`
- [ ] Index + query workflow succeeds via CLI
- [ ] `python -m python_assistant.ui.cli documents` lists stored records
- [ ] Task planning endpoint returns a JSON plan and `/v1/task/execute` reports step statuses

## Next steps

- Add sandboxed subprocess execution for plugins (per manifest scopes).
- Wire UI desktop shell (PyQt or Electron wrapper) to the FastAPI API.
- Implement per-user adapter caching and LoRA fine-tune hooks.
- Introduce automated tests covering orchestrator planning and vector store GC.
```