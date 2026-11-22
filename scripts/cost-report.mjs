// Measure what the site actually costs, on a real browser against real
// functions, with the database filled to a realistic size.
//
// This answers the two questions the daily limits are actually about:
//   - how many requests does the site make
//   - how many database rows does it read
//
// It drives a browser over the DevTools Protocol and counts the requests,
// and it reads the rows each query reads straight out of the database.
//
// Usage:  node scripts/cost-report.mjs [baseUrl]

import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "child_process";

const BASE = (process.argv[2] || "http://127.0.0.1:8787").replace(/\/$/, "");
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const DEBUG_PORT = 9444;
const PAGES = ["/", "/account", "/wanted", "/vault"];
const SECONDS_PER_PAGE = 12;

if (!fs.existsSync(EDGE)) { console.error("  Edge not found"); process.exit(2); }

const profile = fs.mkdtempSync(path.join(process.env.TEMP || ".", "thw-cost-"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---- 1. the requests, from a real browser ---- */

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
let totalRequests = 0;
let apiRequests = 0;

async function measureRequests() {
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
    const url = p.request.url.replace(BASE, "");
    if (!url.startsWith("http")) return;
    totalRequests++;
    if (url.includes("/api/")) apiRequests++;
    const key = url.split("?")[0];
    byUrl.set(key, (byUrl.get(key) || 0) + 1);
  }]);

  await send("Page.enable");
  await send("Network.enable");

  for (const p of PAGES) {
    await send("Page.navigate", { url: BASE + p });
    await sleep(SECONDS_PER_PAGE * 1000);
  }

  ws.close();
}

/* ---- 2. the rows read, from the database itself ---- */

function rowsRead(db) {
  const results = [];
  const seen = new Set();
  function walk(dir, out = []) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, out); else if (e.name.endsWith(".js")) out.push(p);
    }
    return out;
  }
  for (const f of walk("functions")) {
    const t = fs.readFileSync(f, "utf8");
    const rel = f.replace(/\\/g, "/").replace(/\\/g, "/");
    for (const m of t.matchAll(/prepare\(\s*"((?:[^"\\]|\\.)*)"/g)) {
      const q = m[1].replace(/\\"/g, '"').replace(/\s+/g, " ");
      if (!/FROM/i.test(q)) continue;
      const key = rel + "|" + q;
      if (seen.has(key)) continue;
      seen.add(key);
      try {
        const rows = db.prepare(q).all();
        results.push({ file: rel.replace(/.*functions\/api\//, ""), q: q.slice(0, 80), read: rows.length });
      } catch (_) {}
    }
  }
  return results;
}

function buildDb() {
  const db = new DatabaseSync(":memory:");
  for (const f of fs.readdirSync("migrations").filter((f) => f.endsWith(".sql")).sort()) {
    try { db.exec(fs.readFileSync(path.join("migrations", f), "utf8")); } catch (_) {}
  }
  db.exec("DELETE FROM listens; DELETE FROM analytics_visits; DELETE FROM votes; DELETE FROM replies; DELETE FROM reply_votes; DELETE FROM community_posts; DELETE FROM community_replies; DELETE FROM tracks; DELETE FROM online_visitors;");
  const insListen = db.prepare("INSERT INTO listens (uid, track_id, seconds, ts) VALUES (?,?,?,?)");
  for (let d = 0; d < 120; d++) for (let p = 0; p < 30; p++) {
    insListen.run("member" + (p % 40), "Track " + (p % 60), 45, new Date(Date.UTC(2026, 6, 1 + d, 3, (p * 7) % 20, 5)).toISOString());
  }
  const insVisit = db.prepare("INSERT INTO analytics_visits (uid, page, ua, ip, country, ts) VALUES (?,?,?,?,?,?)");
  for (let d = 0; d < 90; d++) for (let v = 0; v < 12; v++) {
    insVisit.run("member" + (v % 40), ["home", "vault", "wanted", "community"][v % 4], "UA", "1.2.3.4", "US", new Date(Date.UTC(2026, 7, 1 + d, 9, v % 60, 0)).toISOString());
  }
  const insVote = db.prepare("INSERT OR IGNORE INTO votes (track_id, user_id) VALUES (?,?)");
  for (let t = 0; t < 60; t++) for (let m = 0; m < 40; m++) insVote.run("Track " + t, "member" + m);
  const insReply = db.prepare("INSERT INTO replies (track_id, user_name, body, created_at) VALUES (?,?,?,?)");
  for (let t = 0; t < 60; t++) for (let r = 0; r < 25; r++) {
    insReply.run("Track " + t, "member" + r, "a reply", new Date(Date.UTC(2026, 7, 1 + (r % 90))).toISOString());
  }
  const insRV = db.prepare("INSERT OR IGNORE INTO reply_votes (site_uid, reply_id, value) VALUES (?,?,?)");
  for (let i = 1; i <= 1500; i++) for (let m = 0; m < 8; m++) insRV.run("member" + m, i, 1);
  const insPost = db.prepare("INSERT INTO community_posts (author_uid, user_name, title, body, created_at) VALUES (?,?,?,?,?)");
  for (let i = 0; i < 400; i++) insPost.run("member" + (i % 40), "member", "Post " + i, "body", new Date(Date.UTC(2026, 7, 1 + (i % 90))).toISOString());
  const insCR = db.prepare("INSERT INTO community_replies (post_id, author_uid, user_name, body, created_at) VALUES (?,?,?,?,?)");
  for (let p = 1; p <= 400; p++) for (let r = 0; r < 6; r++) {
    insCR.run(p, "member" + r, "member", "body", new Date(Date.UTC(2026, 7, 1 + (r % 90))).toISOString());
  }
  const insTrack = db.prepare("INSERT INTO tracks (title, note) VALUES (?,?)");
  for (let i = 0; i < 280; i++) insTrack.run("Track " + i, "note");
  return db;
}

(async () => {
  console.log("  === the requests, from a real browser ===");
  await measureRequests();
  console.log("  " + totalRequests + " requests over " + PAGES.length + " pages, of which " + apiRequests + " were API calls");
  console.log("");
  console.log("  the busiest:");
  for (const [u, n] of [...byUrl.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
    console.log("    " + String(n).padStart(6) + "  " + u.slice(0, 80));
  }

  console.log("");
  console.log("  === the rows read, from the database ===");
  const db = buildDb();
  const results = rowsRead(db);
  const total = results.reduce((a, r) => a + r.read, 0);
  const top = results.filter((r) => r.read > 0).sort((a, b) => b.read - a.read).slice(0, 8);
  console.log("  " + total + " rows read by every distinct query in the functions, together");
  for (const r of top) {
    console.log("    " + String(r.read).padStart(6) + "  " + r.file);
  }

  child.kill();
  await sleep(200);
  process.exit(0);
})().catch((e) => { console.error("  " + e.message); try { child.kill(); } catch (_) {} process.exit(1); });
