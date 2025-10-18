// Minimal markdown using marked (loaded via CDN)
const md = window.marked ?? { parse: (t) => t };

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

const history = [];
let currentMessages = [];

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

// Theme toggle
btnTheme?.addEventListener('click', () => {
  const root = document.documentElement;
  const isLight = root.classList.toggle('theme-light');
  localStorage.setItem('mahi_theme', isLight ? 'light' : 'dark');
  swapThemeImages(isLight ? 'light' : 'dark');
});

// Top nav theme toggle mirrors the chat toggle
btnThemeTop?.addEventListener('click', () => {
  const root = document.documentElement;
  const isLight = root.classList.toggle('theme-light');
  localStorage.setItem('mahi_theme', isLight ? 'light' : 'dark');
  swapThemeImages(isLight ? 'light' : 'dark');
});

// Apply stored theme on load
(() => {
  const t = localStorage.getItem('mahi_theme');
  const isLight = t === 'light';
  if (isLight) document.documentElement.classList.add('theme-light');
  swapThemeImages(isLight ? 'light' : 'dark');
})();

// Suggestion chips
suggestionsEl?.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-suggest]');
  if (!btn) return;
  inputEl.value = btn.getAttribute('data-suggest');
  inputEl.dispatchEvent(new Event('input'));
  inputEl.focus();
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
