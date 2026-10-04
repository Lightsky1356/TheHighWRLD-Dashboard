// GET /api/playlist/:id?key=<share_key>
// Public playlist share view.
//   public    -> anyone
//   unlisted  -> anyone with the share_key (owner always allowed)
//   private   -> session owner only

import { getSessionUser } from "../../_lib/auth.js";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

export async function onRequestGet(context) {
  try {
    const url = new URL(context.request.url);
    const segs = url.pathname.replace(/^\/api\/playlist\/?/, "").split("/").filter(Boolean);
    if (!segs[0] || !/^\d+$/.test(segs[0])) return json({ error: "malformed id" }, 400);

    const db = context.env.wanted_vault;
    const id = Number(segs[0]);

    const playlist = await db.prepare(
      "SELECT id, uid, name, desc, color, visibility, share_key, created_at FROM playlists WHERE id = ?"
    ).bind(id).first();
    if (!playlist) return json({ error: "not found" }, 404);

    const session = await getSessionUser(db, context.request);
    const isOwner = !!(session && session.uid && session.uid === playlist.uid);
    const suppliedKey = (url.searchParams.get("key") || "").slice(0, 64);

    let visible = false;
    if (playlist.visibility === "public") visible = true;
    else if (playlist.visibility === "unlisted") visible = isOwner || (!!playlist.share_key && playlist.share_key === suppliedKey);
    else if (isOwner) visible = true;

    if (!visible) return json({ error: "not found" }, 404);

    const [tracks, owner] = await Promise.all([
      db.prepare("SELECT id, title, added_at FROM playlist_tracks WHERE playlist_id = ? ORDER BY id ASC").bind(id).all(),
      db.prepare(
        `SELECT p.name, p.avatar, COALESCE(l.display_name, '') AS display_name
         FROM user_profiles p
         LEFT JOIN discord_links l ON l.site_uid = p.site_uid
         WHERE p.site_uid = ?`
      ).bind(playlist.uid).first(),
    ]);

    const creatorName = (owner && (owner.name || owner.display_name)) || "";
    return json({
      ok: true,
      playlist: {
        id: playlist.id,
        name: playlist.name,
        desc: playlist.desc || "",
        color: playlist.color || "",
        visibility: playlist.visibility,
        count: (tracks.results || []).length,
        created_at: playlist.created_at,
      },
      creator: {
        uid: playlist.uid,
        name: creatorName,
        avatar: (owner && owner.avatar) || "",
      },
      isOwner,
      tracks: (tracks.results || []).map((t) => ({ id: t.id, title: t.title })),
    });
  } catch (err) {
    return json({ error: String(err && err.message || err) }, 500);
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}