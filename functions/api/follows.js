// Follow system: follow/unfollow users, follower counts for profiles.
// POST is session-authed; GET counts are public. Follow events notify.

import { getSessionUser } from "../_lib/auth.js";
import { banRejection } from "../_lib/bans.js";
import { createNotification } from "../_lib/notifications.js";

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
    const url = new URL(context.request.url);
    const uid = (url.searchParams.get("uid") || "").slice(0, 40);
    if (!uid) return json({ ok: false, error: "missing uid" }, 400);
    const [ing, ers] = await Promise.all([
      db.prepare("SELECT COUNT(*) AS n FROM follows WHERE follower_uid = ?").bind(uid).first(),
      db.prepare("SELECT COUNT(*) AS n FROM follows WHERE followed_uid = ?").bind(uid).first(),
    ]);
    let following = false;
    try {
      const me = await getSessionUser(db, context.request);
      if (me && me.uid) {
        const r = await db.prepare(
          "SELECT 1 AS y FROM follows WHERE follower_uid = ? AND followed_uid = ?"
        ).bind(me.uid, uid).first();
        following = !!(r && r.y);
      }
    } catch (_) {}
    return json({
      ok: true,
      following: ing ? ing.n : 0,
      followers: ers ? ers.n : 0,
      am_following: following,
    });
  } catch (err) {
    return json({ ok: false, error: String((err && err.message) || err) }, 500);
  }
}

export async function onRequestPost(context) {
  try {
    const db = context.env.wanted_vault;
    const me = await getSessionUser(db, context.request);
    if (!me) return json({ ok: false, error: "not signed in" }, 401);
    const body = await context.request.json().catch(() => ({}));
    const action = String(body.action || "");
    const target = String(body.uid || "").slice(0, 40);
    if (!target || target === me.uid) {
      return json({ ok: false, error: "bad target" }, 400);
    }
    try {
      const rej = await banRejection(db, me.uid);
      if (rej) return rej.response;
    } catch (_) {}
    if (action === "follow") {
      await db.prepare(
        "INSERT OR IGNORE INTO follows (follower_uid, followed_uid) VALUES (?, ?)"
      ).bind(me.uid, target).run();
      try {
        const msg = (me.name || "Someone") + " started following you";
        await createNotification(db, context.env, target, {
          type: "follow",
          actorUid: me.uid,
          actorName: me.name || "",
          message: msg,
        });
      } catch (_) {}
      // Include actor uid for deep-linking (reuse post_id slot is wrong here;
      // the client resolves via actor lookup instead — see follows.js).
      return json({ ok: true, following: true });
    }
    if (action === "unfollow") {
      await db.prepare(
        "DELETE FROM follows WHERE follower_uid = ? AND followed_uid = ?"
      ).bind(me.uid, target).run();
      return json({ ok: true, following: false });
    }
    return json({ ok: false, error: "unknown action" }, 400);
  } catch (err) {
    return json({ ok: false, error: String((err && err.message) || err) }, 500);
  }
}
