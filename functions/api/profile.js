function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}

import { getSessionUser } from "../_lib/auth.js";
import { listeningStats, streakFromDays } from "../_lib/listens-stats.js";
import { loadPlaylistTracks } from "../_lib/playlist-tracks.js";
import { banRejection } from "../_lib/bans.js";

function nowIso() { return new Date().toISOString(); }

/* Same shape as the account endpoint's recorder, kept local so this file does
   not depend on another endpoint's internals. */
async function recordActivity(db, uid, type, label, detail, track_id) {
  try {
    await db.prepare(
      "INSERT INTO activity (uid, type, label, detail, track_id) VALUES (?, ?, ?, ?, ?)"
    ).bind(uid, type, String(label).slice(0, 160), String(detail || "").slice(0, 300), String(track_id || "").slice(0, 80)).run();
    await db.prepare(
      "DELETE FROM activity WHERE uid = ? AND id NOT IN (SELECT id FROM activity WHERE uid = ? ORDER BY id DESC LIMIT 80)"
    ).bind(uid, uid).run();
  } catch (_) {}
}

/* Social platforms we accept. Anything else is rejected, so a profile can never
   be used to smuggle in an arbitrary (or javascript:) link. */
const SOCIAL_PLATFORMS = {
  twitter:  { label: "X / Twitter", base: "https://twitter.com/",  hosts: ["twitter.com", "x.com"] },
  instagram:{ label: "Instagram",    base: "https://instagram.com/", hosts: ["instagram.com"] },
  youtube:  { label: "YouTube",      base: "https://youtube.com/@", hosts: ["youtube.com", "youtu.be"] },
  soundcloud:{ label: "SoundCloud",  base: "https://soundcloud.com/", hosts: ["soundcloud.com"] },
  spotify:  { label: "Spotify",      base: "https://open.spotify.com/user/", hosts: ["open.spotify.com", "spotify.com"] },
  tiktok:   { label: "TikTok",       base: "https://tiktok.com/@", hosts: ["tiktok.com"] },
  facebook: { label: "Facebook",     base: "https://facebook.com/", hosts: ["facebook.com", "fb.com"] },
  website:  { label: "Website",      base: "", hosts: [] }
};

/* Accepts either a bare handle ("juice", "@juice") or a full URL. Full URLs must
   be http(s) and, for a known platform, must actually be on that platform. */
function normalizeSocial(platform, raw) {
  const key = String(platform || "").trim().toLowerCase().slice(0, 40);
  const def = SOCIAL_PLATFORMS[key];
  if (!def) return { error: "unsupported platform" };

  const value = String(raw || "").trim().replace(/^@+/, "").slice(0, 300);
  if (!value) return { clear: true, key: key };

  if (/^https?:\/\//i.test(value)) {
    let u;
    try { u = new URL(value); } catch (e) { return { error: "invalid link" }; }
    if (u.protocol !== "http:" && u.protocol !== "https:") return { error: "invalid link" };
    const host = (u.hostname || "").toLowerCase();
    if (def.hosts.length && !def.hosts.some(function (h) { return host === h || host.endsWith("." + h); })) {
      return { error: "link must be a " + def.label + " URL" };
    }
    return { key: key, url: u.href.slice(0, 500) };
  }

  if (!/^[A-Za-z0-9._-]+$/.test(value)) return { error: "invalid handle" };
  if (value.length > 60) return { error: "handle too long" };
  if (!def.base) return { error: def.label + " needs a full link" };
  return { key: key, url: (def.base + value).slice(0, 500) };
}

/* Avatars are either an inline resized image (data URL) or a remote https URL.
   Size is capped the same way /api/account caps it. */
const AVATAR_MAX = 300000;
function normalizeAvatar(raw) {
  const v = String(raw || "").trim();
  if (!v) return { error: "no avatar data" };
  if (v.length > AVATAR_MAX) return { error: "image is too large" };
  if (/^data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+$/i.test(v)) return { value: v };
  if (v.length <= 500 && /^https?:\/\/[^\s"']+$/i.test(v)) return { value: v };
  return { error: "unsupported image format" };
}

export function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
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
    /* A profile is addressed by its Discord username - /@lightsky1356 - so a
       leading "@" is part of the address, not part of the name. It is stripped
       here so the handle can be looked up. */
    const user = (url.searchParams.get("user") || "").replace(/^@/, "").slice(0, 40);
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

    /* Cheap head read for live polling: just the volatile profile bits plus
       whether the member is listening right now. A handful of small rows, no
       listening stats, so it can sit behind a 5-second poll. */
    if (url.searchParams.get("head") === "1") {
      /* This branch returns early, so it must resolve a /@handle to the site
         uid itself. Without this it queried with the handle as a uid, found no
         profile row and fell back to "999_" + last four handle letters - the
         stale name that kept flashing over other members' pages. */
      let headProf = await db.prepare("SELECT * FROM user_profiles WHERE site_uid = ?").bind(uid).first();
      if (!headProf) {
        const byUsername = await db.prepare("SELECT uid FROM users WHERE LOWER(name) = LOWER(?) LIMIT 1").bind(uid).first();
        if (byUsername && byUsername.uid) {
          uid = byUsername.uid;
          headProf = await db.prepare("SELECT * FROM user_profiles WHERE site_uid = ?").bind(uid).first();
        }
      }
      if (!headProf) {
        const byName = await db.prepare("SELECT site_uid FROM user_profiles WHERE LOWER(name) = LOWER(?) LIMIT 1").bind(uid).first();
        if (byName && byName.site_uid) {
          uid = byName.site_uid;
          headProf = await db.prepare("SELECT * FROM user_profiles WHERE site_uid = ?").bind(uid).first();
        }
      }
      if (!headProf) {
        const byDisc = await db.prepare("SELECT site_uid FROM discord_links WHERE LOWER(display_name) = LOWER(?) LIMIT 1").bind(uid).first();
        if (byDisc && byDisc.site_uid) {
          uid = byDisc.site_uid;
          headProf = await db.prepare("SELECT * FROM user_profiles WHERE site_uid = ?").bind(uid).first();
        }
      }
      const prof = headProf;
      const viewer = await getSessionUser(db, context.request).catch(() => null);
      const isSelf = !!(viewer && viewer.uid && viewer.uid === uid);
      let showProfile = 1, showActivity = 1;
      try {
        const pr = await db.prepare("SELECT show_profile, show_activity FROM user_privacy WHERE uid = ?").bind(uid).first();
        if (pr) {
          showProfile = Number(pr.show_profile == null ? 1 : pr.show_profile);
          showActivity = Number(pr.show_activity == null ? 1 : pr.show_activity);
        }
      } catch (e) {
        try {
          const pr = await db.prepare("SELECT show_activity FROM user_privacy WHERE uid = ?").bind(uid).first();
          if (pr) showActivity = Number(pr.show_activity == null ? 1 : pr.show_activity);
        } catch (e2) {}
      }
      if (!isSelf && showProfile === 0) return json({ ok: true, uid: uid, hidden: true });
      const userRow = await db.prepare("SELECT name, verified FROM users WHERE uid = ?").bind(uid).first();
      const link = await db.prepare("SELECT avatar, display_name FROM discord_links WHERE site_uid = ?").bind(uid).first().catch(() => null);
      let nowPlaying = null;
      try {
        if (isSelf || showActivity !== 0) {
          const np = await db.prepare(
            "SELECT track_id, title, artist, artwork, position_ms, duration_ms, playing, position_at FROM friend_activity WHERE uid = ? AND type = 'listening' AND expires_at IS NOT NULL AND expires_at > ? ORDER BY created_at DESC LIMIT 1"
          ).bind(uid, new Date().toISOString()).first();
          if (np) nowPlaying = {
            trackId: np.track_id || "", title: np.title || "", artist: np.artist || "", artwork: np.artwork || "",
            positionMs: Number(np.position_ms) || 0,
            durationMs: Number(np.duration_ms) || 0,
            playing: Number(np.playing) !== 0,
            positionAt: np.position_at || "",
          };
        }
      } catch (_) {}
      return json({
        ok: true,
        uid,
        name: (prof && prof.name) || (link && link.display_name) || (userRow && userRow.name) || "999_" + String(uid).slice(-4).toUpperCase(),
        handle: (userRow && userRow.name) || String(uid || ""),
        bio: (prof && prof.bio) || "",
        status: (prof && prof.status) || "Online",
        avatar: (prof && prof.avatar) || (link && link.avatar) || "",
        bannerChoice: (prof && prof.banner_choice) || "auto",
        favSong: (prof && prof.fav_song) || "",
        joined: (prof && prof.created_at) || (link && link.linked_at) || "",
        nowPlaying,
      });
    }

    // Activity-only read. Honours the requested profile (the old version always
    // returned the session user's own rows) and the owner's visibility flag.
    if (activityOnly) {
      const viewer = await getSessionUser(db, context.request).catch(function () { return null; });
      const isSelf = !!(viewer && viewer.uid && viewer.uid === uid);
      if (!isSelf) {
        const pr = await db.prepare("SELECT show_activity FROM user_privacy WHERE uid = ?").bind(uid).first().catch(function () { return null; });
        if (pr && Number(pr.show_activity) === 0) return json({ ok: true, hidden: true, uid: uid, activities: [] });
      }
      const recentAct = await db.prepare(
        "SELECT type, label, ts FROM activity WHERE uid = ? ORDER BY id DESC LIMIT 15"
      ).bind(uid).all();
      const activities = (recentAct.results || []).map(function (act) {
        return {
          type: act.type || "general",
          text: act.label || "Activity",
          ts: act.ts || "",
          time: formatTimeAgo(act.ts),
        };
      });
      return json({ ok: true, uid: uid, hidden: false, activities: activities });
    }

    const link = await db.prepare(
      "SELECT discord_id, display_name, avatar, bio FROM discord_links WHERE site_uid = ?"
    ).bind(uid).first();
    let prof = await db.prepare("SELECT * FROM user_profiles WHERE site_uid = ?").bind(uid).first();
    if (!prof) {
      /* The site's username IS the Discord username, and it is what a profile
       * address carries: /@lightsky1356. It is looked up before the
       * display names below, because a display name can be changed by its
       * owner and can collide, while the username is the handle a person
       * actually gives out. */
      const byUsername = await db.prepare("SELECT uid FROM users WHERE LOWER(name) = LOWER(?) LIMIT 1").bind(uid).first();
      if (byUsername && byUsername.uid) {
        uid = byUsername.uid;
        prof = await db.prepare("SELECT * FROM user_profiles WHERE site_uid = ?").bind(uid).first();
      }
    }
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
      favSong: (prof && prof.fav_song) || "",
      bannerChoice: (prof && prof.banner_choice) || "auto",
      joined: (prof && prof.created_at) || (link && link.linked_at) || "",
    };

    /* The listening summaries. They used to be asked for one by one, and
       each one read the whole history - so a profile view read it four
       times over. They are kept now, and this is the one place they are
       read from. */
    const stats = await listeningStats(db, uid, { topLimit: 5, unique: false, months: false, firstLast: false });
    const listens = { n: stats.plays, s: stats.seconds, u: stats.uniqueTracks };

    const [favorites, bookmarks, downloads, votes, replies] = await Promise.all([
      db.prepare("SELECT COUNT(*) as n FROM favorites WHERE uid = ?").bind(uid).first(),
      db.prepare("SELECT COUNT(*) as n FROM bookmarks WHERE uid = ?").bind(uid).first(),
      db.prepare("SELECT COUNT(*) as n FROM downloads WHERE uid = ?").bind(uid).first(),
      db.prepare("SELECT COUNT(*) as n FROM votes WHERE user_id = ?").bind(uid).first(),
      db.prepare("SELECT COUNT(*) as n FROM replies WHERE discord_id = ?").bind((link && link.discord_id) || "__none__").first(),
    ]);

    const [plRows, links, topPlays, recentAct, favRows] = await Promise.all([
      db.prepare("SELECT id, name, desc, color, visibility, created_at FROM playlists WHERE uid = ? ORDER BY id DESC LIMIT 12").bind(uid).all(),
      db.prepare("SELECT label, url FROM profile_links WHERE uid = ? ORDER BY sort ASC, id ASC").bind(uid).all(),
      Promise.resolve({ results: stats.top.map((t) => ({ track_id: t.track_id, n: t.n })) }),
      db.prepare("SELECT type, label, ts FROM activity WHERE uid = ? ORDER BY id DESC LIMIT 8").bind(uid).all(),
      db.prepare("SELECT title, created_at FROM favorites WHERE uid = ? ORDER BY created_at DESC LIMIT 50").bind(uid).all(),
    ]);

    /* The tracks of every playlist are asked for once, rather than one
       playlist at a time - so looking at a profile with a dozen playlists
       runs one query rather than a dozen. */
    const playlistTracks = await loadPlaylistTracks(db, plRows.results);
    const playlists = plRows.results.map((p) => {
      const tr = playlistTracks.get(Number(p.id)) || [];
      return { id: p.id, name: p.name, desc: p.desc, color: p.color, visibility: p.visibility || "private", count: tr.length, tracks: tr };
    });

    // Listening streak for this uid (same math as /api/mystats).
    let streak = 0;
    try { streak = streakFromDays(stats.days); } catch (_) {}

    // 30-day daily activity + 24h listening-hour histogram for profile panels.
    let activity30 = stats.activity30 || [], hours = stats.hours || new Array(24).fill(0);

    // Privacy: viewers other than the owner only see flagged-visible sections.
    // Missing privacy row = all visible (legacy default). Non-owners additionally
    // only ever see public playlists, never private/unlisted ones.
    let vis = { stats: true, playlists: true, favorites: true, activity: true };
    let isSelfViewer = false;
    try {
      const viewer = await getSessionUser(db, context.request);
      isSelfViewer = !!(viewer && viewer.uid && viewer.uid === uid);
      if (!isSelfViewer) {
        /* show_profile lands with migration 0058. A missing column throws and
           the legacy four flags are read instead - visibility for existing
           members is unchanged either way. */
        let pr = null;
        try {
          pr = await db.prepare(
            "SELECT show_playlists, show_stats, show_activity, show_favorites, show_profile FROM user_privacy WHERE uid = ?"
          ).bind(uid).first();
        } catch (e) {
          pr = await db.prepare(
            "SELECT show_playlists, show_stats, show_activity, show_favorites FROM user_privacy WHERE uid = ?"
          ).bind(uid).first().catch(() => null);
        }
        if (pr && Number(pr.show_profile) === 0) {
          return json({ ok: true, uid, hidden: true });
        }
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

    /* Live "listening now" - read the latest unexpired listening row. Gated
       on the activity flag: a viewer who turned off listen sharing is a
       private citizen everywhere, to every viewer. */
    let nowPlaying = null;
    try {
      if (vis.activity) {
        const np = await db.prepare(
          "SELECT track_id, title, artist, artwork, position_ms, duration_ms, playing, position_at FROM friend_activity WHERE uid = ? AND type = 'listening' AND expires_at IS NOT NULL AND expires_at > ? ORDER BY created_at DESC LIMIT 1"
        ).bind(uid, new Date().toISOString()).first();
        if (np) nowPlaying = {
          trackId: np.track_id || "", title: np.title || "", artist: np.artist || "", artwork: np.artwork || "",
          positionMs: Number(np.position_ms) || 0,
          durationMs: Number(np.duration_ms) || 0,
          playing: Number(np.playing) !== 0,
          positionAt: np.position_at || "",
        };
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
      nowPlaying,
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

    if (action === "update_avatar" || action === "update_social") {
      try {
        const rej = await banRejection(db, user.uid);
        if (rej) return rej.response;
      } catch (_) {}
    }

    if (action === "update_avatar") {
      // Explicit clear removes the custom picture; the Discord one then shows again.
      if (body.clear === true) {
        await db.prepare(
          "INSERT INTO user_profiles (site_uid, avatar, updated_at) VALUES (?, '', ?) " +
          "ON CONFLICT(site_uid) DO UPDATE SET avatar = '', updated_at = excluded.updated_at"
        ).bind(user.uid, nowIso()).run();
        await recordActivity(db, user.uid, "profile", "You removed your profile picture", "avatar");
        return json({ ok: true, avatar: "" });
      }

      const avatar = normalizeAvatar(body.avatar);
      if (avatar.error) return json({ ok: false, error: avatar.error }, 400);

      // Upsert: the old UPDATE-only version silently did nothing for members who
      // had no user_profiles row yet.
      await db.prepare(
        "INSERT INTO user_profiles (site_uid, avatar, updated_at) VALUES (?, ?, ?) " +
        "ON CONFLICT(site_uid) DO UPDATE SET avatar = excluded.avatar, updated_at = excluded.updated_at"
      ).bind(user.uid, avatar.value, nowIso()).run();

      await recordActivity(db, user.uid, "profile", "You updated your profile picture", "avatar");
      return json({ ok: true });
    }

    if (action === "update_social") {
      const platform = String(body.platform || "").trim();
      if (!platform) return json({ ok: false, error: "platform required" }, 400);

      const link = normalizeSocial(platform, body.value);
      if (link.error) return json({ ok: false, error: link.error }, 400);

      const existing = await db.prepare(
        "SELECT id FROM profile_links WHERE uid = ? AND label = ?"
      ).bind(user.uid, link.key).first();

      if (link.clear) {
        if (existing) await db.prepare("DELETE FROM profile_links WHERE id = ?").bind(existing.id).run();
        await recordActivity(db, user.uid, "link", "You removed your " + (SOCIAL_PLATFORMS[link.key] || {}).label + " link", link.key);
        return json({ ok: true, cleared: true });
      }

      if (existing) {
        await db.prepare("UPDATE profile_links SET url = ? WHERE id = ?").bind(link.url, existing.id).run();
      } else {
        await db.prepare(
          "INSERT INTO profile_links (uid, label, url, sort) VALUES (?, ?, ?, COALESCE((SELECT MAX(sort) + 1 FROM profile_links WHERE uid = ?), 0))"
        ).bind(user.uid, link.key, link.url, user.uid).run();
      }
      await recordActivity(db, user.uid, "link", "You linked your " + (SOCIAL_PLATFORMS[link.key] || {}).label, link.key);
      return json({ ok: true, url: link.url });
    }

    return json({ ok: false, error: "unknown action" }, 400);
  } catch (err) {
    return json({ ok: false, error: String((err && err.message) || err) }, 500);
  }
}
