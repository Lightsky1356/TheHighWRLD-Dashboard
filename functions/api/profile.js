function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function initial(name) {
  const s = String(name || "9").trim();
  return s ? s.charAt(0).toUpperCase() : "9";
}

export async function onRequestGet(context) {
  try {
    const url = new URL(context.request.url);
    const user = (url.searchParams.get("user") || "").slice(0, 40);
    const discord = (url.searchParams.get("discord") || "").slice(0, 40);
    const db = context.env.wanted_vault;
    let uid = user;
    if (!uid && discord) {
      const link = await db.prepare(
        "SELECT l.site_uid FROM discord_links l LEFT JOIN users u ON u.uid = l.site_uid WHERE l.discord_id = ? ORDER BY (u.uid IS NULL) ASC, l.rowid ASC LIMIT 1"
      ).bind(discord).first();
      uid = link && link.site_uid ? link.site_uid : "";
    }
    if (!uid) return json({ error: "not found" }, 404);

    const link = await db.prepare(
      "SELECT discord_id, display_name, avatar, bio FROM discord_links WHERE site_uid = ?"
    ).bind(uid).first();
    let prof = await db.prepare("SELECT * FROM user_profiles WHERE site_uid = ?").bind(uid).first();
    if (!prof) {
      const byName = await db.prepare("SELECT site_uid FROM user_profiles WHERE LOWER(name) = LOWER(?) LIMIT 1").bind(uid).first();
      if (byName && byName.site_uid) {
        uid = byName.site_uid;
        prof = await db.prepare("SELECT * FROM user_profiles WHERE site_uid = ?").bind(uid).first();
      }
    }

    const userRow = await db.prepare("SELECT name, verified FROM users WHERE uid = ?").bind(uid).first();
    const profile = {
      name: (prof && prof.name) || (link && link.display_name) || "999_" + String(uid).slice(-4).toUpperCase(),
      username: (userRow && userRow.name) || "",
      verified: !!(userRow && userRow.verified),
      bio: (prof && prof.bio) || (link && link.bio) || "",
      status: (prof && prof.status) || "Online",
      avatar: (prof && prof.avatar) || (link && link.avatar) || "",
      banner: (prof && prof.banner) || "",
      joined: (prof && prof.created_at) || (link && link.linked_at) || "",
    };

    const [listens, favorites, bookmarks, downloads, votes, replies] = await Promise.all([
      db.prepare("SELECT COUNT(*) as n, COALESCE(SUM(seconds),0) as s FROM listens WHERE uid = ?").bind(uid).first(),
      db.prepare("SELECT COUNT(*) as n FROM favorites WHERE uid = ?").bind(uid).first(),
      db.prepare("SELECT COUNT(*) as n FROM bookmarks WHERE uid = ?").bind(uid).first(),
      db.prepare("SELECT COUNT(*) as n FROM downloads WHERE uid = ?").bind(uid).first(),
      db.prepare("SELECT COUNT(*) as n FROM votes WHERE user_id = ?").bind(uid).first(),
      db.prepare("SELECT COUNT(*) as n FROM replies WHERE discord_id = ?").bind((link && link.discord_id) || "__none__").first(),
    ]);

    const [plRows, links, topPlays, recentAct, favRows] = await Promise.all([
      db.prepare("SELECT id, name, desc, color, created_at FROM playlists WHERE uid = ? ORDER BY id DESC LIMIT 12").bind(uid).all(),
      db.prepare("SELECT label, url FROM profile_links WHERE uid = ? ORDER BY sort ASC, id ASC").bind(uid).all(),
      db.prepare("SELECT track_id, COUNT(*) as n FROM listens WHERE uid = ? GROUP BY track_id ORDER BY n DESC LIMIT 5").bind(uid).all(),
      db.prepare("SELECT type, label, ts FROM activity WHERE uid = ? ORDER BY id DESC LIMIT 8").bind(uid).all(),
      db.prepare("SELECT title, created_at FROM favorites WHERE uid = ? ORDER BY created_at DESC LIMIT 50").bind(uid).all(),
    ]);

    const playlists = [];
    for (const p of plRows.results) {
      const tr = await db.prepare("SELECT id, title FROM playlist_tracks WHERE playlist_id = ? ORDER BY id ASC").bind(p.id).all();
      playlists.push({ id: p.id, name: p.name, desc: p.desc, color: p.color, count: tr.results.length, tracks: tr.results.map(function (t) { return { id: t.id, title: t.title }; }) });
    }

    return json({
      ok: true,
      uid,
      handle: (userRow && userRow.name) || String(uid || ""),
      profile,
      discord: link ? { linked: true, name: link.display_name || "" } : { linked: false, name: "" },
      links: links.results,
      stats: {
        plays: listens.n || 0,
        hours: Math.round(((listens.s || 0) / 3600) * 10) / 10,
        favorites: favorites.n || 0,
        bookmarks: bookmarks.n || 0,
        downloads: downloads.n || 0,
        votes: votes.n || 0,
        replies: replies.n || 0,
      },
      playlists,
      favorites: favRows.results,
      topPlays: topPlays.results,
      activity: recentAct.results,
    });
  } catch (err) {
    return json({ error: String(err && err.message || err) }, 500);
  }
}
