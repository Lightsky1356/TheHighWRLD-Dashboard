// GET /api/recent?limit=20 — signed-in user's recent listens (newest first).
// Backed by the listens table; idx_listens_uid_ts keeps this cheap.

import { getSessionUser } from "../_lib/auth.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
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

    const url = new URL(context.request.url);
    const limit = Math.max(1, Math.min(50, Number(url.searchParams.get("limit")) || 20));
    const rows = await db.prepare(
      "SELECT id, track_id AS title, seconds, ts FROM listens WHERE uid = ? ORDER BY id DESC LIMIT ?"
    ).bind(user.uid, limit).all();

    return json({
      ok: true,
      recent: (rows.results || []).map((r) => ({
        id: r.id,
        title: r.title || "",
        seconds: r.seconds || 0,
        ts: r.ts || "",
      })),
    });
  } catch (err) {
    return json({ ok: false, error: String((err && err.message) || err) }, 500);
  }
}
