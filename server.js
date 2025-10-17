const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/chat', (req, res) => {
  const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
  const last = messages[messages.length - 1] || {};
  const userText = typeof last.content === 'string' ? last.content : '';
  res.json({
    message: {
      role: 'assistant',
      content: `You said: ${userText}`
    }
  });
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
