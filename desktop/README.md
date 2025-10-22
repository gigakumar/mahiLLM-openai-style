# MahiLLM Desktop (macOS)

An Electron-based macOS app that launches the local Privacy Assistant (FastAPI) and loads the existing UI.

## Dev Run

1. Ensure the Python env is ready and dependencies installed (already configured at `.venv`).
2. Install desktop dependencies and run:

```zsh
cd desktop
npm install
npm run dev
```

Or from repo root:

```zsh
npm run desktop
```

The app will:
- Start `uvicorn` for `python_assistant.core.server` on 127.0.0.1:5000.
- Load `public/index.html` in a native window.
- Call FastAPI endpoints directly (no Node proxy) via `/v1/*`.

## Packaging

For distribution, add an Electron packager (electron-builder or forge) and notarization settings.

```zsh
# example (not yet configured):
npm i -D electron-builder
# add build config in package.json, then
npm run build
```

## Troubleshooting
- If the assistant fails to start, check that `.venv/bin/python` exists and deps are installed.
- Ports 5000 (assistant) must be free.
- Logs appear in the app console and devtools.
