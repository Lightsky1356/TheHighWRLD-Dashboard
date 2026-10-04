// GET /api/playlist          -> all public playlists (list)
// Read-only, public. Single list query with per-playlist track counts, plus a
// real total so a client can page through instead of re-fetching page one.
// Matches the account/index.js pattern: inline db.prepare().bind().all(), json(), CORS.

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const LIMIT = 80;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

export async function onRequestGet(context) {
  try {
    const db = context.env.wanted_vault;
    const url = new URL(context.request.url);
    const filter = (url.searchParams.get("filter") || "all").toLowerCase();
    const max = Math.max(1, Math.min(200, Number(url.searchParams.get("limit")) || LIMIT));
    const offset = Math.max(0, Math.min(20000, Number(url.searchParams.get("offset")) || 0));

    let orderBy = "pl.id DESC";

    if (filter === "recent") {
      orderBy = "pl.created_at DESC";
    } else if (filter === "popular") {
      orderBy = "COALESCE((SELECT COUNT(*) FROM playlist_favorites pf WHERE pf.playlist_id = pl.id), 0) DESC, pl.id DESC";
    }

    const query = `SELECT pl.id, pl.uid, pl.name, pl.desc, pl.color, pl.created_at, pl.visibility, pl.share_key,
                p.name AS owner_name, p.avatar AS owner_avatar,
                (SELECT COUNT(*) FROM playlist_tracks pt WHERE pt.playlist_id = pl.id) AS track_count,
                (SELECT COUNT(*) FROM playlist_favorites pf WHERE pf.playlist_id = pl.id) AS fav_count
         FROM playlists pl
         LEFT JOIN user_profiles p ON p.site_uid = pl.uid
         WHERE pl.visibility = 'public'
         ORDER BY ${orderBy}
         LIMIT ? OFFSET ?`;

    const rows = await db.prepare(query).bind(max, offset).all();

    const playlists = (rows.results || []).map((r) => ({
      id: r.id,
      uid: r.uid,
      name: r.name,
      desc: r.desc || "",
      color: r.color || "",
      visibility: r.visibility || "public",
      created_at: r.created_at,
      track_count: r.track_count || 0,
      fav_count: r.fav_count || 0,
      owner_name: r.owner_name || "",
      owner_avatar: r.owner_avatar || "",
      share_key: r.share_key || "",
    }));

    /* the real number of public playlists, so "Load more" knows when to stop */
    let total = playlists.length;
    try {
      const t = await db.prepare("SELECT COUNT(*) AS n FROM playlists WHERE visibility = 'public'").first();
      if (t && typeof t.n === "number") total = t.n;
    } catch (_) { /* the page length is still better than nothing */ }

    return json({ ok: true, playlists, total, offset, limit: max, has_more: offset + playlists.length < total });
  } catch (err) {
    return json({ error: String((err && err.message) || err) }, 500);
  }
}
