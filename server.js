import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const __dirnameResolved = path.resolve();
const publicDir = path.join(__dirnameResolved, 'public');
app.use(express.static(publicDir));

// Utility: simple SSE writer
function sseWrite(res, data) {
  res.write(`data: ${data}\n\n`);
}

function setupSSE(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
}

// Mock streaming generator (word by word)
async function* mockStream(text) {
  const words = text.split(/(\s+)/); // keep spaces
  for (const w of words) {
    await new Promise(r => setTimeout(r, 30));
    yield w;
  }
}

// POST /api/chat - streams back a response
app.post('/api/chat', async (req, res) => {
  try {
    setupSSE(res);
    const { messages } = req.body || {};
    const lastUser = Array.isArray(messages)
      ? [...messages].reverse().find(m => m.role === 'user')?.content || ''
      : '';

    // If an actual OpenAI API key is present, attempt to stream via their API (fetch-based)
    const apiKey = process.env.OPENAI_API_KEY;
    const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';

    if (apiKey) {
      try {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model,
            messages: messages || [{ role: 'user', content: lastUser }],
            stream: true,
            temperature: 0.7
          })
        });

        if (!response.ok || !response.body) {
          throw new Error(`OpenAI error: ${response.status} ${response.statusText}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          // The OpenAI stream sends lines starting with "data: {json}" and a [DONE]
          const lines = chunk.split('\n');
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data: ')) continue;
            const data = trimmed.slice(6);
            if (data === '[DONE]') {
              sseWrite(res, JSON.stringify({ done: true }));
              return res.end();
            }
            try {
              const json = JSON.parse(data);
              const delta = json.choices?.[0]?.delta?.content || '';
              if (delta) sseWrite(res, JSON.stringify({ token: delta }));
            } catch { /* ignore parse errors for keepalives */ }
          }
        }
        sseWrite(res, JSON.stringify({ done: true }));
        return res.end();
      } catch (err) {
        // Fall back to mock if OpenAI streaming fails
      }
    }

    const reply = lastUser
      ? `You said: ${lastUser}. Here's a thoughtful, friendly response matching the OpenAI vibe.\n\n- Clean UI\n- Smooth streaming\n- Markdown support\n\nAsk another question!`
      : "Hello! Ask me anything. I stream responses like ChatGPT.";

    for await (const token of mockStream(reply)) {
      sseWrite(res, JSON.stringify({ token }));
    }
    sseWrite(res, JSON.stringify({ done: true }));
    res.end();
  } catch (e) {
    res.status(500).end();
  }
});

// SPA fallback
app.get('*', (req, res) => {
  const filePath = path.join(publicDir, 'index.html');
  if (fs.existsSync(filePath)) {
    res.sendFile(filePath);
  } else {
    res.status(404).send('index.html missing');
  }
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
