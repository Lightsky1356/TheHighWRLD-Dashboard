// GET /api/privacy — own visibility flags (session required).
// POST /api/privacy { show_playlists, show_stats, show_activity, show_favorites, show_profile }
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

const KEYS = ["show_playlists", "show_stats", "show_activity", "show_favorites", "show_profile"];
const LEGACY_KEYS = ["show_playlists", "show_stats", "show_activity", "show_favorites"];

function norm(v, fb) {
  if (v === 0 || v === 1 || v === "0" || v === "1") return Number(v);
  return fb;
}

/* The show_profile column lands with migration 0058. Until it has been applied
   the wide SELECT simply throws - so the reader falls back to the legacy
   columns rather than taking every privacy toggle down with it. */
async function readPrivacy(db, uid) {
  try {
    const row = await db.prepare(
      "SELECT show_playlists, show_stats, show_activity, show_favorites, show_profile FROM user_privacy WHERE uid = ?"
    ).bind(uid).first();
    return { row, hasFull: true };
  } catch (e) {
    const row = await db.prepare(
      "SELECT show_playlists, show_stats, show_activity, show_favorites FROM user_privacy WHERE uid = ?"
    ).bind(uid).first().catch(() => null);
    return { row, hasFull: false };
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestGet(context) {
  try {
    const db = context.env.wanted_vault;
    const user = await getSessionUser(db, context.request);
    if (!user) return json({ ok: false, error: "not signed in" }, 401);
    const { row } = await readPrivacy(db, user.uid);
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
    const { row: cur, hasFull } = await readPrivacy(db, user.uid);
    const out = {};
    for (const k of LEGACY_KEYS) {
      out[k] = norm(body[k], cur && cur[k] != null ? Number(cur[k]) : 1);
    }
    if (hasFull) out.show_profile = norm(body.show_profile, cur && cur.show_profile != null ? Number(cur.show_profile) : 1);

    if (hasFull) {
      await db.prepare(
        "INSERT INTO user_privacy (uid, show_playlists, show_stats, show_activity, show_favorites, show_profile, updated_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now')) " +
        "ON CONFLICT(uid) DO UPDATE SET show_playlists=excluded.show_playlists, show_stats=excluded.show_stats, " +
        "show_activity=excluded.show_activity, show_favorites=excluded.show_favorites, " +
        "show_profile=excluded.show_profile, " +
        "updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')"
      ).bind(user.uid, out.show_playlists, out.show_stats, out.show_activity, out.show_favorites, out.show_profile).run();
    } else {
      await db.prepare(
        "INSERT INTO user_privacy (uid, show_playlists, show_stats, show_activity, show_favorites, updated_at) " +
        "VALUES (?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now')) " +
        "ON CONFLICT(uid) DO UPDATE SET show_playlists=excluded.show_playlists, show_stats=excluded.show_stats, " +
        "show_activity=excluded.show_activity, show_favorites=excluded.show_favorites, " +
        "updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')"
      ).bind(user.uid, out.show_playlists, out.show_stats, out.show_activity, out.show_favorites).run();
    }
    /* The flag the caller actually sent comes back regardless of the schema -
       when the column is missing, show_profile reads back as its default 1. */
    if (out.show_profile == null) out.show_profile = norm(body.show_profile, 1);
    return json({ ok: true, privacy: out });
  } catch (err) {
    return json({ ok: false, error: String((err && err.message) || err) }, 500);
  }
}
