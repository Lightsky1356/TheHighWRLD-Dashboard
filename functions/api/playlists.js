// Server playlist manager: full CRUD + visibility + sharing + favorites.
// Session-authed throughout; every mutation verifies pl.uid === session uid.
// Private playlists are never exposed to other users.
//
// GET  /api/playlists?mine=1            -> own playlists w/ tracks + fav state
// GET  /api/playlists?share=<key>       -> public/unlisted playlist by share key
// GET  /api/playlists?favorites=1       -> public playlists the user favorited
// POST /api/playlists { action, ... }   -> create|update|delete|add|remove|
//                                          reorder|duplicate|favorite|unfavorite|share

import { getSessionUser } from "../_lib/auth.js";
import { banRejection } from "../_lib/bans.js";

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

const VIS = ["private", "unlisted", "public"];

function newKey() {
  const b = new Uint8Array(12);
  crypto.getRandomValues(b);
  let s = "";
  for (const x of b) s += x.toString(16).padStart(2, "0");
  return s;
}

async function ownPlaylist(db, uid, id) {
  const pl = await db.prepare("SELECT * FROM playlists WHERE id = ?").bind(id).first();
  if (!pl) return { error: "not found", status: 404 };
  if (String(pl.uid || "") !== String(uid)) return { error: "forbidden", status: 403 };
  return { pl };
}

async function withTracks(db, pl, uid) {
  const tr = await db.prepare(
    "SELECT id, title FROM playlist_tracks WHERE playlist_id = ? ORDER BY id ASC"
  ).bind(pl.id).all();
  let fav = false, favCount = 0;
  try {
    const f = await db.prepare(
      "SELECT COUNT(*) AS n FROM playlist_favorites WHERE playlist_id = ?"
    ).bind(pl.id).first();
    favCount = f ? f.n : 0;
    if (uid) {
      const mine = await db.prepare(
        "SELECT 1 AS y FROM playlist_favorites WHERE playlist_id = ? AND uid = ?"
      ).bind(pl.id, uid).first();
      fav = !!(mine && mine.y);
    }
  } catch (_) {}
  return {
    id: pl.id,
    name: pl.name || "",
    desc: pl.desc || "",
    color: pl.color || "",
    visibility: pl.visibility || "private",
    share_key: pl.share_key || "",
    count: (tr.results || []).length,
    tracks: (tr.results || []).map((t) => ({ id: t.id, title: t.title || "" })),
    fav_count: favCount,
    favorited: fav,
    created_at: pl.created_at || "",
  };
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestGet(context) {
  try {
    const db = context.env.wanted_vault;
    const url = new URL(context.request.url);

    const share = (url.searchParams.get("share") || "").trim();
    if (share) {      const pl = await db.prepare(
        "SELECT * FROM playlists WHERE share_key = ?"
      ).bind(share.slice(0, 48)).first();
      if (!pl || (pl.visibility !== "public" && pl.visibility !== "unlisted")) {
        return json({ ok: false, error: "not found" }, 404);
      }
      let owner = "";
      try {
        const p = await db.prepare("SELECT name FROM user_profiles WHERE site_uid = ?").bind(pl.uid).first();
        owner = (p && p.name) || "";
      } catch (_) {}
      const full = await withTracks(db, pl, "");
      full.owner_name = owner;
      full.owner_uid = pl.uid || "";
      return json({ ok: true, playlist: full });
    }

    const byId = Number(url.searchParams.get("id")) || 0;
    if (byId > 0) {
      const pl = await db.prepare("SELECT * FROM playlists WHERE id = ?").bind(byId).first();
      if (!pl || pl.visibility !== "public") {
        return json({ ok: false, error: "not found" }, 404);
      }
      let owner = "";
      try {
        const p = await db.prepare("SELECT name FROM user_profiles WHERE site_uid = ?").bind(pl.uid).first();
        owner = (p && p.name) || "";
      } catch (_) {}
      const full = await withTracks(db, pl, "");
      full.owner_name = owner;
      full.owner_uid = pl.uid || "";
      return json({ ok: true, playlist: full });
    }

    const user = await getSessionUser(db, context.request);
    if (!user) return json({ ok: false, error: "not signed in" }, 401);

    if (url.searchParams.get("favorites") === "1") {
      const rows = await db.prepare(
        "SELECT pl.* FROM playlists pl JOIN playlist_favorites f ON f.playlist_id = pl.id " +
        "WHERE f.uid = ? AND pl.visibility = 'public' ORDER BY f.created_at DESC LIMIT 50"
      ).bind(user.uid).all();
      const out = [];
      for (const pl of (rows.results || [])) out.push(await withTracks(db, pl, user.uid));
      return json({ ok: true, playlists: out });
    }

    // Default: own playlists (all visibilities).
    const rows = await db.prepare(
      "SELECT * FROM playlists WHERE uid = ? ORDER BY id DESC LIMIT 100"
    ).bind(user.uid).all();
    const out = [];
    for (const pl of (rows.results || [])) out.push(await withTracks(db, pl, user.uid));
    return json({ ok: true, playlists: out });
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
    const action = String(body.action || "");
    const id = Number(body.id) || 0;

    // Ban enforcement: every action here mutates (user-scoped backend).
    try {
      const rej = await banRejection(db, user.uid);
      if (rej) return rej.response;
    } catch (_) {}

    // Ban enforcement: every action here mutates.
    try {
      const rej = await banRejection(db, user.uid);
      if (rej) return rej.response;
    } catch (_) {}

    if (action === "create") {
      const name = String(body.name || "").trim().slice(0, 80) || "New Playlist";
      const desc = String(body.desc || "").trim().slice(0, 300);
      const color = String(body.color || "").trim().slice(0, 24);
      const vis = VIS.includes(body.visibility) ? body.visibility : "private";
      const ins = await db.prepare(
        "INSERT INTO playlists (uid, name, desc, color, visibility, share_key) VALUES (?, ?, ?, ?, ?, ?)"
      ).bind(user.uid, name, desc, color, vis, newKey()).run();
      const pid = ins.meta && ins.meta.last_row_id ? Number(ins.meta.last_row_id) : 0;
      const pl = await db.prepare("SELECT * FROM playlists WHERE id = ?").bind(pid).first();
      return json({ ok: true, playlist: await withTracks(db, pl, user.uid) });
    }

    if (action === "share") {
      const chk = await ownPlaylist(db, user.uid, id);
      if (chk.error) return json({ ok: false, error: chk.error }, chk.status);
      let key = chk.pl.share_key || "";
      if (!key) {
        key = newKey();
        await db.prepare("UPDATE playlists SET share_key = ? WHERE id = ?").bind(key, id).run();
      }
      return json({ ok: true, share_key: key });
    }

    if (action === "favorite" || action === "unfavorite") {
      const pl = await db.prepare("SELECT * FROM playlists WHERE id = ?").bind(id).first();
      if (!pl) return json({ ok: false, error: "not found" }, 404);
      if (pl.visibility !== "public" && String(pl.uid || "") !== String(user.uid)) {
        return json({ ok: false, error: "forbidden" }, 403);
      }
      if (action === "favorite") {
        await db.prepare(
          "INSERT OR IGNORE INTO playlist_favorites (uid, playlist_id) VALUES (?, ?)"
        ).bind(user.uid, id).run();
        try {
          if (String(pl.uid || "") !== String(user.uid)) {
            const msg = (user.name || "Someone") + ' saved your playlist "' + String(pl.name || "").slice(0, 60) + '"';
            const n = await db.prepare(
              "INSERT INTO community_notifications (recipient_uid, type, actor_uid, actor_name, message, post_id, reply_id) VALUES (?, 'playlist', ?, ?, ?, ?, NULL)"
            ).bind(pl.uid, user.uid, user.name || "", msg, id).run();
            const { hubBroadcast } = await import("../_lib/realtime.js");
            await hubBroadcast(context.env, {
              type: "notification:created",
              recipientUid: pl.uid,
              notification: {
                id: n.meta && n.meta.last_row_id ? Number(n.meta.last_row_id) : 0,
                type: "playlist", message: msg, post_id: id, reply_id: null, actor: user.name || "",
              },
            });
          }
        } catch (_) {}
      } else {
        await db.prepare(
          "DELETE FROM playlist_favorites WHERE uid = ? AND playlist_id = ?"
        ).bind(user.uid, id).run();
      }
      return json({ ok: true });
    }

    // All remaining actions require ownership.
    const chk = await ownPlaylist(db, user.uid, id);
    if (chk.error) return json({ ok: false, error: chk.error }, chk.status);

    if (action === "update") {
      const sets = [], args = [];
      if (body.name != null) { sets.push("name = ?"); args.push(String(body.name).trim().slice(0, 80) || chk.pl.name); }
      if (body.desc != null) { sets.push("desc = ?"); args.push(String(body.desc).trim().slice(0, 300)); }
      if (body.color != null) { sets.push("color = ?"); args.push(String(body.color).trim().slice(0, 24)); }
      if (body.visibility != null && VIS.includes(body.visibility)) { sets.push("visibility = ?"); args.push(body.visibility); }
      if (!sets.length) return json({ ok: false, error: "nothing to update" }, 400);
      sets.push("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')");
      await db.prepare("UPDATE playlists SET " + sets.join(", ") + " WHERE id = ?").bind(...args, id).run();
      const pl = await db.prepare("SELECT * FROM playlists WHERE id = ?").bind(id).first();
      return json({ ok: true, playlist: await withTracks(db, pl, user.uid) });
    }

    if (action === "delete") {
      await db.prepare("DELETE FROM playlist_tracks WHERE playlist_id = ?").bind(id).run();
      await db.prepare("DELETE FROM playlist_favorites WHERE playlist_id = ?").bind(id).run();
      await db.prepare("DELETE FROM playlists WHERE id = ?").bind(id).run();
      return json({ ok: true });
    }

    if (action === "add") {
      const titles = Array.isArray(body.titles) ? body.titles : [body.title];
      let added = 0;
      for (const raw of titles) {
        const t = String(raw || "").trim().slice(0, 140);
        if (!t) continue;
        await db.prepare(
          "INSERT INTO playlist_tracks (playlist_id, title) VALUES (?, ?)"
        ).bind(id, t).run();
        added++;
      }
      const pl = await db.prepare("SELECT * FROM playlists WHERE id = ?").bind(id).first();
      return json({ ok: true, added, playlist: await withTracks(db, pl, user.uid) });
    }

    if (action === "remove") {
      if (body.track_id) {
        await db.prepare("DELETE FROM playlist_tracks WHERE id = ? AND playlist_id = ?")
          .bind(Number(body.track_id) || 0, id).run();
      } else if (body.title) {
        await db.prepare("DELETE FROM playlist_tracks WHERE playlist_id = ? AND title = ?")
          .bind(id, String(body.title).slice(0, 140)).run();
      } else {
        return json({ ok: false, error: "track_id or title required" }, 400);
      }
      const pl = await db.prepare("SELECT * FROM playlists WHERE id = ?").bind(id).first();
      return json({ ok: true, playlist: await withTracks(db, pl, user.uid) });
    }

    if (action === "reorder") {
      const titles = Array.isArray(body.titles) ? body.titles.map((t) => String(t || "").trim().slice(0, 140)).filter(Boolean) : null;
      if (!titles) return json({ ok: false, error: "titles[] required" }, 400);
      await db.prepare("DELETE FROM playlist_tracks WHERE playlist_id = ?").bind(id).run();
      for (const t of titles.slice(0, 500)) {
        await db.prepare("INSERT INTO playlist_tracks (playlist_id, title) VALUES (?, ?)").bind(id, t).run();
      }
      const pl = await db.prepare("SELECT * FROM playlists WHERE id = ?").bind(id).first();
      return json({ ok: true, playlist: await withTracks(db, pl, user.uid) });
    }

    if (action === "duplicate") {
      const key = newKey();
      const ins = await db.prepare(
        "INSERT INTO playlists (uid, name, desc, color, visibility, share_key) VALUES (?, ?, ?, ?, 'private', ?)"
      ).bind(user.uid, String(chk.pl.name || "Playlist").slice(0, 70) + " (copy)", chk.pl.desc || "", chk.pl.color || "", key).run();
      const pid = ins.meta && ins.meta.last_row_id ? Number(ins.meta.last_row_id) : 0;
      const tr = await db.prepare("SELECT title FROM playlist_tracks WHERE playlist_id = ? ORDER BY id ASC").bind(id).all();
      for (const r of (tr.results || [])) {
        await db.prepare("INSERT INTO playlist_tracks (playlist_id, title) VALUES (?, ?)").bind(pid, r.title).run();
      }
      const pl = await db.prepare("SELECT * FROM playlists WHERE id = ?").bind(pid).first();
      return json({ ok: true, playlist: await withTracks(db, pl, user.uid) });
    }

    return json({ ok: false, error: "unknown action" }, 400);
  } catch (err) {
    return json({ ok: false, error: String((err && err.message) || err) }, 500);
  }
}
