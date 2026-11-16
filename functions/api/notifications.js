// Community reply notifications for the top-nav bell.
// GET  /api/notifications          -> { ok, unread, notifications[] } (session user)
// POST /api/notifications { action: "read", id } | { action: "readAll" }
//                      | { action: "dismiss", id }   -> deletes that one row
// Auth: thw_session cookie via _lib/auth.js. Client uid is never trusted.

import { getSessionUser } from "../_lib/auth.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestGet(context) {
  try {
    const db = context.env.wanted_vault;
    const user = await getSessionUser(db, context.request);
    if (!user) return json({ ok: false, error: "not signed in" }, 401);

    const rows = await db.prepare(
      "SELECT id, type, actor_uid, actor_name, message, post_id, reply_id, track_id, read, created_at " +
      "FROM community_notifications WHERE recipient_uid = ? ORDER BY id DESC LIMIT 40"
    ).bind(user.uid).all();

    const unread = await db.prepare(
      "SELECT COUNT(*) AS c FROM community_notifications WHERE recipient_uid = ? AND read = 0"
    ).bind(user.uid).first();

    return json({
      ok: true,
      unread: unread ? unread.c : 0,
      notifications: (rows.results || []).map((n) => ({
        id: n.id,
        type: n.type || "reply",
        actor_uid: n.actor_uid || "",
        actor: n.actor_name || "",
        message: n.message || "",
        post_id: n.post_id || null,
        reply_id: n.reply_id || null,
        track_id: n.track_id || "",
        read: !!n.read,
        ts: n.created_at || "",
      })),
    });
  } catch (err) {
    return json({ ok: false, error: String((err && err.message) || err) }, 500);
  }
}

export async function onRequestPost(context) {
  try {
    const db = context.env.wanted_vault;
    const user = await getSessionUser(db, context.request);
    if (!user) return json({ ok: false, error: "not signed in" }, 401);

    const body = await context.request.json().catch(() => ({}));
    const action = String(body.action || "");

    if (action === "readAll") {
      await db.prepare(
        "UPDATE community_notifications SET read = 1 WHERE recipient_uid = ?"
      ).bind(user.uid).run();
      return json({ ok: true });
    }

    const id = Number(body.id) || 0;
    /* Remove one notification outright. Scoped to recipient_uid exactly like the
       read action below - a notification belonging to somebody else matches no
       row, and that is reported as a 404 rather than a success that changed
       nothing. Marking read was the only option before, so anything dismissed
       stayed in the list for good. */
    if (action === "dismiss" && id > 0) {
      const res = await db.prepare(
        "DELETE FROM community_notifications WHERE id = ? AND recipient_uid = ?"
      ).bind(id, user.uid).run();
      const changed = res && res.meta && typeof res.meta.changes === "number" ? res.meta.changes : 0;
      if (!changed) return json({ ok: false, error: "not found" }, 404);
      return json({ ok: true, id });
    }

    if (action === "read" && id > 0) {
      await db.prepare(
        "UPDATE community_notifications SET read = 1 WHERE id = ? AND recipient_uid = ?"
      ).bind(id, user.uid).run();
      return json({ ok: true });
    }

    return json({ ok: false, error: "unknown action" }, 400);
  } catch (err) {
    return json({ ok: false, error: String((err && err.message) || err) }, 500);
  }
}
