/* Public Lobby chat — /api/chat
 * Reads are public. Posting requires a session, passes the ban gate, is rate
 * limited, and is fanned out to every socket through the existing hub.
 */
import { getSessionUser } from "../_lib/auth.js";
import { banRejection } from "../_lib/bans.js";
import { rateLimit } from "../_lib/rate-limit.js";
import { hubBroadcast } from "../_lib/realtime.js";
import { moderateContent } from "../_lib/automod.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};
const MAX_BODY = 2000;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...CORS } });
}
function clean(s, max) { return String(s == null ? "" : s).replace(/\s+/g, " ").trim().slice(0, max); }

export async function onRequestOptions() { return new Response(null, { status: 204, headers: CORS }); }

export async function onRequestGet(context) {
  const db = context.env.wanted_vault;
  if (!db) return json({ ok: false, error: "no db" }, 500);
  try {
    const before = Number(new URL(context.request.url).searchParams.get("before") || 0) || 0;
    const rows = before
      ? await db.prepare("SELECT * FROM chat_messages WHERE id < ? ORDER BY id DESC LIMIT 50").bind(before).all()
      : await db.prepare("SELECT * FROM chat_messages ORDER BY id DESC LIMIT 50").all();
    const messages = (rows.results || []).reverse().map(r => ({
      id: r.id, uid: r.uid, name: r.name || "Member", avatar: r.avatar || "",
      body: r.deleted_at ? "" : r.body, deleted: !!r.deleted_at,
      replyToId: r.reply_to_id || 0, createdAt: r.created_at,
    }));
    return json({ ok: true, messages });
  } catch (err) {
    return json({ ok: false, error: String(err && err.message || err) }, 500);
  }
}

export async function onRequestPost(context) {
  const db = context.env.wanted_vault;
  if (!db) return json({ ok: false, error: "no db" }, 500);
  const body = await context.request.json().catch(() => null);
  if (!body) return json({ ok: false, error: "missing body" }, 400);
  const who = await getSessionUser(db, context.request);
  if (!who || !who.uid) return json({ ok: false, error: "sign in required" }, 401);
  const rejected = await banRejection(db, who.uid);
  if (rejected) return rejected;
  const text = clean(body.body, MAX_BODY);
  if (!text) return json({ ok: false, error: "Message is required" }, 400);
  const allowed = await rateLimit(db, who.uid, "chat_send", 20, 60000).catch(() => true);
  if (!allowed) return json({ ok: false, error: "Too many messages. Try again shortly." }, 429);

  let name = "Member", avatar = "";
  try {
    const p = await db.prepare(
      "SELECT COALESCE(NULLIF(p.name,''), NULLIF(d.display_name,''), u.name, 'Member') AS name, " +
      "COALESCE(NULLIF(p.avatar,''), NULLIF(d.avatar,''), u.avatar, '') AS avatar " +
      "FROM users u LEFT JOIN user_profiles p ON p.site_uid = u.uid " +
      "LEFT JOIN discord_links d ON d.site_uid = u.uid WHERE u.uid = ?"
    ).bind(who.uid).first();
    if (p) { name = p.name || name; avatar = p.avatar || ""; }
  } catch (_) {}

  const replyTo = Number(body.replyToId) || 0;
  try {
    const ins = await db.prepare(
      "INSERT INTO chat_messages (uid, name, avatar, body, reply_to_id) VALUES (?, ?, ?, ?, ?)"
    ).bind(who.uid, name, avatar, text, replyTo || null).run();
    const id = ins.meta && ins.meta.last_row_id ? Number(ins.meta.last_row_id) : 0;
    const message = { id, uid: who.uid, name, avatar, body: text, deleted: false, replyToId: replyTo, createdAt: new Date().toISOString() };
    await hubBroadcast(context.env, { type: "chat:message", message });
    /* Best effort, never blocks the send. */
    moderateContent(db, context.env, {
      targetType: "chat_message", targetId: String(id), uid: who.uid, text, author: name,
    }).catch(() => {});
    return json({ ok: true, message }, 201);
  } catch (err) {
    return json({ ok: false, error: String(err && err.message || err) }, 500);
  }
}
