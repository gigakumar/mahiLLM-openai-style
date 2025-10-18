# MahiLLM – OpenAI‑style Chat UI

A lightweight, modern chat app with the OpenAI/ChatGPT vibe:
- Dark, minimal UI with sidebar history
- Smooth streaming responses (word-by-word)
- Markdown rendering and copy buttons for code
- Works out of the box with a friendly mock; optional real OpenAI streaming via API key

## Quick start

1) Install dependencies

```bash
npm install
```

2) (Optional) Configure OpenAI
- Copy `.env.example` to `.env`
- Set `OPENAI_API_KEY` to your key
- Optionally set `OPENAI_MODEL` (defaults to `gpt-4o-mini`)

3) Run the server

```bash
npm start
```

Open http://localhost:3000 and chat.

## Environment variables

- `OPENAI_API_KEY` – If set, the server will stream from OpenAI’s Chat Completions API.
- `OPENAI_MODEL` – Model to use (default: `gpt-4o-mini`).
- `PORT` – Port for the Express server (default: 3000).

## Project structure

- `server.js` – Express server with streaming endpoint (`POST /api/chat`).
- `public/` – Static frontend (no build step required).
  - `index.html` – ChatGPT‑like layout
  - `styles.css` – Dark theme, sidebar, messages, composer
  - `app.js` – Frontend logic: autosize, streaming, markdown, copy buttons

## Notes

- If no `OPENAI_API_KEY` is present or OpenAI is unreachable, the server falls back to a smooth mock stream so the app always feels responsive.
- Requires Node 18+ for native `fetch` in the server.

## Troubleshooting

- If you see a blank page, open DevTools console for errors.
- If responses don’t stream, ensure Node 18+ and that nothing (proxy, extension) is buffering the response.

## License

MIT