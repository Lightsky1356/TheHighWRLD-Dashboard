// What the site costs in production, measured against the real site.
//
// The requests are counted by the browser; the rows read come from the
// database's own report of what each query scanned.
//
// Usage:  node scripts/production-cost.mjs

import { spawn } from "child_process";
import fs from "node:fs";
import os from "os";
import path from "node:path";

const BASE = "https://thehighwrlddashboard.pages.dev";
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const DEBUG_PORT = 9555;
const PAGES = ["/", "/account", "/community", "/wanted", "/vault", "/roadmap"];
const SECONDS_PER_PAGE = 14;

if (!fs.existsSync(EDGE)) { console.error("  Edge not found"); process.exit(2); }

const profile = fs.mkdtempSync(path.join(process.env.TEMP || ".", "thw-prod-"));
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

const byUrl = new Map();
let total = 0;
let api = 0;

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

  handlers.set("Network.requestWillBeSent", [(p) => {
    const url = p.request.url;
    if (!url.startsWith("http")) return;
    total++;
    if (url.includes("/api/")) api++;
    const key = url.replace(BASE, "").split("?")[0];
    byUrl.set(key, (byUrl.get(key) || 0) + 1);
  }]);

  await send("Page.enable");
  await send("Network.enable");

  for (const p of PAGES) {
    await send("Page.navigate", { url: BASE + p });
    await sleep(SECONDS_PER_PAGE * 1000);
  }

  console.log("  === a pass over " + PAGES.length + " pages of the live site ===");
  console.log("  " + total + " requests in total, of which " + api + " were function calls");
  console.log("");
  console.log("  the function calls:");
  for (const [u, n] of [...byUrl.entries()].filter(([u]) => u.includes("/api/")).sort((a, b) => b[1] - a[1])) {
    console.log("    " + String(n).padStart(5) + "  " + u);
  }
  console.log("");
  console.log("  the assets (free - they do not invoke a function):");
  const assets = [...byUrl.entries()].filter(([u]) => !u.includes("/api/"));
  console.log("    " + assets.reduce((a, [, n]) => a + n, 0) + " requests for " + assets.length + " distinct assets");

  ws.close();
  child.kill();
  await sleep(300);
  process.exit(0);
})().catch((e) => { console.error("  " + e.message); try { child.kill(); } catch (_) {} process.exit(1); });
