// Minimal markdown using marked (loaded via CDN)
const md = window.marked ?? { parse: (t) => t };

const el = (sel) => document.querySelector(sel);
const messagesEl = el('#messages');
const statusEl = el('#status');
const inputEl = el('#input');
const formEl = el('#form');
const historyEl = el('#history');
const newChatBtn = el('#new-chat');

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
  const bubble = addRow({ role: 'assistant', content: '' });

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
          scrollToBottom();
        }
        if (json.done) {
          statusEl.textContent = 'Ready';
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
  const content = preface + generateDemoAnswer(last);
  const bubble = addRow({ role: 'assistant', content: '' });
  let acc = '';
  for (const ch of content) {
    await new Promise((r) => setTimeout(r, 8));
    acc += ch;
    renderMarkdownTo(bubble, acc);
    scrollToBottom();
  }
  statusEl.textContent = 'Ready';
  currentMessages.push({ role: 'assistant', content });
  return content;
}

function generateDemoAnswer(prompt) {
  if (!prompt) return 'Ask me anything about MahiLLM, our models, or how to deploy your own assistant.';
  const samples = [
    `Here’s how MahiLLM would approach “${prompt}” in production:\n\n1. Parse your request\n2. Route to the best fine-tuned model\n3. Stream tokens with low latency\n4. Apply safety + formatting\n\nYou can connect this console to your hosted endpoint by deploying the Node server and setting MAHI_API_BASE.`,
    `Quick take on “${prompt}”:\n\n- Draft an answer\n- Provide examples\n- Return structured JSON if needed\n\nThis page is running a static demo so you can preview the experience even without a backend.`,
    `“${prompt}” is a great use case for a fine-tuned assistant. In MahiLLM you can:\n\n- Upload a checkpoint\n- Add guardrails\n- Stream responses to this UI\n\nSwap the demo with your endpoint to go live.`,
  ];
  return samples[Math.floor(Math.random() * samples.length)];
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
