// GET /api/privacy — own visibility flags (session required).
// POST /api/privacy { show_playlists, show_stats, show_activity, show_favorites }
// Flags: 1 = visible to others, 0 = hidden. Missing row = all visible (legacy).

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

const KEYS = ["show_playlists", "show_stats", "show_activity", "show_favorites"];

function norm(v, fb) {
  if (v === 0 || v === 1 || v === "0" || v === "1") return Number(v);
  return fb;
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestGet(context) {
  try {
    const db = context.env.wanted_vault;
    const user = await getSessionUser(db, context.request);
    if (!user) return json({ ok: false, error: "not signed in" }, 401);
    const row = await db.prepare(
      "SELECT show_playlists, show_stats, show_activity, show_favorites FROM user_privacy WHERE uid = ?"
    ).bind(user.uid).first();
    const out = {};
    for (const k of KEYS) out[k] = row && row[k] != null ? Number(row[k]) : 1;
    return json({ ok: true, privacy: out });
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
    const cur = await db.prepare(
      "SELECT show_playlists, show_stats, show_activity, show_favorites FROM user_privacy WHERE uid = ?"
    ).bind(user.uid).first();
    const out = {};
    for (const k of KEYS) {
      out[k] = norm(body[k], cur && cur[k] != null ? Number(cur[k]) : 1);
    }
    await db.prepare(
      "INSERT INTO user_privacy (uid, show_playlists, show_stats, show_activity, show_favorites, updated_at) " +
      "VALUES (?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now')) " +
      "ON CONFLICT(uid) DO UPDATE SET show_playlists=excluded.show_playlists, show_stats=excluded.show_stats, " +
      "show_activity=excluded.show_activity, show_favorites=excluded.show_favorites, " +
      "updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')"
    ).bind(user.uid, out.show_playlists, out.show_stats, out.show_activity, out.show_favorites).run();
    return json({ ok: true, privacy: out });
  } catch (err) {
    return json({ ok: false, error: String((err && err.message) || err) }, 500);
  }
}
