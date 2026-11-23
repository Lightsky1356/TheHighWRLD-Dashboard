/* Active AI moderation: every reviewed submission is judged by the AI hook
 * when one is configured, and a clear verdict removes the content instead of
 * leaving it for a human. This file also guards the full removal of /chat.
 */
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { activeReview } from "../functions/_lib/active-mod.js";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const read = (f) => readFileSync(join(ROOT, f), "utf8");
const out = [];
const check = (name, pass) => out.push(`${pass ? "PASS" : "FAIL"}  ${name}`);

function mockDb() {
  const inserts = [];
  return {
    inserts,
    prepare(sql) {
      return {
        bind(...args) {
          inserts.push({ sql, args });
          return { run: async () => ({ meta: { last_row_id: 42 } }) };
        },
      };
    },
  };
}

const clean = "just a normal suggestion about the site";
const spam = "http://a.test http://b.test http://c.test http://d.test";

/* 1. Rules-only, clean. */
{
  const db = mockDb();
  const r = await activeReview(db, {}, {
    targetType: "suggestion", targetId: "1", uid: "u1", text: clean, author: "A",
  });
  check("clean text is allowed with no AI configured", r.action === "allow" && db.inserts.length === 0);
}

/* 2. Rules-only, obvious link spam -> pending flag, never auto-remove. */
{
  const db = mockDb();
  const r = await activeReview(db, {}, {
    targetType: "suggestion", targetId: "2", uid: "u1", text: spam, author: "A",
  });
  const args = db.inserts[0]?.args || [];
  check("rules-only spam becomes a pending human flag", r.action === "flag" && /INSERT INTO automod_flags/.test(db.inserts[0]?.sql || "") && args.includes("pending") && args.includes("review"));
}

/* 3. AI configured: a high-confidence verdict removes the content. */
{
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ category: "hate", confidence: 0.97, severity: "high" }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const db = mockDb();
  const r = await activeReview(db, {
    AI_MOD_ENDPOINT: `http://127.0.0.1:${port}/moderate`,
    AI_MOD_KEY: "test-key",
  }, {
    targetType: "suggestion", targetId: "3", uid: "u1", text: clean, author: "A",
  });
  await new Promise((resolve) => server.close(resolve));
  check("high-confidence AI verdict auto-removes", r.action === "remove" && r.category === "hate");
  const args = db.inserts[0]?.args || [];
  check("an auto-removal is recorded as actioned by ai", args.includes("actioned") && args.includes("ai") && args.includes("remove"));
}

/* 3b. Workers AI binding works without external secrets. */
{
  const db = mockDb();
  const env = {
    AI: { run: async () => ({ response: '{"category":"harassment","confidence":0.94,"severity":"high"}' }) },
  };
  const r = await activeReview(db, env, {
    targetType: "suggestion", targetId: "3b", uid: "u1", text: clean, author: "A",
  });
  check("a Workers AI binding also auto-removes", r.action === "remove" && r.category === "harassment");
}

/* 4. Every requested surface routes through the active review. */
for (const [file, label] of [
  ["functions/api/suggestions-v2.js", "Suggestions"],
  ["functions/api/wanted-posts.js", "Wanted Vault"],
  ["functions/api/wanted.js", "Vault replies"],
  ["functions/api/community/[[path]].js", "Community messages"],
  ["functions/api/social/[[path]].js", "Direct messages"],
]) {
  check(`${label} uses active AI review`, /activeReview\(/.test(read(file)));
}

/* 5. The /chat feature is gone - files, page, script, nav and realtime bridge. */
check("chat renderer file is gone", !existsSync(join(ROOT, "chat-page.js")));
check("chat API file is gone", !existsSync(join(ROOT, "functions/api/chat.js")));
check("chat migration is gone", !existsSync(join(ROOT, "migrations/0064_public_chat.sql")));
check("index has no chat page or script", !/page-section-chat|chat-page\.js/.test(read("index.html")));
check("service worker no longer precaches chat", !/chat-page\.js/.test(read("sw.js")));
check("realtime no longer forwards chat events", !/thw:chat|chat:/.test(read("presence.js")));

console.log(out.join("\n"));
if (out.some((l) => l.startsWith("FAIL"))) process.exit(1);
