# TheHighWRLD Dashboard — Desktop App

Native Windows desktop wrapper for the **TheHighWRLD Dashboard**, the Juice WRLD
community platform. It loads the live cloud dashboard through a sandboxed,
Chromium webview — no rewrite, the exact same site you get in a browser.

## Downloads

Prebuilt Windows binaries are published as GitHub Releases:

- **Installer** — `TheHighWRLD-Dashboard-Setup-1.0.0.exe` (NSIS, per-user install,
  desktop + Start-menu shortcuts)
- **Portable** — `TheHighWRLD-Dashboard-Portable-1.0.0.exe` (no install, run anywhere)

See the [Releases](../../releases) page for the latest.

## Features

- Loads `https://thehighwrlddashboard.pages.dev` in a locked-down Chromium shell
- Window title always shows **TheHighWRLD Dashboard** (never the playing track)
- No menu bar, no address bar, no devtools
- External links open in your system browser
- Fullscreen / resize via standard window controls
- Sandboxed, context-isolated renderer (no Node APIs exposed to the page)
- Optional debug output with `THW_DEBUG=1`

## Build from source

Requires Node.js 20+.

```bash
npm install
npm run start      # run against the live dashboard
npm run dist       # build installer + portable EXE (dist/windows/)
```

Set `THW_DASHBOARD_URL` to point at a different/staging deployment if needed.

## Stack

- [Electron](https://www.electronjs.org/) (Chromium webview, system WebView2 runtime)
- [electron-builder](https://www.electron.build/) (NSIS + portable targets)

Binaries are unsigned (no code-signing certificate is configured).
