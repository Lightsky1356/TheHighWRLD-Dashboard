// GET /api/trending?days=7&limit=10
// Top played tracks aggregated from the listens table (track_id holds the title).
// Public, read-only. Cached client-side; cheap GROUP BY scan.

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
    const url = new URL(context.request.url);
    const days = Math.max(0, Math.min(90, Number(url.searchParams.get("days")) || 7));
    const limit = Math.max(1, Math.min(25, Number(url.searchParams.get("limit")) || 10));
    const db = context.env.wanted_vault;

    const where = days > 0 ? "WHERE ts >= datetime('now', '-' || ? || ' days')" : "";
    const bindArgs = days > 0 ? [days, limit] : [limit];
    const rows = await db.prepare(
      "SELECT track_id AS title, COUNT(*) AS plays, COUNT(DISTINCT uid) AS listeners, MAX(ts) AS last_play " +
      "FROM listens " + where + " GROUP BY track_id ORDER BY plays DESC LIMIT ?"
    ).bind(...bindArgs).all();

    const allTime = await db.prepare(
      "SELECT COUNT(*) AS total FROM listens"
    ).first();

    return json({
      ok: true,
      days,
      trending: (rows.results || []).map((r, i) => ({
        rank: i + 1,
        title: r.title || "",
        plays: r.plays || 0,
        listeners: r.listeners || 0,
        last_play: r.last_play || "",
      })),
      total_listens: allTime ? allTime.total : 0,
    });
  } catch (err) {
    return json({ ok: false, error: String((err && err.message) || err) }, 500);
  }
}
