// Which script is asking for /api/push, and how often.
//
// A request every few milliseconds, for as long as a page is open, is the
// kind of thing that reaches a daily limit in an afternoon. This drives a
// real browser over the DevTools Protocol and reports where each request
// came from.
//
// Usage:  node scripts/request-watch.cjs [baseUrl] [seconds]

const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const BASE = (process.argv[2] || "http://127.0.0.1:8787").replace(/\/$/, "");
const SECONDS = Number(process.argv[3] || 20);
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const DEBUG_PORT = 9333;

if (!fs.existsSync(EDGE)) { console.error("  Edge not found"); process.exit(2); }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), "thw-req-"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const child = spawn(EDGE, [
  "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
  "--disable-extensions", "--disable-background-networking",
  "--remote-debugging-port=" + DEBUG_PORT,
  "--user-data-dir=" + profile, "about:blank",
], { stdio: "ignore", windowsHide: true });

async function waitForDevtools() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
      if (r.ok) return await r.json();
    } catch (_) {}
    await sleep(250);
  }
  throw new Error("no devtools");
}

(async () => {
  await waitForDevtools();
  let target;
  try {
    const r = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/new?about:blank`, { method: "PUT" });
    target = await r.json();
  } catch (_) {
    const r = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
    target = (await r.json()).find((t) => t.type === "page");
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener("open", res, { once: true });
    ws.addEventListener("error", () => rej(new Error("ws failed")), { once: true });
  });

  let id = 0;
  const pending = new Map();
  const handlers = new Map();
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id); pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message)); else p.resolve(msg.result);
    } else if (msg.method) {
      const list = handlers.get(msg.method);
      if (list) for (const fn of list) fn(msg.params);
    }
  });
  const send = (method, params = {}) => {
    const n = ++id;
    return new Promise((resolve, reject) => {
      pending.set(n, { resolve, reject });
      ws.send(JSON.stringify({ id: n, method, params }));
    });
  };

  const counts = new Map();
  const byUrl = new Map();
  handlers.set("Network.requestWillBeSent", [(p) => {
    const url = p.request.url.replace(BASE, "");
    byUrl.set(url, (byUrl.get(url) || 0) + 1);
    let stack = "";
    try {
      stack = (p.initiator && p.initiator.stack && p.initiator.stack.callFrames || [])
        .slice(0, 4)
        .map((f) => (f.url || "").split("/").pop() + ":" + f.lineNumber)
        .join(" <- ");
    } catch (_) {}
    const key = url + "  [" + stack + "]";
    counts.set(key, (counts.get(key) || 0) + 1);
  }]);

  await send("Page.enable");
  await send("Network.enable");
  await send("Page.navigate", { url: BASE + "/" });
  await sleep(SECONDS * 1000);

  console.log("  --- every request, by URL ---");
  for (const [u, n] of [...byUrl.entries()].sort((a, b) => b[1] - a[1])) {
    console.log("  " + String(n).padStart(5) + "  " + u.slice(0, 110));
  }
  console.log("");
  console.log("  --- by URL and where it came from ---");
  for (const [k, n] of [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
    console.log("  " + String(n).padStart(5) + "  " + k.slice(0, 150));
  }

  ws.close();
  child.kill();
  await sleep(300);
  process.exit(0);
})().catch((e) => { console.error("  " + e.message); try { child.kill(); } catch (_) {} process.exit(1); });
