const { app, BrowserWindow, Menu, shell, ipcMain } = require("electron");
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
  clientId: "",                 // <- paste your Discord Application ID here
  defaultCoverKey: "fenty",     // asset key used when a track has no cover
};

const APP_URL = "https://thehighwrlddashboard.pages.dev";
const APP_ORIGIN = new URL(APP_URL).origin;

/* an env var wins, so a packaged build can be pointed elsewhere without editing */
const CLIENT_ID = String(process.env.THWRD_DRP_CLIENT_ID || CONFIG.clientId || "").trim();

let mainWindow = null;

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
    instance: !!a.paused,
  };
  if (a.startedAt) act.startTimestamp = a.startedAt;
  if (!a.paused && a.duration) act.endTimestamp = a.startedAt ? a.startedAt + a.duration : undefined;
  if (a.paused) act.smallImageText = "Paused";
  return act;
}

function pushActivity() {
  if (!drp.enabled || !drp.client) return;
  const act = buildActivity(drp.current);
  if (!act) {
    drp.client.clearActivity().catch(function () { /* nothing showing */ });
    return;
  }
  drp.client.setActivity(act).catch(function (e) { toPage({ type: "error", message: String(e && e.message || e) }); });
}

function setState(patch) {
  Object.assign(drp, patch);
  toPage({ type: "status", status: status() });
}

function teardown() {
  if (drp.retry) { clearTimeout(drp.retry); drp.retry = null; }
  if (drp.client) {
    try { drp.client.clearActivity(); } catch (e) { /* already gone */ }
    try { drp.client.destroy(); } catch (e) { /* already gone */ }
  }
  drp.client = null;
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

function applyShortcuts() {
  const menu = Menu.getApplicationMenu();
  /* no menu is set by default, so the accelerators are registered as a hidden
     template menu - they keep working while the menu itself stays hidden */
  const items = keyboardShortcuts ? [
    { role: "togglefullscreen" },
    { role: "close" },
  ] : [{ role: "close" }];
  Menu.setApplicationMenu(Menu.buildFromTemplate(items));
  Menu.setApplicationMenu(null);
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
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 620,
    show: false,
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

  mainWindow.on("closed", function () {
    teardown();
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
    createWindow();

    app.on("activate", function () {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });

  app.on("window-all-closed", function () {
    teardown();
    if (process.platform !== "darwin") {
      app.quit();
    }
  });

  /* never leave a presence showing after the app is gone */
  app.on("before-quit", function () { teardown(); });
}