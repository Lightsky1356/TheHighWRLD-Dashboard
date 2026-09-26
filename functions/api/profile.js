function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}

import { getSessionUser } from "../_lib/auth.js";
import { getReputation } from "../_lib/reputation.js";
function initial(name) {
  const s = String(name || "9").trim();
  return s ? s.charAt(0).toUpperCase() : "9";
}

function formatTimeAgo(iso) {
  try {
    const s = Math.floor((Date.now() - new Date(String(iso).replace(" ", "T") + "Z").getTime()) / 1000);
    if (s < 60) return "just now";
    const m = Math.floor(s / 60);
    if (m < 60) return m + "m ago";
    const h = Math.floor(m / 60);
    if (h < 24) return h + "h ago";
    const d = Math.floor(h / 24);
    return d === 1 ? "yesterday" : d + "d ago";
  } catch (e) { return ""; }
}

export async function onRequestGet(context) {
  try {
    const url = new URL(context.request.url);
    const user = (url.searchParams.get("user") || "").slice(0, 40);
    const discord = (url.searchParams.get("discord") || "").slice(0, 40);
    const activityOnly = url.searchParams.get("activity") === "1";
    const db = context.env.wanted_vault;
    let uid = user;
    if (!uid && discord) {
      const link = await db.prepare(
        "SELECT l.site_uid FROM discord_links l LEFT JOIN users u ON u.uid = l.site_uid WHERE l.discord_id = ? ORDER BY (u.uid IS NULL) ASC, l.rowid ASC LIMIT 1"
      ).bind(discord).first();
      uid = link && link.site_uid ? link.site_uid : "";
    }
    if (!uid) return json({ error: "not found" }, 404);

    // Activity-only endpoint for profile enhancements (session-authed)
    if (activityOnly) {
      const sessionUser = await getSessionUser(db, context.request);
      if (!sessionUser) {
        return json({ ok: false, error: "not signed in" }, 401);
      }
      
      const recentAct = await db.prepare(
        "SELECT type, label, ts FROM activity WHERE uid = ? ORDER BY id DESC LIMIT 8"
      ).bind(sessionUser.uid).all();
      
      const activities = (recentAct.results || []).map((act) => ({
        type: act.type || "general",
        text: act.label || "Activity",
        time: formatTimeAgo(act.ts)
      }));
      
      return json({ ok: true, activities });
    }

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
    if (!prof) {
      // Fall back to Discord display names (search + mentions use these).
      const byDisc = await db.prepare("SELECT site_uid FROM discord_links WHERE LOWER(display_name) = LOWER(?) LIMIT 1").bind(uid).first();
      if (byDisc && byDisc.site_uid) {
        uid = byDisc.site_uid;
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
      db.prepare("SELECT id, name, desc, color, visibility, created_at FROM playlists WHERE uid = ? ORDER BY id DESC LIMIT 12").bind(uid).all(),
      db.prepare("SELECT label, url FROM profile_links WHERE uid = ? ORDER BY sort ASC, id ASC").bind(uid).all(),
      db.prepare("SELECT track_id, COUNT(*) as n FROM listens WHERE uid = ? GROUP BY track_id ORDER BY n DESC LIMIT 5").bind(uid).all(),
      db.prepare("SELECT type, label, ts FROM activity WHERE uid = ? ORDER BY id DESC LIMIT 8").bind(uid).all(),
      db.prepare("SELECT title, created_at FROM favorites WHERE uid = ? ORDER BY created_at DESC LIMIT 50").bind(uid).all(),
    ]);

    const playlists = [];
    for (const p of plRows.results) {
      const tr = await db.prepare("SELECT id, title FROM playlist_tracks WHERE playlist_id = ? ORDER BY id ASC").bind(p.id).all();
      playlists.push({ id: p.id, name: p.name, desc: p.desc, color: p.color, visibility: p.visibility || "private", count: tr.results.length, tracks: tr.results.map(function (t) { return { id: t.id, title: t.title }; }) });
    }

    // Listening streak for this uid (same math as /api/mystats).
    let streak = 0;
    try {
      const dayRows = await db.prepare(
        "SELECT DISTINCT substr(ts,1,10) AS day FROM listens WHERE uid = ? ORDER BY day DESC LIMIT 400"
      ).bind(uid).all();
      const set = new Set((dayRows.results || []).map((r) => r.day));
      const dt = new Date();
      const iso = (x) => x.toISOString().slice(0, 10);
      if (!set.has(iso(dt))) dt.setUTCDate(dt.getUTCDate() - 1);
      while (set.has(iso(dt))) { streak++; dt.setUTCDate(dt.getUTCDate() - 1); }
    } catch (_) {}

    // 30-day daily activity + 24h listening-hour histogram for profile panels.
    let activity30 = [], hours = new Array(24).fill(0);
    try {
      const act = await db.prepare(
        "SELECT substr(ts,1,10) AS day, COUNT(*) AS n FROM listens WHERE uid = ? AND ts >= datetime('now', '-30 days') GROUP BY day ORDER BY day ASC"
      ).bind(uid).all();
      activity30 = (act.results || []).map((r) => ({ day: r.day, n: r.n || 0 }));
    } catch (_) {}
    try {
      const hh = await db.prepare(
        "SELECT CAST(strftime('%H', ts) AS INTEGER) AS h, COUNT(*) AS n FROM listens WHERE uid = ? GROUP BY h"
      ).bind(uid).all();
      for (const r of (hh.results || [])) {
        const h = Number(r.h);
        if (h >= 0 && h < 24) hours[h] = r.n || 0;
      }
    } catch (_) {}

    // Privacy: viewers other than the owner only see flagged-visible sections.
    // Missing privacy row = all visible (legacy default). Non-owners additionally
    // only ever see public playlists, never private/unlisted ones.
    let vis = { stats: true, playlists: true, favorites: true, activity: true };
    let isSelfViewer = false;
    try {
      const viewer = await getSessionUser(db, context.request);
      isSelfViewer = !!(viewer && viewer.uid && viewer.uid === uid);
      if (!isSelfViewer) {
        const pr = await db.prepare(
          "SELECT show_playlists, show_stats, show_activity, show_favorites FROM user_privacy WHERE uid = ?"
        ).bind(uid).first();
        if (pr) {
          vis = {
            stats: Number(pr.show_stats) !== 0,
            playlists: Number(pr.show_playlists) !== 0,
            favorites: Number(pr.show_favorites) !== 0,
            activity: Number(pr.show_activity) !== 0,
          };
        }
      }
    } catch (_) {}

    // Standing (Phase 6D). Public-safe projection: only the positive "trusted"
    // state is ever exposed to other members, so a new, standard or restricted
    // account leaks nothing. Self-viewers get their real tier.
    let standing = null;
    try {
      const rep = await getReputation(db, uid);
      if (rep) {
        if (isSelfViewer) standing = { tier: rep.tier, score: rep.score };
        else if (rep.tier === "trusted") standing = { badge: "trusted" };
      }
    } catch (_) {}

    return json({
      ok: true,
      uid,
      handle: (userRow && userRow.name) || String(uid || ""),
      profile,
      discord: link ? { linked: true, name: link.display_name || "" } : { linked: false, name: "" },
      links: links.results,
      visibility: vis,
      standing,
      stats: {
        plays: vis.stats ? listens.n || 0 : 0,
        hours: vis.stats ? Math.round(((listens.s || 0) / 3600) * 10) / 10 : 0,
        favorites: vis.favorites ? favorites.n || 0 : 0,
        bookmarks: bookmarks.n || 0,
        downloads: downloads.n || 0,
        votes: vis.activity ? votes.n || 0 : 0,
        replies: vis.activity ? replies.n || 0 : 0,
      },
      streak: vis.stats ? streak : 0,
      activity30: vis.stats ? activity30 : [],
      hours: vis.stats ? hours : new Array(24).fill(0),
      playlists: vis.playlists ? playlists.filter((p) => isSelfViewer || p.visibility === "public") : [],
      favorites: vis.favorites ? favRows.results : [],
      topPlays: vis.stats ? topPlays.results : [],
      activity: vis.activity ? recentAct.results : [],
    });
  } catch (err) {
    return json({ error: String(err && err.message || err) }, 500);
  }
}

export async function onRequestPost(context) {
  try {
    const db = context.env.wanted_vault;
    const user = await getSessionUser(db, context.request);
    if (!user) return json({ ok: false, error: "not signed in" }, 401);

    const body = await context.request.json().catch(() => ({}));
    const action = String(body.action || "");

    if (action === "update_avatar") {
      const avatarData = String(body.avatar || "").trim();
      if (!avatarData) return json({ ok: false, error: "no avatar data" }, 400);
      
      // Update in user_profiles
      await db.prepare(
        "UPDATE user_profiles SET avatar = ? WHERE site_uid = ?"
      ).bind(avatarData, user.uid).run();
      
      // Also update in discord_links for consistency
      await db.prepare(
        "UPDATE discord_links SET avatar = ? WHERE site_uid = ?"
      ).bind(avatarData, user.uid).run();
      
      return json({ ok: true });
    }

    if (action === "update_social") {
      const platform = String(body.platform || "").trim();
      const value = String(body.value || "").trim();
      
      if (!platform) return json({ ok: false, error: "platform required" }, 400);
      
      // Check if social link already exists
      const existing = await db.prepare(
        "SELECT id FROM profile_links WHERE uid = ? AND label = ?"
      ).bind(user.uid, platform).first();
      
      if (existing) {
        if (value) {
          await db.prepare(
            "UPDATE profile_links SET url = ? WHERE id = ?"
          ).bind(value, existing.id).run();
        } else {
          await db.prepare("DELETE FROM profile_links WHERE id = ?").bind(existing.id).run();
        }
      } else if (value) {
        await db.prepare(
          "INSERT INTO profile_links (uid, label, url, sort) VALUES (?, ?, ?, 0)"
        ).bind(user.uid, platform, value).run();
      }
      
      return json({ ok: true });
    }

    return json({ ok: false, error: "unknown action" }, 400);
  } catch (err) {
    return json({ ok: false, error: String((err && err.message) || err) }, 500);
  }
}
