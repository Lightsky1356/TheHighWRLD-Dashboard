import { getSessionUser, verifyPassword, hashPassword, emailOk } from "../../_lib/auth.js";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};
const OWNER_DISCORD_ID_DEFAULT = "1016529053659967629";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function nowIso() {
  return new Date().toISOString();
}

async function getDiscordLink(db, uid) {
  return await db.prepare(
    "SELECT discord_id, display_name, avatar, bio FROM discord_links WHERE site_uid = ?"
  ).bind(uid).first();
}

function parseUA(ua) {
  ua = String(ua || "");
  let browser = "Browser";
  if (ua.indexOf("Edg/") >= 0) browser = "Edge";
  else if (ua.indexOf("Chrome/") >= 0) browser = "Chrome";
  else if (ua.indexOf("Firefox/") >= 0) browser = "Firefox";
  else if (ua.indexOf("Safari/") >= 0) browser = "Safari";
  else if (ua.indexOf("OPR/") >= 0) browser = "Opera";
  let os = "Unknown OS";
  if (ua.indexOf("Windows") >= 0) os = "Windows";
  else if (ua.indexOf("iPhone") >= 0) os = "iOS";
  else if (ua.indexOf("iPad") >= 0) os = "iPadOS";
  else if (ua.indexOf("Mac OS") >= 0) os = "macOS";
  else if (ua.indexOf("Android") >= 0) os = "Android";
  else if (ua.indexOf("Linux") >= 0) os = "Linux";
  let dev = "Computer";
  if (ua.indexOf("Mobi") >= 0 || ua.indexOf("iPhone") >= 0 || ua.indexOf("Android") >= 0) dev = "Mobile";
  return { browser, os, dev };
}

/* ---------- Profile merge ---------- */
async function loadAccountState(env, db, uid, req) {
  const link = await getDiscordLink(db, uid);
  const discordId = link ? link.discord_id : "";
  const ownerDiscordId = env.OWNER_DISCORD_ID || OWNER_DISCORD_ID_DEFAULT;
  const isOwner = !!discordId && discordId === ownerDiscordId;

  const prof = await db.prepare("SELECT * FROM user_profiles WHERE site_uid = ?").bind(uid).first();
  const userRow = await db.prepare("SELECT email, name, provider, google_id, verified, password_hash FROM users WHERE uid = ?").bind(uid).first();
  const session = await getSessionUser(db, req);
  const isSessionOwner = !!(session && session.uid === uid);

  const profile = {
    name: (prof && prof.name) || (link && link.display_name) || (userRow && userRow.name) || ("999_" + String(uid).slice(-4).toUpperCase()),
    username: (userRow && userRow.name) || "",
    verified: !!(userRow && userRow.verified),
    bio: (prof && prof.bio) || (link && link.bio) || "999 Forever. Streaming the vault on repeat. LLJW.",
    status: (prof && prof.status) || "Online",
    avatar: (prof && prof.avatar) || (link && link.avatar) || (userRow && userRow.avatar) || "",
    banner: (prof && prof.banner) || "",
    joined: (prof && prof.created_at) || (link && link.linked_at) || (userRow && userRow.created_at) || new Date().toISOString(),
  };

  const [listens, favorites, bookmarks, downloads, votes, replies] = await Promise.all([
    db.prepare("SELECT COUNT(*) as n, COALESCE(SUM(seconds),0) as s FROM listens WHERE uid = ?").bind(uid).first(),
    db.prepare("SELECT COUNT(*) as n FROM favorites WHERE uid = ?").bind(uid).first(),
    db.prepare("SELECT COUNT(*) as n FROM bookmarks WHERE uid = ?").bind(uid).first(),
    db.prepare("SELECT COUNT(*) as n FROM downloads WHERE uid = ?").bind(uid).first(),
    db.prepare("SELECT COUNT(*) as n FROM votes WHERE user_id = ?").bind(uid).first(),
    db.prepare("SELECT COUNT(*) as n FROM replies WHERE discord_id = ?").bind(discordId || "__none__").first(),
  ]);

  const [act, notifs, favs, bms, dls, logins, topPlays] = await Promise.all([
    db.prepare("SELECT type, label, detail, track_id, reply_id, ts FROM activity WHERE uid = ? ORDER BY id DESC LIMIT 15").bind(uid).all(),
    db.prepare("SELECT id, type, message, track_id, reply_id, actor, read, ts FROM notifications WHERE uid = ? ORDER BY id DESC LIMIT 25").bind(uid).all(),
    db.prepare("SELECT title, created_at FROM favorites WHERE uid = ? ORDER BY created_at DESC").bind(uid).all(),
    db.prepare("SELECT id, kind, label, sub, created_at FROM bookmarks WHERE uid = ? ORDER BY id DESC LIMIT 40").bind(uid).all(),
    db.prepare("SELECT id, title, size, ts FROM downloads WHERE uid = ? ORDER BY id DESC LIMIT 15").bind(uid).all(),
    db.prepare("SELECT ip, ua, country, method, ts FROM logins WHERE uid = ? ORDER BY id DESC LIMIT 10").bind(uid).all(),
    db.prepare("SELECT track_id, COUNT(*) as n FROM listens WHERE uid = ? GROUP BY track_id ORDER BY n DESC LIMIT 8").bind(uid).all(),
  ]);

  const unread = notifs.results.reduce((a, x) => a + (x.read ? 0 : 1), 0);

  const [plRows, links, suggRows] = await Promise.all([
    db.prepare("SELECT id, name, desc, color, created_at, updated_at FROM playlists WHERE uid = ? ORDER BY id DESC").bind(uid).all(),
    db.prepare("SELECT id, label, url FROM profile_links WHERE uid = ? ORDER BY sort ASC, id ASC").bind(uid).all(),
    db.prepare("SELECT id, text, status, created_at FROM suggestions WHERE uid = ? ORDER BY id DESC LIMIT 100").bind(uid).all(),
  ]);
  const playlists = [];
  for (const p of plRows.results) {
    const tr = await db.prepare("SELECT id, title FROM playlist_tracks WHERE playlist_id = ? ORDER BY id ASC").bind(p.id).all();
    playlists.push({ id: p.id, name: p.name, desc: p.desc, color: p.color, created_at: p.created_at, count: tr.results.length, tracks: tr.results });
  }

  // weekly + monthly listening analytics
  const weekFrom = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);
  const weekly = await db.prepare(
    "SELECT substr(ts,1,10) as day, COUNT(*) as n, COALESCE(SUM(seconds),0) as s FROM listens WHERE uid = ? AND substr(ts,1,10) >= ? GROUP BY day"
  ).bind(uid, weekFrom).all();

  const monthFrom = new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
  const monthly = await db.prepare(
    "SELECT substr(ts,1,10) as day, COUNT(*) as n, COALESCE(SUM(seconds),0) as s FROM listens WHERE uid = ? AND substr(ts,1,10) >= ? GROUP BY day"
  ).bind(uid, monthFrom).all();

  return {
    ok: true,
    uid,
    isOwner,
    isSessionOwner,
    discord: link ? { id: discordId, name: link.display_name || "", avatar: link.avatar || "", bio: link.bio || "", linked: !!link.discord_id } : { id: "", name: "", avatar: "", bio: "", linked: false },
    profile,
    ...(isSessionOwner && userRow ? {
      account: {
        email: userRow.email || "",
        name: userRow.name || profile.name,
        provider: userRow.provider || "email",
        verified: !!userRow.verified,
        hasPassword: !!userRow.password_hash,
      },
      google: {
        linked: !!userRow.google_id,
        email: userRow.email || "",
        name: userRow.name || "",
      },
    } : {}),
    theme: (prof && prof.theme) || "default",
    language: (prof && prof.language) || "en",
    stats: {
      plays: listens.n || 0,
      hours: Math.round(((listens.s || 0) / 3600) * 10) / 10,
      favorites: favorites.n || 0,
      bookmarks: bookmarks.n || 0,
      downloads: downloads.n || 0,
      votes: votes.n || 0,
      replies: replies.n || 0,
    },
    unread,
    activity: act.results,
    notifications: notifs.results,
    favorites: favs.results,
    bookmarks: bms.results,
    downloads: dls.results,
    logins: logins.results.map((l) => ({ ...parseUA(l.ua), ip: l.ip, country: l.country, method: l.method, ts: l.ts })),
    suggestions: suggRows.results.map((x) => ({ id: x.id, text: x.text, status: x.status, created_at: x.created_at })),
    playlists,
    links: links.results,
    analytics: {
      weekly: weekly.results,
      monthly: monthly.results,
      topPlays: topPlays.results,
    },
  };
}

async function recordActivity(db, uid, type, label, detail, track_id, reply_id) {
  await db.prepare(
    "INSERT INTO activity (uid, type, label, detail, track_id, reply_id) VALUES (?, ?, ?, ?, ?, ?)"
  ).bind(uid, type, String(label).slice(0, 160), String(detail || "").slice(0, 300), String(track_id || "").slice(0, 80), reply_id != null ? Number(reply_id) : null).run();
  await db.prepare("DELETE FROM activity WHERE uid = ? AND id NOT IN (SELECT id FROM activity WHERE uid = ? ORDER BY id DESC LIMIT 80)").bind(uid, uid).run();
}

export async function onRequestGet(context) {
  try {
    const url = new URL(context.request.url);
    const user = (url.searchParams.get("user") || "").slice(0, 40);
    if (!user) return json({ error: "missing user" }, 400);
    return json(await loadAccountState(context.env, context.env.wanted_vault, user, context.request));
  } catch (err) {
    return json({ error: String(err && err.message || err) }, 500);
  }
}

export async function onRequestPost(context) {
  const body = await context.request.json().catch(() => null);
  if (!body || !body.action) return json({ error: "missing action" }, 400);
  const db = context.env.wanted_vault;
  const uid = String(body.user || "").slice(0, 40);
  if (!uid) return json({ error: "missing user" }, 400);
  const authed = await (async () => {
    try {
      const session = await getSessionUser(db, context.request);
      if (session && session.uid) return true;
    } catch (_) {}
    try {
      const link = await getDiscordLink(db, uid);
      if (link && link.display_name) return true;
    } catch (_) {}
    return false;
  })();
  if (!authed) return json({ error: "sign in required" }, 401);
  try {
    switch (body.action) {
      case "updateProfile": {
        const name = String(body.name || "").slice(0, 24);
        const bio = String(body.bio || "").slice(0, 300);
        const status = String(body.status || "Online").slice(0, 24);
        const avatar = String(body.avatar || "").slice(0, 300000);
        const banner = String(body.banner || "").slice(0, 300000);
        await db.prepare(
          `INSERT INTO user_profiles (site_uid, name, bio, status, avatar, banner, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(site_uid) DO UPDATE SET name = excluded.name, bio = excluded.bio, status = excluded.status, avatar = excluded.avatar, banner = excluded.banner, updated_at = excluded.updated_at`
        ).bind(uid, name, bio, status, avatar, banner, nowIso()).run();
        await recordActivity(db, uid, "profile", "You updated your profile", name || "profile");
        break;
      }
      case "saveTheme": {
        const theme = String(body.theme || "default").slice(0, 24);
        await db.prepare(
          `INSERT INTO user_profiles (site_uid, theme, updated_at) VALUES (?, ?, ?)
           ON CONFLICT(site_uid) DO UPDATE SET theme = excluded.theme, updated_at = excluded.updated_at`
        ).bind(uid, theme, nowIso()).run();
        break;
      }
      case "saveLanguage": {
        const language = String(body.language || "en").slice(0, 8);
        await db.prepare(
          `INSERT INTO user_profiles (site_uid, language, updated_at) VALUES (?, ?, ?)
           ON CONFLICT(site_uid) DO UPDATE SET language = excluded.language, updated_at = excluded.updated_at`
        ).bind(uid, language, nowIso()).run();
        break;
      }
      case "toggleFavorite": {
        const title = String(body.title || "").slice(0, 120);
        if (!title) return json({ error: "missing title" }, 400);
        const ex = await db.prepare("SELECT 1 FROM favorites WHERE uid = ? AND title = ?").bind(uid, title).first();
        if (ex) {
          await db.prepare("DELETE FROM favorites WHERE uid = ? AND title = ?").bind(uid, title).run();
        } else {
          await db.prepare("INSERT INTO favorites (uid, title) VALUES (?, ?)").bind(uid, title).run();
          await recordActivity(db, uid, "favorite", "You favorited " + title, title, title);
        }
        break;
      }
      case "addBookmark": {
        const kind = String(body.kind || "song").slice(0, 20);
        const label = String(body.label || "").slice(0, 160);
        const sub = String(body.sub || "").slice(0, 160);
        if (!label) return json({ error: "missing label" }, 400);
        await db.prepare("INSERT INTO bookmarks (uid, kind, label, sub) VALUES (?, ?, ?, ?)").bind(uid, kind, label, sub).run();
        await recordActivity(db, uid, "bookmark", "You bookmarked " + label, sub, label);
        break;
      }
      case "removeBookmark": {
        const id = Number(body.id);
        if (!id) return json({ error: "missing id" }, 400);
        await db.prepare("DELETE FROM bookmarks WHERE id = ? AND uid = ?").bind(id, uid).run();
        break;
      }
      case "createPlaylist": {
        const name = String(body.name || "").slice(0, 60) || "New Playlist";
        const desc = String(body.desc || "").slice(0, 160);
        const color = String(body.color || "").slice(0, 12);
        const ins = await db.prepare("INSERT INTO playlists (uid, name, desc, color) VALUES (?, ?, ?, ?)").bind(uid, name, desc, color).run();
        const pid = ins.meta && ins.meta.last_row_id ? Number(ins.meta.last_row_id) : null;
        if (pid) {
          const tracks = Array.isArray(body.tracks) ? body.tracks.slice(0, 300) : [];
          for (const t of tracks) {
            await db.prepare("INSERT INTO playlist_tracks (playlist_id, title) VALUES (?, ?)").bind(pid, String(t.title || "").slice(0, 160)).run();
          }
        }
        await recordActivity(db, uid, "playlist", "You created playlist " + name, desc, name);
        break;
      }
      case "deletePlaylist": {
        const pid = Number(body.id);
        if (!pid) return json({ error: "missing id" }, 400);
        await db.prepare("DELETE FROM playlist_tracks WHERE playlist_id = ? AND playlist_id IN (SELECT id FROM playlists WHERE id = ? AND uid = ?)").bind(pid, pid, uid).run();
        await db.prepare("DELETE FROM playlists WHERE id = ? AND uid = ?").bind(pid, uid).run();
        break;
      }
      case "renamePlaylist": {
        const pid = Number(body.id);
        if (!pid) return json({ error: "missing id" }, 400);
        const name = String(body.name || "").slice(0, 60);
        const desc = String(body.desc || "").slice(0, 160);
        const color = String(body.color || "").slice(0, 12);
        await db.prepare("UPDATE playlists SET name = ?, desc = ?, color = ?, updated_at = ? WHERE id = ? AND uid = ?").bind(name, desc, color, nowIso(), pid, uid).run();
        break;
      }
      case "addPlaylistTrack": {
        const pid = Number(body.playlist_id);
        const title = String(body.title || "").slice(0, 160);
        if (!pid || !title) return json({ error: "missing fields" }, 400);
        const owns = await db.prepare("SELECT 1 FROM playlists WHERE id = ? AND uid = ?").bind(pid, uid).first();
        if (!owns) return json({ error: "not found" }, 404);
        const ex = await db.prepare("SELECT 1 FROM playlist_tracks WHERE playlist_id = ? AND title = ?").bind(pid, title).first();
        if (!ex) await db.prepare("INSERT INTO playlist_tracks (playlist_id, title) VALUES (?, ?)").bind(pid, title).run();
        await db.prepare("UPDATE playlists SET updated_at = ? WHERE id = ?").bind(nowIso(), pid).run();
        break;
      }
      case "removePlaylistTrack": {
        const tid = Number(body.track_id);
        if (!tid) return json({ error: "missing id" }, 400);
        await db.prepare("DELETE FROM playlist_tracks WHERE id = ? AND playlist_id IN (SELECT id FROM playlists WHERE uid = ?)").bind(tid, uid).run();
        break;
      }
      case "saveLinks": {
        const raw = Array.isArray(body.links) ? body.links.slice(0, 12) : [];
        const links = raw.map(function (l) { return { label: String((l && l.label) || "").slice(0, 40), url: String((l && l.url) || "").slice(0, 500) }; })
          .filter(function (l) { return l.label && /^https?:\/\//.test(l.url); });
        await db.prepare("DELETE FROM profile_links WHERE uid = ?").bind(uid).run();
        for (let i = 0; i < links.length; i++) {
          await db.prepare("INSERT INTO profile_links (uid, label, url, sort) VALUES (?, ?, ?, ?)").bind(uid, links[i].label, links[i].url, i).run();
        }
        break;
      }
      case "addDownload": {
        const title = String(body.title || "").slice(0, 160);
        const size = String(body.size || "").slice(0, 20);
        if (!title) return json({ error: "missing title" }, 400);
        await db.prepare("INSERT INTO downloads (uid, title, size) VALUES (?, ?, ?)").bind(uid, title, size).run();
        await db.prepare("DELETE FROM downloads WHERE uid = ? AND id NOT IN (SELECT id FROM downloads WHERE uid = ? ORDER BY id DESC LIMIT 50)").bind(uid, uid).run();
        await recordActivity(db, uid, "download", "You downloaded " + title, size, title);
        break;
      }
      case "listen": {
        const title = String(body.title || "").slice(0, 160);
        const seconds = Math.max(1, Math.min(86400, Number(body.seconds) || 0));
        await db.prepare("INSERT INTO listens (uid, track_id, seconds) VALUES (?, ?, ?)").bind(uid, title, seconds).run();
        break;
      }
      case "logLogin": {
        const ip = (context.request.headers.get("CF-Connecting-IP") || "").slice(0, 45);
        const country = (context.request.headers.get("CF-IPCountry") || "").slice(0, 4);
        const ua = String(context.request.headers.get("User-Agent") || "").slice(0, 300);
        const method = String(body.method || "session").slice(0, 24);
        await db.prepare("INSERT INTO logins (uid, ip, ua, country, method) VALUES (?, ?, ?, ?, ?)").bind(uid, ip, ua, country, method).run();
        await db.prepare("DELETE FROM logins WHERE uid = ? AND id NOT IN (SELECT id FROM logins WHERE uid = ? ORDER BY id DESC LIMIT 40)").bind(uid, uid).run();
        break;
      }
      case "markNotifRead": {
        const id = Number(body.id);
        if (id) await db.prepare("UPDATE notifications SET read = 1 WHERE id = ? AND uid = ?").bind(id, uid).run();
        break;
      }
      case "markAllNotif": {
        await db.prepare("UPDATE notifications SET read = 1 WHERE uid = ?").bind(uid).run();
        break;
      }
      case "tfaReset": {
        await db.prepare("UPDATE user_profiles SET tfa_secret = '', tfa_enabled = 0, updated_at = ? WHERE site_uid = ?").bind(nowIso(), uid).run();
        break;
      }
      case "notify": {
        const target = String(body.target || "").slice(0, 40);
        const type = String(body.type || "info").slice(0, 24);
        const message = String(body.message || "").slice(0, 300);
        const track_id = String(body.track_id || "").slice(0, 80);
        const reply_id = body.reply_id != null ? Number(body.reply_id) : null;
        const actor = String(body.actor || "").slice(0, 24);
        if (target) await db.prepare(
          "INSERT INTO notifications (uid, type, message, track_id, reply_id, actor) VALUES (?, ?, ?, ?, ?, ?)"
        ).bind(target, type, message, track_id, reply_id, actor).run();
        break;
      }
      case "addSuggestion": {
        const text = String(body.text || "").trim().slice(0, 400);
        if (!text) return json({ error: "Please write a suggestion first" }, 400);
        const count = await db.prepare("SELECT COUNT(*) as n FROM suggestions WHERE uid = ? AND created_at >= datetime('now','-1 hour')").bind(uid).first();
        if (count && count.n >= 5) return json({ error: "You're suggesting a lot - take a breath and come back later" }, 400);
        await db.prepare("INSERT INTO suggestions (uid, text) VALUES (?, ?)").bind(uid, text).run();
        await recordActivity(db, uid, "community", "You submitted a suggestion", text.slice(0, 120), "");
        break;
      }
      case "deleteSuggestion": {
        const id = Number(body.id);
        if (!id) return json({ error: "missing id" }, 400);
        await db.prepare("DELETE FROM suggestions WHERE id = ? AND uid = ?").bind(id, uid).run();
        break;
      }
      case "changeEmail": {
        const session = await getSessionUser(db, context.request);
        if (!session || session.uid !== uid) return json({ error: "forbidden" }, 403);
        const newEmail = String(body.newEmail || "").trim().toLowerCase();
        const currentPassword = String(body.currentPassword || "");
        if (!emailOk(newEmail)) return json({ error: "Please enter a valid email address" }, 400);
        const clash = await db.prepare("SELECT uid FROM users WHERE email_lower = ? AND uid != ?").bind(newEmail, uid).first();
        if (clash) return json({ error: "That email is already in use" }, 400);
        const row = await db.prepare("SELECT password_hash FROM users WHERE uid = ?").bind(uid).first();
        if (!row) return json({ error: "Account not found" }, 404);
        if (row.password_hash && !(await verifyPassword(currentPassword, row.password_hash))) {
          return json({ error: "Current password is incorrect" }, 400);
        }
        await db.prepare("UPDATE users SET email = ?, email_lower = ?, verified = 0, updated_at = ? WHERE uid = ?").bind(newEmail, newEmail, nowIso(), uid).run();
        await recordActivity(db, uid, "security", "You changed your email address", "", "");
        break;
      }
      case "changePassword": {
        const session = await getSessionUser(db, context.request);
        if (!session || session.uid !== uid) return json({ error: "forbidden" }, 403);
        const currentPassword = String(body.currentPassword || "");
        const newPassword = String(body.newPassword || "");
        if (newPassword.length < 8) return json({ error: "Password must be at least 8 characters" }, 400);
        const row = await db.prepare("SELECT password_hash FROM users WHERE uid = ?").bind(uid).first();
        if (!row) return json({ error: "Account not found" }, 404);
        if (row.password_hash && !(await verifyPassword(currentPassword, row.password_hash))) {
          return json({ error: "Current password is incorrect" }, 400);
        }
        const hash = await hashPassword(newPassword);
        await db.prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE uid = ?").bind(hash, nowIso(), uid).run();
        await recordActivity(db, uid, "security", "You changed your password", "", "");
        break;
      }
      case "unlinkDiscord": {
        const session = await getSessionUser(db, context.request);
        if (!session || session.uid !== uid) return json({ error: "forbidden" }, 403);
        await db.prepare("DELETE FROM discord_links WHERE site_uid = ?").bind(uid).run();
        await db.prepare("UPDATE users SET discord_id = '', updated_at = ? WHERE uid = ?").bind(nowIso(), uid).run();
        await recordActivity(db, uid, "security", "You disconnected your Discord account", "", "");
        break;
      }
      case "unlinkGoogle": {
        const session = await getSessionUser(db, context.request);
        if (!session || session.uid !== uid) return json({ error: "forbidden" }, 403);
        await db.prepare("UPDATE users SET google_id = '', updated_at = ? WHERE uid = ?").bind(nowIso(), uid).run();
        await recordActivity(db, uid, "security", "You disconnected your Google account", "", "");
        break;
      }
      case "deleteAccount": {
        return json({ error: "Account deletion is handled manually. Join the server and fill out the delete-request form: /delete-request" }, 403);
      }
      default:
        return json({ error: "unknown action: " + body.action }, 400);
    }
    return json(await loadAccountState(context.env, db, uid, context.request));
  } catch (err) {
    return json({ error: String(err && err.message || err) }, 500);
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
