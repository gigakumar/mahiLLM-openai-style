// Preload: inject API base for direct FastAPI calls, no Node proxy required
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('MAHI_APP_CONFIG', {
  API_BASE: 'http://127.0.0.1:5000',
  API_DIRECT: true,
});
