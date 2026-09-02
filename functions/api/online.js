// Simple HTTP-based online presence counter backed by D1.
// POST /api/online  { uid, name? }  → register/update heartbeat
// GET  /api/online                  → { online: <count> }

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestPost(context) {
  const { env, request } = context;
  const db = env.wanted_vault;
  if (!db) return json({ ok: false, error: "no db" }, 500);

  let body;
  try { body = await request.json(); } catch (_) { body = {}; }
  const uid = String(body.uid || "").slice(0, 64);
  if (!uid) return json({ ok: false, error: "missing uid" }, 400);
  const name = String(body.name || "").slice(0, 64);
  const now = new Date().toISOString();

  try {
    await db
      .prepare(
        "INSERT INTO online_visitors (visitor_id, last_seen, name) VALUES (?1, ?2, ?3) ON CONFLICT(visitor_id) DO UPDATE SET last_seen = ?2, name = ?3"
      )
      .bind(uid, now, name)
      .run();
  } catch (e) {
    return json({ ok: false, error: String(e.message || e) }, 500);
  }

  const count = await getCount(db);
  return json({ ok: true, online: count });
}

export async function onRequestGet(context) {
  const { env } = context;
  const db = env.wanted_vault;
  if (!db) return json({ ok: false, error: "no db" }, 500);

  const count = await getCount(db);
  return json({ ok: true, online: count });
}

async function getCount(db) {
  try {
    // Prune stale entries (>90s old) so the count stays accurate
    await db
      .prepare("DELETE FROM online_visitors WHERE last_seen < datetime('now', '-90 seconds')")
      .run();
    const row = await db
      .prepare("SELECT COUNT(*) AS cnt FROM online_visitors")
      .first();
    return (row && row.cnt) || 0;
  } catch (_) {
    return 0;
  }
}
