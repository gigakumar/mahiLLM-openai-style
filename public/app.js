
const messagesEl = document.getElementById('messages');
const form = document.getElementById('form');
const input = document.getElementById('input');


function addMessage(text, cls='ai'){
  const el = document.createElement('div');
  el.className = `message ${cls}`;
  el.textContent = text;
  messagesEl.appendChild(el);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

form.addEventListener('submit', async (e)=>{
  e.preventDefault();
  const text = input.value.trim();
  if(!text) return;
  addMessage(text, 'user');
  input.value='';

  addMessage('...', 'ai');
  try{
    const resp = await fetch('/api/chat', {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify({ messages:[{ role:'user', content:text }] })
    });
    const data = await resp.json();
    // replace last placeholder
    const placeholder = messagesEl.querySelector('.message.ai:last-child');
    if(data?.message?.content){
      placeholder.textContent = data.message.content;
    } else if(data?.error){
      placeholder.textContent = 'Error: ' + data.error;
    } else {
      placeholder.textContent = 'No response';
    }
  }catch(err){
    const placeholder = messagesEl.querySelector('.message.ai:last-child');
    placeholder.textContent = 'Request failed';
    console.error(err);
  }
});
