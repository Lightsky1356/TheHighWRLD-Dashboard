const { app, BrowserWindow, Menu, shell } = require("electron");
const path = require("path");

const APP_URL = "https://thehighwrlddashboard.pages.dev";
const APP_ORIGIN = new URL(APP_URL).origin;

let mainWindow = null;

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
      spellcheck: false
    }
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
    if (process.platform !== "darwin") {
      app.quit();
    }
  });
}
