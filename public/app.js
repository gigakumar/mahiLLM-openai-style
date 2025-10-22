// Minimal markdown using marked (loaded via CDN)
const md = window.marked ?? { parse: (t) => t };
// Support Electron preload config
const APP_CFG = window.MAHI_APP_CONFIG || {};
const API_BASE = (window.MAHI_API_BASE ?? APP_CFG.API_BASE ?? '');
const API_DIRECT = Boolean(window.MAHI_API_DIRECT ?? APP_CFG.API_DIRECT ?? false);

const el = (sel) => document.querySelector(sel);
const messagesEl = el('#messages');
const statusEl = el('#status');
const inputEl = el('#input');
const formEl = el('#form');
const historyEl = el('#history');
const newChatBtn = el('#new-chat');
const modelSelect = el('#model-select');
const btnClear = el('#btn-clear');
const btnTheme = el('#btn-theme');
const btnThemeTop = el('#btn-theme-top');
const suggestionsEl = el('#suggestions');
const systemPanel = el('#system-panel');
const systemTextarea = el('#system-prompt');
const tempInput = el('#temp');
const tempVal = el('#temp-val');
const filesInput = el('#files');
const fileList = el('#file-list');
const workspaceTabs = document.querySelectorAll('.workspace-tab');
const workspacePanels = document.querySelectorAll('.workspace-panel');
const workspaceHint = el('#workspace-hint');
const documentsLimitInput = el('#documents-limit');
const documentsRefreshBtn = el('#documents-refresh');
const documentsList = el('#documents-list');
const documentsStatus = el('#documents-status');
// Automation selectors
const autoForm = el('#auto-form');
const autoGoal = el('#auto-goal');
const autoResult = el('#auto-result');
const autoRunBtn = el('#auto-run');
const autoHint = el('#auto-hint');
// DevTools selectors
const indexForm = el('#index-form');
const indexIdInput = el('#index-id');
const indexTextInput = el('#index-text');
const indexResult = el('#index-result');
const indexFillBtn = el('#index-fill');
const queryForm = el('#query-form');
const queryTextInput = el('#query-text');
const queryKInput = el('#query-k');
const queryResult = el('#query-result');
const streamForm = el('#stream-form');
const streamPayloadInput = el('#stream-payload');
const streamLog = el('#stream-log');
const streamStatus = el('#stream-status');
const streamStopBtn = el('#stream-stop');
const devtoolsHint = el('#devtools-hint');

const WORKSPACE_STORAGE_KEY = 'mahi_workspace_view_v1';
const history = [];
let currentMessages = [];
let latestAutomationPlan = null;
let streamAbortController = null;
let docsLoaded = false;

const SAMPLE_INDEX_TEXT = `Welcome to MahiLLM!\n\nThis document is indexed locally so the assistant can answer onboarding questions:\n- Mission: Deliver private, on-device AI workflows.\n- Pillars: Privacy, Speed, Delight.\n- Contacts: Sarah (Product), Dev (Engineering), Lila (Design).`;

function mapApiPath(p) {
  if (!API_DIRECT) return p;
  if (!p.startsWith('/api/')) return p;
  const tail = p.slice('/api/'.length);
  const mapping = {
    'plan': '/v1/task',
    'task/execute': '/v1/task/execute',
    'documents': '/v1/documents',
    'index': '/v1/index',
    'query': '/v1/query',
    'embed': '/v1/embed',
  };
  return mapping[tail] || p;
}

function buildEndpoint(path, query) {
  const mapped = mapApiPath(path);
  const base = API_BASE || '';
  const baseAbsolute = base && /^https?:/.test(base)
    ? base
    : `${window.location.origin}${base.startsWith('/') ? base : base ? `/${base}` : ''}`;
  const normalizedBase = baseAbsolute.endsWith('/') ? baseAbsolute : `${baseAbsolute}/`;
  const url = new URL(mapped.replace(/^\//, ''), normalizedBase);
  if (query && typeof query === 'object') {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || Number.isNaN(value)) continue;
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

async function jsonRequest(path, { method = 'POST', body, headers, query, signal } = {}) {
  const endpoint = buildEndpoint(path, query);
  const opts = {
    method,
    headers: {
      Accept: 'application/json',
      ...(headers || {}),
    },
    signal,
  };
  if (body && method !== 'GET') {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(endpoint, opts);
  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) {
    const message =
      (data && typeof data === 'object' && (data.error || data.details || data.message))
        || res.statusText
        || 'Request failed';
    const error = new Error(message);
    error.status = res.status;
    error.payload = data;
    throw error;
  }
  return data;
}

function formatPlanResponse(payload) {
  if (!payload || typeof payload !== 'object') return String(payload ?? '');
  const plan = payload.plan;
  if (!plan || !Array.isArray(plan.steps)) {
    return JSON.stringify(payload, null, 2);
  }
  const lines = [];
  if (payload.audit_id) lines.push(`Audit ID: ${payload.audit_id}`);
  lines.push(`Status: ${plan.status || 'draft'}`);
  lines.push('');
  lines.push('Steps:');
  plan.steps.forEach((step) => {
    const needs = step.requires_confirmation ? ' (needs approval)' : '';
    lines.push(`• [${step.id}] ${step.action}: ${step.description}${needs}`);
  });
  if (Object.keys(plan.metadata || {}).length) {
    lines.push('');
    lines.push(`Metadata: ${JSON.stringify(plan.metadata, null, 2)}`);
  }
  return lines.join('\n');
}

function formatExecutionResponse(payload) {
  if (!payload || typeof payload !== 'object') return String(payload ?? '');
  const executions = Array.isArray(payload.executions) ? payload.executions : [];
  if (!executions.length) return JSON.stringify(payload, null, 2);
  const lines = ['Execution results:'];
  executions.forEach((exec) => {
    const summary = exec.result?.summary || exec.result?.output || '';
    const status = exec.status?.toUpperCase?.() || exec.status;
    const base = `• [${exec.step_id}] ${status || 'UNKNOWN'}`;
    const detail = exec.error ? ` ❌ ${exec.error}` : summary ? ` — ${summary}` : '';
    lines.push(base + detail);
  });
  return lines.join('\n');
}

function formatQueryResponse(payload) {
  if (!payload || typeof payload !== 'object') return String(payload ?? '');
  const matches = Array.isArray(payload.matches) ? payload.matches : [];
  const lines = [`Answer: ${payload.answer || '(no answer)'}`, '', 'Matches:'];
  if (!matches.length) {
    lines.push('• No matches returned');
  } else {
    matches.forEach((match) => {
      lines.push(`• (${match.score?.toFixed?.(3) ?? match.score}) ${match.document_id}: ${match.text?.slice(0, 120) ?? ''}`);
    });
  }
  return lines.join('\n');
}

const viewHints = {
  chat: 'Chat in realtime, adjust model settings, and track latency.',
  automation: 'Generate plan drafts and approve actions before execution.',
  knowledge: 'Review indexed documents and ensure the knowledge base is up to date.',
  devtools: 'Exercise indexing, semantic search, and streaming integrations.',
  default: 'Select a module to get started.',
};

function getActiveWorkspaceView() {
  const activePanel = document.querySelector('.workspace-panel.is-active');
  return activePanel?.dataset?.panel || null;
}

function updateWorkspaceHint(view) {
  if (!workspaceHint) return;
  workspaceHint.textContent = viewHints[view] || viewHints.default;
}

function toggleWorkspace(view) {
  if (!workspaceTabs.length || !workspacePanels.length) return;
  const available = new Set(Array.from(workspacePanels, (panel) => panel.dataset.panel));
  const targetView = available.has(view) ? view : Array.from(available)[0];
  if (!targetView) return;
  if (getActiveWorkspaceView() === targetView) {
    updateWorkspaceHint(targetView);
    return;
  }
  workspaceTabs.forEach((tab) => {
    const isActive = tab.dataset.view === targetView;
    tab.classList.toggle('active', isActive);
    tab.setAttribute('aria-selected', String(isActive));
  });
  workspacePanels.forEach((panel) => {
    const isActive = panel.dataset.panel === targetView;
    panel.classList.toggle('is-active', isActive);
    panel.hidden = !isActive;
  });
  updateWorkspaceHint(targetView);
  try {
    localStorage.setItem(WORKSPACE_STORAGE_KEY, targetView);
  } catch {}
  if (targetView === 'knowledge' && !docsLoaded) {
    refreshDocuments({ silent: false });
  }
}

function renderDocuments(docs) {
  if (!documentsList || !documentsStatus) return;
  documentsList.innerHTML = '';
  if (!Array.isArray(docs) || !docs.length) {
    documentsStatus.textContent = 'No documents indexed yet.';
    return;
  }
  documentsStatus.textContent = `${docs.length} document${docs.length === 1 ? '' : 's'} loaded.`;
  const header = document.createElement('div');
  header.className = 'documents-row documents-header';
  header.innerHTML = '<span>ID</span><span>Score</span><span>Preview</span>';
  documentsList.appendChild(header);
  docs.forEach((doc) => {
    const row = document.createElement('div');
    row.className = 'documents-row';
    const id = document.createElement('span');
    id.className = 'doc-id';
    id.textContent = doc.document_id || '(unknown)';
    const score = document.createElement('span');
    score.className = 'doc-score';
    score.textContent = typeof doc.score === 'number' ? doc.score.toFixed(3) : doc.score ?? '—';
    const preview = document.createElement('span');
    preview.className = 'doc-preview';
    preview.textContent = doc.text ? doc.text.slice(0, 140) : '';
    row.append(id, score, preview);
    documentsList.appendChild(row);
  });
}

async function refreshDocuments({ silent = false } = {}) {
  if (!documentsStatus) return;
  const limit = Number(documentsLimitInput?.value || 20) || 20;
  if (!silent) {
    documentsStatus.textContent = 'Loading documents…';
    if (documentsList) documentsList.innerHTML = '';
  }
  if (documentsRefreshBtn) documentsRefreshBtn.disabled = true;
  try {
    const response = await jsonRequest('/api/documents', {
      method: 'GET',
      query: { limit },
    });
    docsLoaded = true;
    renderDocuments(Array.isArray(response) ? response : []);
  } catch (err) {
    docsLoaded = false;
    const detail = err.payload?.error || err.payload?.details || err.message;
    documentsStatus.textContent = `Failed to load documents: ${detail}`;
  } finally {
    if (documentsRefreshBtn) documentsRefreshBtn.disabled = false;
  }
}


function scrollToBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function avatar(role) {
  return `<div class="avatar ${role}">${role === 'assistant' ? '🤖' : '🧑'}</div>`;
}

function renderMarkdownTo(htmlContainer, text) {
  htmlContainer.innerHTML = `<div class="markdown">${md.parse(text)}</div>`;
  // add copy buttons for code blocks
  htmlContainer.querySelectorAll('pre').forEach((pre) => {
    const btn = document.createElement('button');
    btn.className = 'copy';
    btn.textContent = 'Copy';
    btn.addEventListener('click', async () => {
      await navigator.clipboard.writeText(pre.innerText);
      btn.textContent = 'Copied';
      setTimeout(() => (btn.textContent = 'Copy'), 1200);
    });
    pre.prepend(btn);
  });
}

function addRow({ role, content }) {
  const row = document.createElement('div');
  row.className = 'row';
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  renderMarkdownTo(bubble, content);
  row.innerHTML = `${avatar(role)} `;
  row.appendChild(bubble);
  messagesEl.appendChild(row);
  scrollToBottom();
  return bubble; // return bubble element to stream into it
}

function updateHistory(title) {
  const item = document.createElement('button');
  item.className = 'history-item';
  item.textContent = title.slice(0, 60);
  item.addEventListener('click', () => {
    // Simple recall: render the stored transcript
    messagesEl.innerHTML = '';
    for (const m of currentMessages) addRow(m);
  });
  historyEl.prepend(item);
}

// autosize textarea
function autosize() {
  inputEl.style.height = 'auto';
  inputEl.style.height = Math.min(inputEl.scrollHeight, 180) + 'px';
}
inputEl.addEventListener('input', autosize);

// Provide a simple in-browser fallback when there's no backend available
async function streamChat(messages) {
  statusEl.textContent = 'Thinking…';
  const apiBase = window.MAHI_API_BASE ?? '';
  const endpoint = `${apiBase}/api/chat`;

  let res;
  try {
    res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages })
    });
  } catch (e) {
    // If fetch fails (e.g., on GitHub Pages), generate a demo response locally
    return demoFallback(messages);
  }
  if (!res.ok || !res.body) {
    return demoFallback(messages);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();

  let assistantContent = '';
  const t0 = performance.now();
  const bubble = addRow({ role: 'assistant', content: '' });

  // Highlight code blocks as chunks arrive
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    for (const line of chunk.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data: ')) continue;
      const data = trimmed.slice(6);
      try {
        const json = JSON.parse(data);
        if (json.token) {
          assistantContent += json.token;
          renderMarkdownTo(bubble, assistantContent);
          if (window.hljs) bubble.querySelectorAll('pre code').forEach((b) => window.hljs.highlightElement(b));
          scrollToBottom();
        }
        if (json.done) {
          statusEl.textContent = 'Ready';
          updateAnalytics({ firstTokenMs: performance.now() - t0, deltaTokens: assistantContent.length });
        }
      } catch {}
    }
  }

  currentMessages.push({ role: 'assistant', content: assistantContent });
  return assistantContent;
}

// Local demo fallback to keep the site functional on static hosts
async function demoFallback(messages) {
  const last = messages[messages.length - 1]?.content || '';
  const preface = `This is a live demo preview. On a full deployment, responses stream from your hosted models.\n\n`;
  const selected = modelSelect?.value || 'mahillm-instruct';
  const content = preface + generateDemoAnswer(last, selected, getSystemPrompt(), getTemperature(), getAttachedTexts());
  const bubble = addRow({ role: 'assistant', content: '' });
  let acc = '';
  for (const ch of content) {
    await new Promise((r) => setTimeout(r, 8));
    acc += ch;
    renderMarkdownTo(bubble, acc);
    if (window.hljs) bubble.querySelectorAll('pre code').forEach((b) => window.hljs.highlightElement(b));
    scrollToBottom();
  }
  statusEl.textContent = 'Ready';
  currentMessages.push({ role: 'assistant', content });
  updateAnalytics({ firstTokenMs: 180 + Math.random() * 120, deltaTokens: content.length });
  return content;
}

function generateDemoAnswer(prompt, model, system, temperature, attachments) {
  if (!prompt) return 'Ask me anything about MahiLLM, our models, or how to deploy your own assistant.';
  const att = attachments && attachments.length ? `\n\nAttached context (${attachments.length} files):\n- ${attachments.map((a) => a.name).join('\n- ')}` : '';
  const body = `System: ${system || 'You are MahiLLM, a helpful AI assistant.'}\nTemperature: ${temperature.toFixed(1)}\nModel: ${model}${att}\n\nUser: ${prompt}\n\nAssistant:`;
  const answer = `Based on the provided system prompt and temperature, here is a structured response to your query:\n\n- Key points addressing: "${prompt}"\n- Rationale aligned with system policy\n- If applicable, cite attached files in reasoning\n\nExample JSON:\n\n\`\`\`json\n{ "summary": "...", "actions": ["..."], "confidence": 0.83 }\n\`\`\``;
  return body + '\n\n' + answer;
}

// Persist conversation history locally per model
const HISTORY_KEY = 'mahi_history_v1';
function saveHistory() {
  try {
    const payload = { model: modelSelect?.value || 'mahillm-instruct', messages: currentMessages, system: getSystemPrompt(), temp: getTemperature() };
    localStorage.setItem(HISTORY_KEY, JSON.stringify(payload));
  } catch {}
}
function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return;
    const { model, messages, system, temp } = JSON.parse(raw);
    if (modelSelect) modelSelect.value = model || modelSelect.value;
    if (typeof temp === 'number' && tempInput) { tempInput.value = String(temp); tempVal.textContent = Number(temp).toFixed(1); }
    if (systemTextarea && system) systemTextarea.value = system;
    if (Array.isArray(messages)) {
      currentMessages = [];
      messagesEl.innerHTML = '';
      for (const m of messages) {
        currentMessages.push(m);
        addRow(m);
      }
    }
  } catch {}
}

window.addEventListener('beforeunload', saveHistory);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') saveHistory();
});
loadHistory();

// Temperature control
function getTemperature() { return Number(tempInput?.value || 1); }
tempInput?.addEventListener('input', () => { tempVal.textContent = getTemperature().toFixed(1); saveHistory(); });

// System prompt
function getSystemPrompt() { return systemTextarea?.value?.trim() || 'You are MahiLLM, a helpful AI assistant.'; }
el('#btn-system')?.addEventListener('click', () => {
  const presets = {
    concise: 'You are MahiLLM. Answer concisely with bullet points when helpful.',
    helpful: 'You are MahiLLM. Be helpful, cite assumptions, and offer next steps.',
    strict: 'You are MahiLLM. Output valid JSON only; include reason and result keys.',
  };
  systemTextarea.value = presets.helpful;
  systemPanel.open = true;
  saveHistory();
});

// Attachments mock: read small text-like files for RAG demo
let attached = [];
filesInput?.addEventListener('change', async (e) => {
  attached = [];
  fileList.innerHTML = '';
  const files = Array.from(e.target.files || []).slice(0, 5);
  for (const f of files) {
    const text = await f.text();
    attached.push({ name: f.name, text: text.slice(0, 3000) });
    const pill = document.createElement('span');
    pill.className = 'file-pill';
    pill.textContent = f.name;
    fileList.appendChild(pill);
  }
});
function getAttachedTexts() { return attached; }

// Analytics (client-only demo)
const KPIS = { messages: 0, tokens: 0, firstTokenMs: [] };
function updateAnalytics({ firstTokenMs, deltaTokens }) {
  KPIS.messages += 1;
  KPIS.tokens += deltaTokens || 0;
  if (typeof firstTokenMs === 'number') KPIS.firstTokenMs.push(firstTokenMs);
  const avg = KPIS.firstTokenMs.length ? Math.round(KPIS.firstTokenMs.reduce((a,b)=>a+b,0)/KPIS.firstTokenMs.length) : '–';
  const k = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = String(val); };
  k('kpi-messages', KPIS.messages);
  k('kpi-tokens', KPIS.tokens);
  k('kpi-latency', avg === '–' ? '–' : `${avg} ms`);
}

formEl.addEventListener('submit', async (e) => {
  e.preventDefault();
  const content = inputEl.value.trim();
  if (!content) return;
  inputEl.value = '';
  autosize();
  const userMsg = { role: 'user', content };
  currentMessages.push(userMsg);
  addRow(userMsg);
  try {
    const final = await streamChat(currentMessages);
    if (!history.length) updateHistory(content);
  } catch (err) {
    const bubble = addRow({ role: 'assistant', content: 'Sorry, something went wrong.' });
    console.error(err);
  }
});

newChatBtn.addEventListener('click', () => {
  currentMessages = [];
  messagesEl.innerHTML = '';
  statusEl.textContent = 'Ready';
  inputEl.focus();
});

// initial focus
inputEl.focus();

// Clear chat
btnClear?.addEventListener('click', () => {
  currentMessages = [];
  messagesEl.innerHTML = '';
  saveHistory();
});

// Centralized theme setter
function setTheme(theme) {
  const root = document.documentElement;
  const isLight = theme === 'light';
  root.classList.toggle('theme-light', isLight);
  localStorage.setItem('mahi_theme', isLight ? 'light' : 'dark');
  swapThemeImages(isLight ? 'light' : 'dark');
  // Swap highlight.js theme
  const link = document.getElementById('hljs-theme');
  if (link) {
    link.href = isLight
      ? 'https://cdn.jsdelivr.net/npm/highlight.js@11.9.0/styles/github.min.css'
      : 'https://cdn.jsdelivr.net/npm/highlight.js@11.9.0/styles/github-dark.min.css';
  }
  // Show wordmark below banner only in light theme if present
  const wordmark = document.getElementById('hero-wordmark');
  if (wordmark) wordmark.style.display = isLight ? 'block' : 'none';
}

// Theme toggle buttons
btnTheme?.addEventListener('click', () => {
  const current = localStorage.getItem('mahi_theme') || (document.documentElement.classList.contains('theme-light') ? 'light' : 'dark');
  setTheme(current === 'light' ? 'dark' : 'light');
});

btnThemeTop?.addEventListener('click', () => {
  const current = localStorage.getItem('mahi_theme') || (document.documentElement.classList.contains('theme-light') ? 'light' : 'dark');
  setTheme(current === 'light' ? 'dark' : 'light');
});

// Apply stored theme on load; default to light
(() => {
  const saved = localStorage.getItem('mahi_theme');
  const initial = saved || 'light';
  setTheme(initial);
})();

// Suggestion chips
suggestionsEl?.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-suggest]');
  if (!btn) return;
  inputEl.value = btn.getAttribute('data-suggest');
  inputEl.dispatchEvent(new Event('input'));
  inputEl.focus();
});

if (workspaceTabs.length) {
  workspaceTabs.forEach((tab) => {
    tab.addEventListener('click', (e) => {
      e.preventDefault();
      const view = tab.dataset.view;
      toggleWorkspace(view);
    });
  });
  let initialView = null;
  try {
    initialView = localStorage.getItem(WORKSPACE_STORAGE_KEY);
  } catch {}
  const defaultView = initialView || workspaceTabs[0]?.dataset?.view || 'chat';
  toggleWorkspace(defaultView);
} else {
  updateWorkspaceHint('default');
}

documentsRefreshBtn?.addEventListener('click', () => {
  refreshDocuments({ silent: false });
});

documentsLimitInput?.addEventListener('change', () => {
  docsLoaded = false;
  if (getActiveWorkspaceView() === 'knowledge') {
    refreshDocuments({ silent: false });
  }
});

// Swap theme-aware images (banner and mark) using data-light-src / data-dark-src
function swapThemeImages(theme) {
  const img = (id) => document.getElementById(id);
  const apply = (node) => {
    if (!node) return;
    const light = node.getAttribute('data-light-src');
    const dark = node.getAttribute('data-dark-src');
    if (theme === 'light' && light) node.src = light;
    else if (theme === 'dark' && dark) node.src = dark;
  };
  apply(img('hero-banner'));
  apply(img('hero-mark'));
  apply(img('nav-logo'));
}

async function executeLatestPlan() {
  if (!latestAutomationPlan?.plan) return;
  const approvals = {};
  for (const step of latestAutomationPlan.plan.steps || []) {
    if (!step.requires_confirmation) {
      approvals[step.id] = true;
      continue;
    }
    const ok = window.confirm(`Approve step ${step.id}?\n${step.description}`);
    approvals[step.id] = ok;
  }
  autoResult.textContent = 'Executing plan…';
  if (autoRunBtn) {
    autoRunBtn.disabled = true;
    autoRunBtn.textContent = 'Running…';
  }
  if (autoHint) {
    autoHint.textContent = 'Executing approved steps…';
  }
  try {
    const response = await jsonRequest('/api/task/execute', {
      body: {
        plan: latestAutomationPlan.plan,
        approvals,
      },
    });
    latestAutomationPlan = response;
    autoResult.textContent = formatExecutionResponse(response);
    if (autoHint) {
      autoHint.textContent = 'Execution complete. Review results below or tweak the plan.';
    }
  } catch (err) {
    const detail = err.payload?.error || err.payload?.details || err.message;
    autoResult.textContent = `Execution failed: ${detail}`;
    if (autoHint) {
      autoHint.textContent = 'Execution failed. Check the backend logs and try again.';
    }
  } finally {
    if (autoRunBtn) {
      autoRunBtn.disabled = false;
      autoRunBtn.textContent = 'Run again';
      autoRunBtn.hidden = !latestAutomationPlan?.plan?.steps?.length;
    }
  }
}

autoRunBtn?.addEventListener('click', () => {
  executeLatestPlan();
});

// Personalized automation demo wired into Python backend
autoForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const goal = autoGoal?.value?.trim();
  if (!goal) {
    autoResult.textContent = 'Describe a goal to plan first.';
    if (autoHint) autoHint.textContent = 'Add a goal above to generate a plan.';
    if (autoRunBtn) {
      autoRunBtn.hidden = true;
      autoRunBtn.disabled = true;
    }
    latestAutomationPlan = null;
    return;
  }
  const sources = {
    email: el('#src-email')?.checked || false,
    calendar: el('#src-calendar')?.checked || false,
    messages: el('#src-messages')?.checked || false,
    browser: el('#src-browser')?.checked || false,
  };
  autoResult.textContent = 'Planning…';
  if (autoRunBtn) {
    autoRunBtn.hidden = true;
    autoRunBtn.disabled = true;
  }
  if (autoHint) autoHint.textContent = 'Generating plan…';
  try {
    const response = await jsonRequest('/api/plan', {
      body: {
        goal,
        sources,
        history: currentMessages,
      },
    });
    latestAutomationPlan = response;
    autoResult.textContent = formatPlanResponse(response);
    autoResult.scrollTop = 0;
    const hasSteps = Boolean(response?.plan?.steps?.length);
    if (autoRunBtn) {
      autoRunBtn.hidden = !hasSteps;
      autoRunBtn.disabled = !hasSteps;
      autoRunBtn.textContent = 'Run plan';
    }
    if (autoHint) {
      autoHint.textContent = hasSteps
        ? 'Approve required steps, then run the plan.'
        : 'Plan generated without actionable steps.';
    }
  } catch (err) {
    latestAutomationPlan = null;
    const detail = err.payload?.error || err.payload?.details || err.message || 'Failed to plan';
    autoResult.textContent = `Failed to plan: ${detail}`;
    if (autoHint) autoHint.textContent = 'Plan failed. Check the backend service and try again.';
    if (autoRunBtn) {
      autoRunBtn.hidden = true;
      autoRunBtn.disabled = true;
    }
  }
});

// Devtools: index sample content into the vector store
indexFillBtn?.addEventListener('click', () => {
  if (indexIdInput && !indexIdInput.value) {
    indexIdInput.value = `doc-${Date.now()}`;
  }
  if (indexTextInput) {
    indexTextInput.value = SAMPLE_INDEX_TEXT;
    indexTextInput.focus();
  }
});

indexForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!indexResult) return;
  const documentId = indexIdInput?.value?.trim() || `doc-${Date.now()}`;
  const text = indexTextInput?.value?.trim();
  if (!text) {
    indexResult.textContent = 'Enter some text to index.';
    return;
  }
  indexResult.textContent = 'Indexing…';
  try {
    const response = await jsonRequest('/api/index', {
      body: {
        document_id: documentId,
        text,
        metadata: { source: 'devtools' },
      },
    });
    indexResult.textContent = JSON.stringify(response, null, 2);
  } catch (err) {
    const detail = err.payload?.error || err.payload?.details || err.message;
    indexResult.textContent = `Index failed: ${detail}`;
  }
});

queryForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!queryResult) return;
  const query = queryTextInput?.value?.trim();
  const topK = Number(queryKInput?.value || 5) || 5;
  if (!query) {
    queryResult.textContent = 'Enter a question to search.';
    return;
  }
  queryResult.textContent = 'Searching…';
  try {
    const response = await jsonRequest('/api/query', {
      body: { query, k: topK },
    });
    queryResult.textContent = formatQueryResponse(response);
  } catch (err) {
    const detail = err.payload?.error || err.payload?.details || err.message;
    queryResult.textContent = `Search failed: ${detail}`;
  }
});

// Devtools: stream inspector via gRPC (if enabled)
streamForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!streamLog || !streamStatus) return;
  const payload = streamPayloadInput?.value?.trim() || 'Describe the current automation plan.';
  if (streamAbortController) streamAbortController.abort();
  streamAbortController = new AbortController();
  streamLog.textContent = '';
  streamStatus.textContent = 'Connecting…';
  streamStopBtn.disabled = false;
  try {
    const endpoint = buildEndpoint('/api/assistant/stream');
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ payload }),
      signal: streamAbortController.signal,
    });
    if (!res.ok || !res.body) {
      throw new Error(`HTTP ${res.status}`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    streamStatus.textContent = 'Streaming…';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      for (const line of chunk.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6);
        if (data === '[DONE]') continue;
        try {
          const json = JSON.parse(data);
          streamLog.textContent += `${JSON.stringify(json)}\n`;
        } catch {
          streamLog.textContent += `${data}\n`;
        }
      }
    }
    streamStatus.textContent = 'Stream complete';
  } catch (err) {
    if (err.name === 'AbortError') {
      streamStatus.textContent = 'Stream cancelled';
    } else {
      const detail = err.payload?.error || err.payload?.details || err.message;
      streamStatus.textContent = `Stream failed: ${detail}`;
    }
  } finally {
    streamStopBtn.disabled = true;
    streamAbortController = null;
  }
});

streamStopBtn?.addEventListener('click', () => {
  if (streamAbortController) streamAbortController.abort();
});
