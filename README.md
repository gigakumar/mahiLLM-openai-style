# MahiLLM Console

MahiLLM delivers OpenAI-grade product polish for your own fine-tuned large language models. This repository contains a full-stack demo with a marketing site and an embedded streaming chat console so prospective users can try your models instantly.

## ✨ Highlights

- **Marketing experience** – Hero, platform, model roster, solutions, pricing, and safety sections inspired by openai.com.
- **Live console** – Real-time streaming chat demo using Server-Sent Events with markdown/code rendering.
- **Enterprise-ready messaging** – Copy focused on fine-tuned deployments, guardrails, and analytics.
- **Responsive dark UI** – Modern gradients, glassmorphism panels, and mobile-friendly layout.

## 🚀 Getting Started

### Prerequisites

- Node.js 18 or later

### Installation

```bash
git clone https://github.com/gigakumar/mahiLLM-openai-style.git
cd mahiLLM-openai-style
npm install
```

Create a `.env` file based on `.env.example` and populate it with your own API key and preferred default model:

```bash
cp .env.example .env
# edit .env with your secrets
```

### Running locally

```bash
npm run start
```

The app boots an Express server on the port defined in your `.env` (defaults to 3000) and serves the marketing site plus the chat API at `/api/chat`.

## 🧱 Project Structure

```
public/
	index.html    # Marketing landing page and embedded console
	styles.css    # Global design system + console styling
	app.js        # Frontend chat client with SSE streaming
server.js       # Express server + streaming endpoint
```

## 🔌 API Overview

The `/api/chat` endpoint streams tokens using SSE. Swap the mock responder with your own OpenAI-compatible backend or custom inference service. The frontend expects `data: { "token": "..." }` events and a final `data: { "done": true }` marker.

## ✅ Deployment

- Push to GitHub Pages or any static host for the `public/` assets.
- Run the Node server on your platform of choice (Render, Railway, Fly.io, etc.) to keep streaming support.

## 🤝 Contributing

Pull requests are welcome! Feel free to open an issue for ideas, bugs, or feature requests.

## 📄 License

MIT License © MahiLLM Labs
