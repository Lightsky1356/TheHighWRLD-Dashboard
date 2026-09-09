// Simple HTTP-based online presence counter backed by D1.
// POST /api/online  { uid, name? }  → register/update heartbeat
// GET  /api/online                  → { online: <signed-in count>, guests: <signed-out count> }
// Signed in = valid session cookie OR a linked Discord identity for the uid.

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

// Short-TTL in-memory cache for the hot GET path. Pages Functions isolates are
// reused across requests, so all polls landing on one isolate within the TTL
// share a single D1 scan instead of each triggering their own.
let cachedCounts = null;
let cachedAt = 0;
const COUNTS_TTL_MS = 3000;

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
  const authed = (await isSignedIn(db, request, uid)) ? 1 : 0;
  if (!authed) {
    const counts = await getCounts(db, false);
    return json({ ok: true, online: counts.online, guests: counts.guests, tracked: false });
  }

  try {
    await db
      .prepare(
        "INSERT INTO online_visitors (visitor_id, last_seen, name, authed) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(visitor_id) DO UPDATE SET last_seen = ?2, name = ?3, authed = ?4"
      )
      .bind(uid, now, name, authed)
      .run();
  } catch (e) {
    return json({ ok: false, error: String(e.message || e) }, 500);
  }

  const counts = await getCounts(db, true);
  return json({ ok: true, online: counts.online, guests: counts.guests });
}

export async function onRequestGet(context) {
  const { env } = context;
  const db = env.wanted_vault;
  if (!db) return json({ ok: false, error: "no db" }, 500);

  const counts = await getCounts(db, false);
  return json({ ok: true, online: counts.online, guests: counts.guests });
}

async function isSignedIn(db, request, uid) {
  try {
    const { getSessionUser } = await import("../_lib/auth.js");
    const session = await getSessionUser(db, request);
    if (session && session.uid) return true;
  } catch (_) {}
  try {
    const link = await db.prepare(
      "SELECT display_name FROM discord_links WHERE site_uid = ?"
    ).bind(uid).first();
    if (link && link.display_name) return true;
  } catch (_) {}
  return false;
}

async function getCounts(db, refresh) {
  try {
    if (!refresh && cachedCounts && Date.now() - cachedAt < COUNTS_TTL_MS) return cachedCounts;
    // Prune stale entries (>90s old) so the counts stay accurate
    await db
      .prepare("DELETE FROM online_visitors WHERE last_seen < datetime('now', '-90 seconds')")
      .run();
    const row = await db
      .prepare("SELECT COUNT(*) AS total, COALESCE(SUM(authed), 0) AS authed FROM online_visitors")
      .first();
    const total = (row && row.total) || 0;
    const online = Math.min(total, (row && row.authed) || 0);
    cachedCounts = { online, guests: Math.max(0, total - online) };
    cachedAt = Date.now();
    return cachedCounts;
  } catch (_) {
    return cachedCounts || { online: 0, guests: 0 };
  }
}
