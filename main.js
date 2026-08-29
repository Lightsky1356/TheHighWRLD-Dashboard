const { app, BrowserWindow, shell, Menu } = require('electron');
const path = require('path');

const DASHBOARD_URL = process.env.THW_DASHBOARD_URL || 'https://thehighwrlddashboard.pages.dev';
const APP_TITLE = 'TheHighWRLD Dashboard';
const DEBUG = process.env.THW_DEBUG === '1';

function dbg(...args) {
  if (DEBUG) console.log('[thw]', ...args);
}

let mainWindow = null;

function isIntendedTarget(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.hostname.endsWith('pages.dev');
  } catch {
    return false;
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    title: APP_TITLE,
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0a0e1a',
    icon: path.join(__dirname, 'resources', 'icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webviewTag: false,
      spellcheck: true
    }
  });

  mainWindow.setMenuBarVisibility(false);
  Menu.setApplicationMenu(null);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) {
      try { shell.openExternal(url); } catch {}
    }
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isIntendedTarget(url)) return;
    event.preventDefault();
    if (/^https?:/i.test(url)) {
      try { shell.openExternal(url); } catch {}
    }
  });

  mainWindow.webContents.on('page-title-updated', (event) => {
    event.preventDefault();
    mainWindow.setTitle(APP_TITLE);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.loadURL(DASHBOARD_URL);

  mainWindow.webContents.on('did-finish-load', () => {
    dbg('did-finish-load:', mainWindow.webContents.getURL());
  });
  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    dbg('did-fail-load:', code, desc, url);
  });
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    dbg('render-process-gone:', JSON.stringify(details));
  });
  mainWindow.webContents.on('console-message', (_e, _level, message, line, sourceId) => {
    if (DEBUG) dbg('page:', message, '@' + line, sourceId);
  });
}

app.setName(APP_TITLE);
if (process.platform === 'win32') {
  app.setAppUserModelId('com.thehighwrld.dashboard');
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});