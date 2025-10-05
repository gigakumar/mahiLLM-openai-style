const express = require('express');<<<<<<< HEAD

const cors = require('cors');const express = require('express');const express = require('express');

const path = require('path');

const cors = require('cors');const cors = require('cors');

const app = express();

const port = process.env.PORT || 3000;const path = require('path');require('dotenv').config();



app.use(cors());

app.use(express.json());

app.use(express.static(path.join(__dirname, 'public')));const app = express();const app = express();



app.post('/api/chat', (req, res) => {const port = process.env.PORT || 3000;const port = process.env.PORT || 3000;

  const { messages } = req.body;

  const userMessage = messages && messages.length ? messages[messages.length - 1].content : '';

  res.json({

    message: {app.use(cors());app.use(cors());

      role: 'assistant',

      content: `Echo: ${userMessage}`app.use(express.json());app.use(express.json());

    }

  });app.use(express.static(path.join(__dirname, 'public')));app.use(express.static('public'));

});



app.listen(port, () => {

  console.log(`Server running at http://localhost:${port}`);// Simple mock response for chat// Simple model list

});
app.post('/api/chat', (req, res) => {const models = [

  const { messages } = req.body;  { id: 'default', name: 'Assistant', description: 'A helpful assistant.' }

  const userMessage = messages[messages.length - 1];];

  

  // Mock response// Simple chat endpoint

  res.json({app.post('/api/chat', (req, res) => {

    message: {  const { messages } = req.body;

      role: 'assistant',  if (!messages) return res.status(400).json({ error: 'messages required' });

      content: `You said: ${userMessage.content}`  

    }  const userMessage = messages[messages.length - 1]?.content || '';

  });  res.json({ 

});    message: { 

      role: 'assistant', 

app.listen(port, () => {      content: `You said: "${userMessage}". This is a demo response.` 

  console.log(`Server running at http://localhost:${port}`);    }

});  });
=======
const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Simple model list
const models = [
  { id: 'default', name: 'Assistant', description: 'A helpful assistant.' }
];

// Simple chat endpoint
app.post('/api/chat', (req, res) => {
  const { messages } = req.body;
  if (!messages) return res.status(400).json({ error: 'messages required' });
  
  const userMessage = messages[messages.length - 1]?.content || '';
  res.json({ 
    message: { 
      role: 'assistant', 
      content: `You said: "${userMessage}". This is a demo response.` 
    }
  });
>>>>>>> 22f0f8de8a25ed1a4f77cd9c9272ec027e215b54
});

// List models endpoint
app.get('/api/models', (req, res) => {
  res.json({ models });
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
