
const messagesEl = document.getElementById('messages');
const form = document.getElementById('form');
const input = document.getElementById('input');
const history = document.getElementById('chat-history');
const newChatBtn = document.getElementById('new-chat');

// Auto-resize textarea
input?.addEventListener('input', function() {
  this.style.height = 'auto';
  this.style.height = Math.min(this.scrollHeight, 200) + 'px';
});

function rowTemplate(text, role) {
  const row = document.createElement('div');
  row.className = `message-row ${role}`;
  const message = document.createElement('div');
  message.className = 'message';
  const avatar = document.createElement('div');
  avatar.className = 'avatar';
  avatar.textContent = role === 'user' ? 'U' : 'A';
  const content = document.createElement('div');
  content.className = 'content';
  content.textContent = text;
  message.appendChild(avatar);
  message.appendChild(content);
  row.appendChild(message);
  return row;
}

function addRow(text, role) {
  const row = rowTemplate(text, role);
  messagesEl.appendChild(row);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return row;
}

function addHistory(title) {
  const li = document.createElement('li');
  li.className = 'chat-item';
  li.textContent = title;
  history?.insertBefore(li, history.firstChild);
}

form?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  addRow(text, 'user');
  input.value = '';
  input.style.height = 'auto';

  // typing placeholder
  const placeholder = addRow('...', 'assistant');

  try {
    const resp = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: text }] })
    });
    const data = await resp.json();
    const ans = data?.message?.content || data?.error || 'No response';
    placeholder.replaceWith(rowTemplate(ans, 'assistant'));
    // Add a simple history entry from the user's prompt
    addHistory(text.slice(0, 30) + (text.length > 30 ? '…' : ''));
  } catch (err) {
    console.error(err);
    placeholder.replaceWith(rowTemplate('Request failed', 'assistant'));
  }
});

newChatBtn?.addEventListener('click', () => {
  messagesEl.innerHTML = '';
});
