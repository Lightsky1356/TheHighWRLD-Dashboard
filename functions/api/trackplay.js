// GET /api/trackplay?title=<track> — global play + favorite counts for one track.
// Powers the track information panel extras. Public, single indexed lookup.

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
    const title = (url.searchParams.get("title") || "").trim().slice(0, 140);
    if (!title) return json({ ok: false, error: "missing title" }, 400);
    const db = context.env.wanted_vault;
    const [plays, favs] = await Promise.all([
      db.prepare("SELECT COUNT(*) AS n FROM listens WHERE track_id = ?").bind(title).first(),
      db.prepare("SELECT COUNT(*) AS n FROM favorites WHERE title = ?").bind(title).first(),
    ]);
    return json({
      ok: true,
      title,
      plays: plays ? plays.n : 0,
      favs: favs ? favs.n : 0,
    });
  } catch (err) {
    return json({ ok: false, error: String((err && err.message) || err) }, 500);
  }
}
