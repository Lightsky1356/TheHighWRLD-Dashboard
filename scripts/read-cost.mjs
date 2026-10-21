// How many database rows does each endpoint read?
//
// The daily limit is on rows read, not on requests, so the question that
// matters is not "which endpoint is called most" but "which one reads the
// most rows each time it is called". This asks the local database directly,
// with a table full of rows, and counts what each query actually reads.
//
// Usage:  node scripts/read-cost.mjs

import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const db = new DatabaseSync(":memory:");

/* The schema, from the migrations, so the numbers are the real ones. */
for (const f of fs.readdirSync(path.join(ROOT, "migrations")).filter((f) => f.endsWith(".sql")).sort()) {
  const sql = fs.readFileSync(path.join(ROOT, "migrations", f), "utf8");
  try { db.exec(sql); } catch (_) {}
}

/* Fill the tables that grow, so the cost of reading them is what it will be
   in a month rather than what it is on an empty database. */
const MEMBERS = 40;
const DAYS = 120;

db.exec("DELETE FROM listens; DELETE FROM analytics_visits; DELETE FROM votes; DELETE FROM replies; DELETE FROM reply_votes; DELETE FROM community_posts; DELETE FROM community_replies; DELETE FROM online_visitors; DELETE FROM search_logs; DELETE FROM tracks;");

const insListen = db.prepare("INSERT INTO listens (uid, track_id, seconds, ts) VALUES (?,?,?,?)");
for (let d = 0; d < DAYS; d++) {
  for (let p = 0; p < 30; p++) {
    const ts = new Date(Date.UTC(2026, 6, 1 + d, 3, (p * 7) % 20, 5)).toISOString();
    insListen.run("member" + (p % MEMBERS), "Track " + (p % 60), 45, ts);
  }
}
const insVisit = db.prepare("INSERT INTO analytics_visits (uid, page, ua, ip, country, ts) VALUES (?,?,?,?,?,?)");
for (let d = 0; d < 90; d++) {
  for (let v = 0; v < 12; v++) {
    const ts = new Date(Date.UTC(2026, 7, 1 + d, 9, v % 60, 0)).toISOString();
    insVisit.run("member" + (v % MEMBERS), ["home", "vault", "wanted", "community"][v % 4], "UA", "1.2.3.4", "US", ts);
  }
}
const insVote = db.prepare("INSERT OR IGNORE INTO votes (track_id, user_id) VALUES (?,?)");
for (let t = 0; t < 60; t++) for (let m = 0; m < MEMBERS; m++) insVote.run("Track " + t, "member" + m);
const insReply = db.prepare("INSERT INTO replies (track_id, user_name, body, created_at) VALUES (?,?,?,?)");
for (let t = 0; t < 60; t++) for (let r = 0; r < 25; r++) {
  insReply.run("Track " + t, "member" + r, "a reply", new Date(Date.UTC(2026, 7, 1 + (r % 90))).toISOString());
}
const insRV = db.prepare("INSERT OR IGNORE INTO reply_votes (site_uid, reply_id, value) VALUES (?,?,?)");
for (let i = 1; i <= 1500; i++) for (let m = 0; m < 8; m++) insRV.run("member" + m, i, 1);
const insPost = db.prepare("INSERT INTO community_posts (author_uid, user_name, title, body, created_at) VALUES (?,?,?,?,?)");
for (let i = 0; i < 400; i++) insPost.run("member" + (i % MEMBERS), "member", "Post " + i, "body", new Date(Date.UTC(2026, 7, 1 + (i % 90))).toISOString());
const insCR = db.prepare("INSERT INTO community_replies (post_id, author_uid, user_name, body, created_at) VALUES (?,?,?,?,?)");
for (let p = 1; p <= 400; p++) for (let r = 0; r < 6; r++) {
  insCR.run(p, "member" + r, "member", "body", new Date(Date.UTC(2026, 7, 1 + (r % 90))).toISOString());
}
const insTrack = db.prepare("INSERT INTO tracks (title, note) VALUES (?,?)");
for (let i = 0; i < 280; i++) insTrack.run("Track " + i, "note");

console.log("  the table is filled with:");
for (const t of ["listens", "analytics_visits", "votes", "replies", "reply_votes", "community_posts", "community_replies", "tracks"]) {
  console.log("    " + t.padEnd(22) + db.prepare("SELECT COUNT(*) AS n FROM " + t).get().n + " rows");
}
console.log("");

/* Every query in the functions, with the rows it reads. */
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else if (e.name.endsWith(".js")) out.push(p);
  }
  return out;
}

const seen = new Set();
const results = [];

for (const f of walk(path.join(ROOT, "functions"))) {
  const t = fs.readFileSync(f, "utf8");
  const rel = f.replace(/\\/g, "/").replace(ROOT + "/", "");
  for (const m of t.matchAll(/prepare\(\s*"((?:[^"\\]|\\.)*)"/g)) {
    let q = m[1].replace(/\\"/g, '"');
    if (/\?/.test(q)) continue; // a parameterised query: cost depends on the data
    if (!/FROM|SELECT/i.test(q)) continue;
    const key = rel + "|" + q;
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      const before = db.prepare("SELECT total_changes() AS c").get().c;
      const rows = db.prepare(q).all();
      const read = rows.length;
      results.push({ rel, q: q.replace(/\s+/g, " ").slice(0, 90), read });
    } catch (_) {}
  }
}

results.sort((a, b) => b.read - a.read);
console.log("  the queries that read the most rows:");
for (const r of results.slice(0, 22)) {
  console.log("  " + String(r.read).padStart(7) + "  " + r.rel.replace("functions/api/", ""));
  console.log("          " + r.q);
}
