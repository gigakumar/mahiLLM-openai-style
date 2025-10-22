import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import * as url from 'url';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const __dirnameResolved = path.resolve();
const publicDir = path.join(__dirnameResolved, 'public');
const PYTHON_ASSISTANT_URL = process.env.PYTHON_ASSISTANT_URL || 'http://127.0.0.1:5000';
const pythonDisabled = process.env.DISABLE_PYTHON_ASSISTANT === '1';
const pythonEnabled = !pythonDisabled;

// Optional: gRPC Assistant/Indexer wiring
let grpc = null;
let protoLoader = null;
let grpcServices = null;
let grpcEnabled = false;
const ASSISTANT_GRPC_ADDR = process.env.ASSISTANT_GRPC_ADDR || '127.0.0.1:50051';
try {
  // Only attempt if explicitly enabled or dependencies are present
  if (process.env.USE_ASSISTANT_GRPC === '1') {
    grpc = await import('@grpc/grpc-js');
    protoLoader = await import('@grpc/proto-loader');
    const protoPath = path.join(__dirnameResolved, 'ondevice-ai', 'proto', 'assistant.proto');
    const packageDefinition = protoLoader.loadSync(protoPath, {
      keepCase: true,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
    });
    const loaded = grpc.loadPackageDefinition(packageDefinition);
    grpcServices = loaded.assistant;
    grpcEnabled = true;
    console.log(`[gRPC] Enabled. Target: ${ASSISTANT_GRPC_ADDR}`);
  }
} catch (e) {
  console.warn('[gRPC] Disabled (missing deps or USE_ASSISTANT_GRPC not set).');
}

// Try to enable EJS templates if available; otherwise we'll fall back to static files.
let hasEJS = false;
try {
  await import('ejs');
  app.set('views', path.join(__dirnameResolved, 'views'));
  app.set('view engine', 'ejs');
  hasEJS = true;
} catch {
  // EJS not installed; proceed without it.
}

// Static assets
app.use(express.static(publicDir));
// Serve favicon from repo root
app.get('/favicon.svg', (req, res) => {
  res.sendFile(path.join(__dirnameResolved, 'favicon.svg'));
});

// Pages: render via EJS when available, otherwise serve static HTML files
app.get('/', (req, res) => {
  if (hasEJS) return res.render('index');
  return res.sendFile(path.join(publicDir, 'index.html'));
});
app.get(['/docs', '/docs.html'], (req, res) => {
  if (hasEJS) return res.render('docs');
  return res.sendFile(path.join(__dirnameResolved, 'docs.html'));
});
app.get(['/blog', '/blog/', '/blog/index.html'], (req, res) => {
  if (hasEJS) return res.render('blog');
  return res.sendFile(path.join(__dirnameResolved, 'blog', 'index.html'));
});

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

async function callPython(pathname, { method = 'GET', body, query } = {}) {
  if (!pythonEnabled) {
    const err = new Error('python_disabled');
    err.status = 503;
    throw err;
  }
  const target = new URL(pathname, PYTHON_ASSISTANT_URL);
  if (query && typeof query === 'object') {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) continue;
      target.searchParams.set(key, String(value));
    }
  }
  const init = { method, headers: { Accept: 'application/json' } };
  if (body && method !== 'GET') {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const response = await fetch(target, init);
  const raw = await response.text();
  const contentType = response.headers.get('content-type') || '';
  let payload = null;
  if (raw) {
    if (contentType.includes('application/json')) {
      try {
        payload = JSON.parse(raw);
      } catch {
        payload = raw;
      }
    } else {
      payload = raw;
    }
  }
  if (!response.ok) {
    const err = new Error(`python_assistant_error_${response.status}`);
    err.status = response.status;
    err.payload = payload;
    throw err;
  }
  return payload ?? {};
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

// POST /api/plan - proxy to Python automation planner
app.post('/api/plan', async (req, res) => {
  try {
    const { goal = '', sources = {}, history = [] } = req.body || {};
    const payload = {
      goal: {
        goal,
        context: req.body?.context || {},
        sources: sources || {},
      },
      history: Array.isArray(history) ? history : [],
    };
    const response = await callPython('/v1/task', { method: 'POST', body: payload });
    res.json(response);
  } catch (err) {
    if (grpcEnabled && grpcServices) {
      console.warn('[plan] Python assistant unavailable, falling back to mock plan.');
      const { goal = '', sources = {} } = req.body || {};
      const enabled = Object.entries(sources || {})
        .filter(([, v]) => !!v)
        .map(([k]) => k);
      const steps = [];
      if (goal) steps.push({ step: 'Understand goal', action: `Parse: ${goal.slice(0, 120)}` });
      if (enabled.includes('email')) steps.push({ step: 'Email', action: 'Summarize inbox and draft replies' });
      if (enabled.includes('calendar')) steps.push({ step: 'Calendar', action: 'Check availability and propose slots' });
      if (enabled.includes('messages')) steps.push({ step: 'Messages', action: 'Extract intents from latest threads' });
      if (enabled.includes('browser')) steps.push({ step: 'Browser', action: 'Fetch relevant pages from history' });
      if (!steps.length) steps.push({ step: 'Idle', action: 'Await user goal' });
      return res.json({
        plan: {
          status: 'draft',
          steps: steps.map((s, idx) => ({
            id: `mock-${idx + 1}`,
            action: 'noop',
            description: `${s.step}: ${s.action}`,
            requires_confirmation: false,
            params: {},
          })),
          metadata: { source: 'mock' },
        },
        audit_id: 'mock-plan',
      });
    }
    const status = err?.status || 500;
    res.status(status).json({ error: 'plan_failed', details: err?.payload || err?.message || 'unknown_error' });
  }
});

// GET /api/documents - retrieve indexed documents from Python assistant
app.get('/api/documents', async (req, res) => {
  try {
    const limit = Number(req.query?.limit ?? req.query?.k ?? 20) || 20;
    const response = await callPython('/v1/documents', {
      method: 'GET',
      query: { limit },
    });
    res.json(response);
  } catch (err) {
    const status = err?.status || 503;
    res.status(status).json({ error: 'documents_failed', details: err?.payload || err?.message || 'assistant_unavailable' });
  }
});

// POST /api/task/execute - proxy to Python plan executor
app.post('/api/task/execute', async (req, res) => {
  try {
    const payload = {
      plan: req.body?.plan,
      approvals: req.body?.approvals || {},
    };
    const response = await callPython('/v1/task/execute', { method: 'POST', body: payload });
    res.json(response);
  } catch (err) {
    const status = err?.status || 500;
    res.status(status).json({ error: 'execute_failed', details: err?.payload || err?.message || 'unknown_error' });
  }
});

// ---- Optional gRPC-backed endpoints ----
// Assistant.Send
app.post('/api/assistant/send', async (req, res) => {
  if (!grpcEnabled || !grpcServices) return res.status(503).json({ error: 'grpc_disabled', hint: 'Set USE_ASSISTANT_GRPC=1 and install gRPC deps.' });
  const client = new grpcServices.Assistant(ASSISTANT_GRPC_ADDR, grpc.credentials.createInsecure());
  const { id = '1', user_id = 'u1', type = 'query', payload = '' } = req.body || {};
  client.Send({ id, user_id, type, payload }, (err, resp) => {
    if (err) return res.status(500).json({ error: 'grpc_error', details: err.message });
    res.json(resp);
  });
});

// Assistant.StreamResponses -> SSE bridge
app.post('/api/assistant/stream', async (req, res) => {
  if (!grpcEnabled || !grpcServices) return res.status(503).json({ error: 'grpc_disabled', hint: 'Set USE_ASSISTANT_GRPC=1 and install gRPC deps.' });
  setupSSE(res);
  const client = new grpcServices.Assistant(ASSISTANT_GRPC_ADDR, grpc.credentials.createInsecure());
  const call = client.StreamResponses();
  call.on('data', (msg) => {
    try { sseWrite(res, JSON.stringify(msg)); } catch {}
  });
  call.on('error', (err) => {
    try { sseWrite(res, JSON.stringify({ error: 'stream_error', details: err.message })); } catch {}
    res.end();
  });
  call.on('end', () => {
    try { sseWrite(res, JSON.stringify({ done: true })); } catch {}
    res.end();
  });
  try {
    const { messages, id = `stream-${Date.now()}`, user_id = 'u1', type = 'demo', payload = 'start' } = req.body || {};
    if (Array.isArray(messages) && messages.length) {
      messages.forEach((m, idx) => {
        call.write({
          id: m.id || `${id}-${idx}`,
          user_id: m.user_id || user_id,
          type: m.type || type,
          payload: typeof m.payload === 'string' ? m.payload : JSON.stringify(m.payload ?? {}),
        });
      });
    } else {
      call.write({ id, user_id, type, payload });
    }
  } catch (err) {
    try { sseWrite(res, JSON.stringify({ error: 'request_error', details: err.message })); } catch {}
  }
  call.end();
});

// Index document via Python assistant, fallback to gRPC when available
app.post('/api/index', async (req, res) => {
  if (pythonEnabled) {
    try {
      const payload = req.body || {};
      const body = {
        document_id: payload.document_id || payload.id || payload.doc_id || `doc-${Date.now()}`,
        text: payload.text || payload.body || '',
        metadata: payload.metadata || payload.meta || {},
      };
      const response = await callPython('/v1/index', { method: 'POST', body });
      return res.json(response);
    } catch (err) {
      console.warn('[index] Python assistant error:', err?.message || err);
      if (!grpcEnabled || !grpcServices) {
        const status = err?.status || 500;
        return res.status(status).json({ error: 'index_failed', details: err?.payload || err?.message || 'unknown_error' });
      }
    }
  }
  if (!grpcEnabled || !grpcServices) {
    return res.status(503).json({ error: 'assistant_unavailable', hint: 'Start python assistant or enable gRPC.' });
  }
  const client = new grpcServices.Indexer(ASSISTANT_GRPC_ADDR, grpc.credentials.createInsecure());
  const { id = '', text = '' } = req.body || {};
  client.Index({ id, text }, (err, resp) => {
    if (err) return res.status(500).json({ error: 'grpc_error', details: err.message });
    res.json(resp);
  });
});

// Query knowledge base via Python assistant, fallback to gRPC
app.post('/api/query', async (req, res) => {
  if (pythonEnabled) {
    try {
      const payload = req.body || {};
      const body = {
        query: payload.query || '',
        top_k: Number(payload.k ?? payload.top_k ?? 5) || 5,
      };
      const response = await callPython('/v1/query', { method: 'POST', body });
      return res.json(response);
    } catch (err) {
      console.warn('[query] Python assistant error:', err?.message || err);
      if (!grpcEnabled || !grpcServices) {
        const status = err?.status || 500;
        return res.status(status).json({ error: 'query_failed', details: err?.payload || err?.message || 'unknown_error' });
      }
    }
  }
  if (!grpcEnabled || !grpcServices) {
    return res.status(503).json({ error: 'assistant_unavailable', hint: 'Start python assistant or enable gRPC.' });
  }
  const client = new grpcServices.Indexer(ASSISTANT_GRPC_ADDR, grpc.credentials.createInsecure());
  const { query = '', k = 5 } = req.body || {};
  client.Query({ query, k }, (err, resp) => {
    if (err) return res.status(500).json({ error: 'grpc_error', details: err.message });
    res.json(resp);
  });
});

// Embedding helper via Python assistant, fallback to gRPC implementation
app.post('/api/embed', async (req, res) => {
  if (pythonEnabled) {
    try {
      const payload = req.body || {};
      const texts = Array.isArray(payload.texts)
        ? payload.texts
        : payload.text
        ? [payload.text]
        : [];
      const response = await callPython('/v1/embed', { method: 'POST', body: { texts } });
      return res.json(response);
    } catch (err) {
      console.warn('[embed] Python assistant error:', err?.message || err);
      if (!grpcEnabled || !grpcServices) {
        const status = err?.status || 500;
        return res.status(status).json({ error: 'embed_failed', details: err?.payload || err?.message || 'unknown_error' });
      }
    }
  }
  if (!grpcEnabled || !grpcServices) {
    return res.status(503).json({ error: 'assistant_unavailable', hint: 'Start python assistant or enable gRPC.' });
  }
  const client = new grpcServices.Embeddings(ASSISTANT_GRPC_ADDR, grpc.credentials.createInsecure());
  const { text = '' } = req.body || {};
  client.Embed({ text }, (err, resp) => {
    if (err) return res.status(500).json({ error: 'grpc_error', details: err.message });
    res.json(resp);
  });
});

// Fallback 404 page for unknown routes
app.use((req, res) => {
  res.status(404).send('Not Found');
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
