const { app, BrowserWindow, Menu, shell, ipcMain, globalShortcut, Tray, Notification } = require("electron");
const path = require("path");

/* ------------------------------------------------------------------ CONFIG
 * The only thing Discord needs from us is an application id.
 *
 *   1. Open https://discord.com/developers/applications
 *   2. "New Application" -> name it anything, say "TheHighWRLD Dashboard"
 *   3. Copy the APPLICATION ID (a long number) into clientId below
 *   4. Optional: under Rich Presence > Artifacts, upload a cover image, then
 *      set its asset key as the fallback cover below (default "fenty")
 *
 * Leave clientId empty and everything still runs - the toggle in the player
 * settings just says presence isn't set up yet, instead of pretending. */
const CONFIG = {
  clientId: "1533294159039827988",                 // <- paste your Discord Application ID here
  defaultCoverKey: "fenty",     // asset key used when a track has no cover
  /* Shown next to the cover while playback is paused. Discord only draws a
     small image when a KEY is sent, so the asset has to exist under this name:
     upload any small "paused" image in Rich Presence > Artifacts and call it
     exactly this. Rename it here if you upload it under a different name. */
  pauseAssetKey: "pause",
};

const APP_URL = "https://thehighwrlddashboard.pages.dev";
const APP_ORIGIN = new URL(APP_URL).origin;

/* an env var wins, so a packaged build can be pointed elsewhere without editing */
const CLIENT_ID = String(process.env.THWRD_DRP_CLIENT_ID || CONFIG.clientId || "").trim();

let mainWindow = null;
let tray = null;
let quitting = false;
let trayNoticeShown = false;

/* ---------------------------------------------------------------- Discord
 * Discord Rich Presence talks over a local IPC socket to the Discord desktop
 * app. The client is an optional dependency: if it is not installed the rest of
 * the app still runs, and the presence simply reports itself unavailable
 * instead of throwing on startup. */
let rpc = null;
let rpcError = null;
try {
  // eslint-disable-next-line global-require
  rpc = require("discord-rpc");
} catch (e) {
  rpc = null;
  rpcError = "discord-rpc is not installed";
}

const drp = {
  enabled: false,
  connected: false,
  loggedIn: false,
  client: null,
  lastActivity: null,
  lastSent: null,
  retryActivity: null,
  current: null,
  retry: null,
};

/* Where the presence stands right now, for the page to render. */
function status() {
  /* say which of the three things is actually missing, so the settings panel can
     explain itself instead of showing a dead toggle */
  let problem = rpcError || null;
  if (!problem && !rpc) problem = "the Discord client library is not installed";
  if (!problem && !CLIENT_ID) problem = "no Discord application id is set in electron-app/main.js";

  return {
    enabled: drp.enabled,
    connected: drp.connected,
    loggedIn: drp.loggedIn,
    available: !!rpc && !!CLIENT_ID,
    error: problem,
    clientId: CLIENT_ID || null,
  };
}

function toPage(payload) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    /* the page listens on onStatus and expects the status object itself, so a
       status push goes out in that shape */
    if (payload && payload.type === "status") {
      mainWindow.webContents.send("highwrld:drp", { status: payload.status });
      mainWindow.webContents.send("highwrld:status", payload.status);
      return;
    }
    mainWindow.webContents.send("highwrld:drp", payload);
  } catch (e) { /* the window can go away mid-send */ }
}

function buildActivity(a) {
  if (!a || !a.title) return null;
  /* Discord rejects a payload with no details, so only send what we really have */
  const details = { state: a.artist || "Juice WRLD" };
  if (a.album) details.state = a.artist ? a.artist + " - " + a.album : a.album;

  const act = {
    details,
    largeImageKey: a.cover || CONFIG.defaultCoverKey,
    largeImageText: a.title,
    /* marks the activity as a media session - it is not a paused flag */
    instance: true,
  };

  if (a.startedAt) act.startTimestamp = a.startedAt;

  if (a.paused) {
    /* The KEY is what makes this visible. smallImageText on its own draws
       nothing at all, which is why the paused state never appeared. */
    act.smallImageKey = CONFIG.pauseAssetKey;
    act.smallImageText = "Paused";
    /* no end time while paused, otherwise the progress keeps running */
  } else if (a.duration) {
    act.endTimestamp = a.startedAt ? a.startedAt + a.duration : undefined;
  }
  return act;
}

function pushActivity() {
  if (!drp.enabled || !drp.client) return;
  const act = buildActivity(drp.current);
  if (!act) {
    drp.lastSent = null;
    drp.client.clearActivity().catch(function () { /* nothing showing */ });
    return;
  }

  /* Discord throttles activity updates. Sending something identical spends that
     budget for nothing, and a switch already fires several events in a row, so
     skip anything that would not change the presence. */
  const key = JSON.stringify(act);
  if (key === drp.lastSent) return;
  drp.lastSent = key;

  drp.client.setActivity(act).catch(function (e) {
    const msg = String(e && e.message || e);
    /* A throttled update is REJECTED, not queued, so the presence would sit on
       the old track until something else happened to push again. Retry shortly
       instead of dropping it - this is what made a track change look slow. */
    if (/rate limit|rate-limited|too many/i.test(msg)) {
      drp.lastSent = null;
      if (!drp.retryActivity) {
        drp.retryActivity = setTimeout(function () {
          drp.retryActivity = null;
          pushActivity();
        }, 1500);
      }
      return;
    }
    toPage({ type: "error", message: msg });
  });
}

function setState(patch) {
  Object.assign(drp, patch);
  toPage({ type: "status", status: status() });
}

function teardown() {
  if (drp.retry) { clearTimeout(drp.retry); drp.retry = null; }
  if (drp.retryActivity) { clearTimeout(drp.retryActivity); drp.retryActivity = null; }
  if (drp.client) {
    try { drp.client.clearActivity(); } catch (e) { /* already gone */ }
    try { drp.client.destroy(); } catch (e) { /* already gone */ }
  }
  drp.client = null;
  drp.lastSent = null;
  setState({ connected: false, loggedIn: false });
}

function connect() {
  if (!rpc || !CLIENT_ID) { setState({ available: !!rpc && !!CLIENT_ID }); return; }
  if (drp.client) return;
  let client;
  try {
    client = new rpc.Client({ transport: "ipc" });
  } catch (e) {
    setState({ error: "could not start the Discord client" });
    return;
  }
  drp.client = client;

  client.on("ready", function () {
    setState({ connected: true, loggedIn: true, error: null });
    pushActivity();
  });
  client.on("disconnected", function () {
    setState({ connected: false, loggedIn: false });
    scheduleRetry();
  });
  client.on("error", function (e) {
    setState({ connected: false, loggedIn: false, error: String(e && e.message || e) });
  });

  client.login({ clientId: CLIENT_ID }).catch(function (e) {
    /* Not having Discord open yet is the common case, not a fault - the library
       rejects with "connection closed" rather than emitting "disconnected", so
       without this retry the toggle would stay dead until it was clicked again. */
    setState({ error: "waiting for the Discord desktop app", connected: false, loggedIn: false });
    scheduleRetry();
  });
}

/* One pending retry at a time. Discord being closed or restarted is normal, so
   keep knocking rather than leaving presence silently dead. */
function scheduleRetry() {
  if (!drp.enabled || drp.retry) return;
  drp.retry = setTimeout(function () {
    drp.retry = null;
    if (drp.enabled) { teardown(); connect(); }
  }, 5000);
}

/* ------------------------------------------------------------- ipc surface */
function handle(channel, fn) {
  ipcMain.handle(channel, function (_event, payload) {
    return Promise.resolve()
      .then(function () { return fn(payload); })
      .catch(function (e) {
        return { error: String(e && e.message || e) };
      });
  });
}

/* Keyboard shortcuts: the page stores the preference, this mirrors it so the
   accelerators can be registered from here and work without window focus. */
let keyboardShortcuts = true;

handle("highwrld:drp-status", function () { return status(); });

handle("highwrld:get-keyboard-shortcuts", function () { return { enabled: keyboardShortcuts }; });

handle("highwrld:set-keyboard-shortcuts", function (payload) {
  keyboardShortcuts = !!(payload && payload.enabled);
  applyShortcuts();
  return { enabled: keyboardShortcuts };
});

/* Playback keys are registered here rather than left to the page alone, so
   they still work when the web view does not have focus (after alt-tabbing,
   with another app on top). Each one forwards a plain action to the page,
   which already owns the actual player functions. */
const PLAYBACK_SHORTCUTS = [
  ["MediaPlayPause", "playpause"],
  ["MediaNextTrack", "next"],
  ["MediaPreviousTrack", "prev"],
];

function sendPlaybackAction(action) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    mainWindow.webContents.send("highwrld:playback-shortcut", { action });
  } catch (e) { /* the window can go away mid-send */ }
}

function registerPlaybackShortcuts() {
  PLAYBACK_SHORTCUTS.forEach(function (pair) {
    const accel = pair[0], action = pair[1];
    try { globalShortcut.unregister(accel); } catch (e) {}
    if (!keyboardShortcuts) return;
    try {
      globalShortcut.register(accel, function () { sendPlaybackAction(action); });
    } catch (e) { /* an accelerator may be taken by another app */ }
  });
}

function applyShortcuts() {
  /* Keep the app menu hidden - the desktop app is a single window with no need
     for a menu bar. Playback shortcuts live in globalShortcut instead: the old
     build set a menu here and then cleared it on the next line, so nothing was
     ever registered and the keys silently did nothing in the EXE. */
  Menu.setApplicationMenu(null);
  registerPlaybackShortcuts();
}

handle("highwrld:drp-set-enabled", function (payload) {
  const want = !!(payload && payload.enabled);
  if (want === drp.enabled) return status();
  drp.enabled = want;
  if (want) {
    connect();
  } else {
    teardown();
  }
  return status();
});

handle("highwrld:drp-activity", function (payload) {
  /* remember it even while off, so switching on shows the current track */
  drp.current = payload || null;
  pushActivity();
  return { ok: true };
});

handle("highwrld:drp-clear", function () {
  drp.current = null;
  if (drp.client) drp.client.clearActivity().catch(function () {});
  return { ok: true };
});

/* ------------------------------------------------------------------- window */
function showWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) { createWindow(); return; }
  mainWindow.show();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
}

/* Closing the window means "minimise to the tray", not quit. The notice is
   custom so it says exactly where the app went and how to leave it. */
function hideToTray() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.hide();
  if (trayNoticeShown) return;
  trayNoticeShown = true;
  try {
    new Notification({
      title: "TheHighWRLD Dashboard",
      body: "It's in the tray by the clock, and your Discord status keeps showing what you play. To quit, right-click its icon there and choose Quit.",
      icon: path.join(__dirname, "build", "icon.png"),
    }).show();
  } catch (e) { /* notifications are optional */ }
}

function createTray() {
  try {
    if (!tray) tray = new Tray(path.join(__dirname, "build", "icon.png"));
    tray.setToolTip("TheHighWRLD Dashboard");
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: "Show TheHighWRLD Dashboard", click: showWindow },
      { type: "separator" },
      { label: "Quit", click: function () { quitting = true; app.quit(); } },
    ]));
    tray.on("double-click", showWindow);
  } catch (e) { tray = null; }
}

/* A browser-like bar drawn inside the page so the EXE has its own back,
   forward, reload and window controls instead of the OS title bar. */
ipcMain.on("highwrld:win-minimize", function () {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize();
});
ipcMain.on("highwrld:win-maximize", function () {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.on("highwrld:win-close", hideToTray);
ipcMain.on("highwrld:win-back", function () {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.goBack();
});
ipcMain.on("highwrld:win-forward", function () {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.goForward();
});
ipcMain.on("highwrld:win-reload", function () {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.reload();
});

function injectTitlebar() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const code = `(function(){
    if (document.getElementById('thw-exe-bar')) return;
    var bar=document.createElement('div'); bar.id='thw-exe-bar';
    bar.innerHTML='<div class="thw-exe-side"><span class="thw-exe-logo">999</span><span class="thw-exe-title">TheHighWRLD Dashboard</span><button data-a="back" title="Back">&#8592;</button><button data-a="forward" title="Forward">&#8594;</button><button data-a="reload" title="Reload">&#8635;</button></div><div class="thw-exe-side"><button data-a="min" title="Minimize">&#8722;</button><button data-a="max" title="Maximize">&#9633;</button><button data-a="close" title="Close">&#10005;</button></div>';
    var st=document.createElement('style'); st.id='thw-exe-style';
    st.textContent='#thw-exe-bar{position:fixed;top:0;left:0;right:0;height:36px;z-index:100000;display:flex;align-items:center;justify-content:space-between;padding:0 10px;background:#0d0d12;border-bottom:1px solid rgba(255,255,255,.09);color:#e6e4f0;font:12px system-ui;user-select:none;-webkit-app-region:drag}.thw-exe-side{display:flex;align-items:center;gap:5px}#thw-exe-bar button{-webkit-app-region:no-drag;width:30px;height:26px;border:0;border-radius:6px;background:transparent;color:#b9b6c9;font-size:14px;cursor:pointer}#thw-exe-bar button:hover{background:rgba(255,255,255,.1);color:#fff}.thw-exe-logo{background:#7c3aed;color:#fff;border-radius:6px;padding:3px 6px;font-weight:800;font-size:10px}.thw-exe-title{font-weight:700;margin-right:6px}body{padding-top:36px!important}nav{top:42px!important}#app-breadcrumb{top:84px!important}';
    document.head.appendChild(st); document.body.appendChild(bar);
    bar.addEventListener('click',function(e){var b=e.target.closest('[data-a]');if(!b)return;var api=window.highwrld&&window.highwrld.win;if(!api)return;var a=b.getAttribute('data-a');if(api[a])api[a]();});
  })();`;
  mainWindow.webContents.executeJavaScript(code).catch(function () {});
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 620,
    show: false,
    frame: false,
    backgroundColor: "#0a0a0a",
    autoHideMenuBar: true,
    title: "TheHighWRLD Dashboard",
    icon: path.join(__dirname, "build", "icon.png"),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  /* the page may ask about the presence before it has finished booting */
  mainWindow.webContents.on("did-finish-load", function () {
    try {
      mainWindow.webContents.send("highwrld:status", status());
    } catch (e) { /* nothing listening yet */ }
    injectTitlebar();
  });

  mainWindow.once("ready-to-show", function () {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler(function (details) {
    if (details.url.indexOf(APP_ORIGIN) === 0) {
      return { action: "allow" };
    }
    shell.openExternal(details.url);
    return { action: "deny" };
  });

  mainWindow.webContents.on("did-fail-load", function (_event, errorCode, _desc, _url, isMainFrame) {
    if (isMainFrame && errorCode !== -3) {
      mainWindow.loadFile(path.join(__dirname, "offline.html"));
    }
  });

  mainWindow.on("close", function (e) {
    if (quitting) return;
    e.preventDefault();
    hideToTray();
  });

  mainWindow.on("closed", function () {
    if (!quitting) teardown();
    mainWindow = null;
  });

  mainWindow.loadURL(APP_URL);
}

const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", function () {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(function () {
    Menu.setApplicationMenu(null);
    if (process.platform === "win32") {
      app.setAppUserModelId("com.thehighwrld.dashboard");
    }
    createTray();
    createWindow();
    applyShortcuts();

    app.on("activate", function () {
      showWindow();
    });
  });

  app.on("window-all-closed", function () {
    if (!quitting && tray) return; /* closed to the tray, not quit */
    teardown();
    if (process.platform !== "darwin") {
      app.quit();
    }
  });

  /* never leave a presence showing after the app is gone */
  app.on("before-quit", function () {
    quitting = true;
    teardown();
    try { globalShortcut.unregisterAll(); } catch (e) {}
    try { if (tray) tray.destroy(); } catch (e) {}
  });
}