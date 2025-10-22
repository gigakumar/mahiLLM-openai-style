// Electron main process for MahiLLM Desktop
const { app, BrowserWindow, dialog } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

let pyProc = null;

function startPythonAssistant() {
  // Resolve repo root and assistant app dir
  const repoRoot = path.resolve(__dirname, '..');
  const appDir = path.join(repoRoot, 'ondevice-ai');
  const venvPython = path.join(repoRoot, '.venv', 'bin', 'python');

  const args = [
    '-m', 'uvicorn',
    'python_assistant.core.server:app',
    '--app-dir', appDir,
    '--host', '127.0.0.1',
    '--port', '5000',
    '--no-access-log'
  ];

  try {
    pyProc = spawn(venvPython, args, {
      cwd: repoRoot,
      env: { ...process.env, PRIVACY_ASSISTANT_DEBUG: '0' },
      stdio: 'pipe',
    });

    pyProc.stdout.on('data', (d) => console.log(`[assistant] ${d}`));
    pyProc.stderr.on('data', (d) => console.warn(`[assistant:err] ${d}`));
    pyProc.on('exit', (code) => {
      console.log(`[assistant] exited with code ${code}`);
      pyProc = null;
    });
  } catch (e) {
    dialog.showErrorBox('Assistant failed to start', String(e?.message || e));
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Load UI from public folder directly
  const indexPath = path.join(path.resolve(__dirname, '..'), 'public', 'index.html');
  win.loadFile(indexPath);
}

app.whenReady().then(() => {
  startPythonAssistant();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (pyProc) {
    try { pyProc.kill('SIGTERM'); } catch {}
  }
});
