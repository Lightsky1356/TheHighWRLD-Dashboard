import { json, nowIso, newUid, getCookie, createSession, setSessionCookie } from "../../_lib/auth.js";

function discordAvatar(me) {
  if (!me || !me.id) return "";
  if (me.avatar) return "https://cdn.discordapp.com/avatars/" + me.id + "/" + me.avatar + ".png";
  try {
    const n = Number(BigInt(me.id) % 6n);
    return "https://cdn.discordapp.com/embed/avatars/" + n + ".png";
  } catch (e) {
    return "";
  }
}

async function mergeAccountData(db, fromUid, toUid) {
  if (!fromUid || !toUid || fromUid === toUid) return;
  await db.prepare(
    "INSERT OR IGNORE INTO votes (track_id, user_id) SELECT track_id, ? FROM votes WHERE user_id = ?"
  ).bind(toUid, fromUid).run();
  await db.prepare("DELETE FROM votes WHERE user_id = ?").bind(fromUid).run();
  await db.prepare(
    "INSERT OR IGNORE INTO favorites (uid, title, created_at) SELECT ?, title, created_at FROM favorites WHERE uid = ?"
  ).bind(toUid, fromUid).run();
  await db.prepare("DELETE FROM favorites WHERE uid = ?").bind(fromUid).run();
  await db.prepare(
    "INSERT OR IGNORE INTO reply_votes (site_uid, reply_id, value) SELECT ?, reply_id, value FROM reply_votes WHERE site_uid = ?"
  ).bind(toUid, fromUid).run();
  await db.prepare("DELETE FROM reply_votes WHERE site_uid = ?").bind(fromUid).run();
  await db.prepare("UPDATE listens SET uid = ? WHERE uid = ?").bind(toUid, fromUid).run();
  await db.prepare("UPDATE playlists SET uid = ? WHERE uid = ?").bind(toUid, fromUid).run();
  await db.prepare("UPDATE profile_links SET uid = ? WHERE uid = ?").bind(toUid, fromUid).run();
  await db.prepare("UPDATE activity SET uid = ? WHERE uid = ?").bind(toUid, fromUid).run();
  await db.prepare("UPDATE notifications SET uid = ? WHERE uid = ?").bind(toUid, fromUid).run();
  await db.prepare("UPDATE bookmarks SET uid = ? WHERE uid = ?").bind(toUid, fromUid).run();
  await db.prepare("UPDATE downloads SET uid = ? WHERE uid = ?").bind(toUid, fromUid).run();
}

async function adoptStrayDiscordData(db, discordId, toUid) {
  const stray = await db.prepare(
    "SELECT site_uid FROM discord_links WHERE discord_id = ? AND site_uid != ?"
  ).bind(discordId, toUid).all();
  for (const row of stray.results) {
    try { await mergeAccountData(db, row.site_uid, toUid); } catch (e) {}
  }
}

export async function onRequestGet(context) {
  try {
    const url = new URL(context.request.url);
    const code = url.searchParams.get("code") || "";
    const stateParts = (url.searchParams.get("state") || "").split(":");
    const clientId = context.env.DISCORD_CLIENT_ID || "";
    const clientSecret = context.env.DISCORD_CLIENT_SECRET || "";
    if (!clientId || !clientSecret) return json({ error: "Discord not configured" }, 503);
    const db = context.env.wanted_vault;
    if (!db) return json({ error: "Database binding missing: wanted_vault" }, 503);
    if (!code) return json({ error: "missing code" }, 400);

    const redirectUri = "https://thehighwrlddashboard.pages.dev/api/discord/callback";
    const tokenResp = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "authorization_code",
        code: code,
        redirect_uri: redirectUri,
      }),
    });
    const tokenData = await tokenResp.json();
    if (!tokenData.access_token) return json({ error: "token failed" }, 401);

    const meResp = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: "Bearer " + tokenData.access_token },
    });
    const me = await meResp.json();
    const discordId = String(me.id || "").slice(0, 40);
    if (!discordId) return json({ error: "discord id missing" }, 401);

    const displayName = String(me.global_name || me.username || "Discord User").slice(0, 24);
    const handle = String(me.username || me.global_name || "discord_user").trim().replace(/^@/, "").toLowerCase().slice(0, 24) || "discord_user";
    const avatar = discordAvatar(me);
    const bio = String(me.bio || "").slice(0, 300);
    const email = String(me.email || "").trim().toLowerCase().slice(0, 160);

    /* ---- Login mode: create session + user ---- */
    if (stateParts[0] === "login") {
      const expected = getCookie(context.request, "oauth_state");
      if (!stateParts[1] || !expected || stateParts[1] !== expected) {
        return json({ error: "state mismatch or missing oauth state cookie" }, 400);
      }
      let user = await db.prepare("SELECT uid, email_lower FROM users WHERE discord_id = ?").bind(discordId).first();
      if (!user) {
        const byEmail = email ? await db.prepare("SELECT uid, email_lower FROM users WHERE email_lower = ?").bind(email).first() : null;
        if (byEmail) {
          await db.prepare("UPDATE users SET discord_id = ?, name = ?, avatar = ?, provider = 'discord', updated_at = ? WHERE uid = ?").bind(discordId, handle, avatar, nowIso(), byEmail.uid).run();
          await db.prepare("INSERT INTO user_profiles (site_uid, name) VALUES (?, ?) ON CONFLICT(site_uid) DO UPDATE SET name = excluded.name, updated_at = ?").bind(byEmail.uid, displayName, nowIso()).run();
          user = { uid: byEmail.uid };
        } else {
          const uid = newUid();
          await db.prepare(
            "INSERT INTO users (uid, email, email_lower, name, avatar, discord_id, provider, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'discord', ?, ?)"
          ).bind(uid, email, email, handle, avatar, discordId, nowIso(), nowIso()).run();
          await db.prepare(
            "INSERT INTO user_profiles (site_uid, name, created_at) VALUES (?, ?, ?) ON CONFLICT(site_uid) DO NOTHING"
          ).bind(uid, displayName, nowIso()).run();
          user = { uid };
        }
      }

      await db.prepare(
        "INSERT INTO discord_links (site_uid, discord_id, display_name, avatar, bio, linked_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(site_uid) DO UPDATE SET discord_id = excluded.discord_id, display_name = excluded.display_name, avatar = excluded.avatar, bio = excluded.bio, linked_at = excluded.linked_at"
      ).bind(user.uid, discordId, displayName, avatar, bio, nowIso()).run();
      await adoptStrayDiscordData(db, discordId, user.uid);
      await db.prepare("DELETE FROM discord_links WHERE discord_id = ? AND site_uid != ?").bind(discordId, user.uid).run();

      const token = await createSession(db, user.uid, context.request);
      return new Response(null, {
        status: 302,
        headers: {
          Location: "/?auth=ok",
          "Set-Cookie": setSessionCookie(token),
        },
      });
    }

    /* ---- Link mode (existing): attach to anonymous uid ---- */
    const uid = (stateParts[0] || "").slice(0, 40);
    if (uid) {
      await context.env.wanted_vault.prepare(
        "INSERT INTO discord_links (site_uid, discord_id, display_name, avatar, bio, linked_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(site_uid) DO UPDATE SET discord_id = excluded.discord_id, display_name = excluded.display_name, avatar = excluded.avatar, bio = excluded.bio, linked_at = excluded.linked_at"
      ).bind(uid, discordId, displayName, avatar, bio, new Date().toISOString()).run();
      await context.env.wanted_vault.prepare("UPDATE users SET name = ?, avatar = ?, updated_at = ? WHERE uid = ?").bind(handle, avatar, new Date().toISOString(), uid).run();
      await context.env.wanted_vault.prepare(
        "INSERT INTO user_profiles (site_uid, name, bio, avatar) VALUES (?, ?, ?, ?) ON CONFLICT(site_uid) DO UPDATE SET name = excluded.name, bio = CASE WHEN excluded.bio != '' THEN excluded.bio ELSE user_profiles.bio END, avatar = excluded.avatar, updated_at = ?"
      ).bind(uid, displayName, bio, avatar, new Date().toISOString()).run();
      await adoptStrayDiscordData(context.env.wanted_vault, discordId, uid);
      await context.env.wanted_vault.prepare("DELETE FROM discord_links WHERE discord_id = ? AND site_uid != ?").bind(discordId, uid).run();
    }

    const mode = stateParts[1] === "popup" ? "popup" : "";
    if (mode === "popup") {
      return new Response(
        '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Connected</title></head><body><script>try{if(window.opener){window.opener.postMessage({type:"discord-linked"},"*")}}catch(e){}window.close();document.body.innerHTML=\'<p style="font-family:sans-serif;text-align:center;padding:40px;color:#333">Connected! You can close this tab.</p>\';<\/script></body></html>',
        { headers: { "Content-Type": "text/html; charset=utf-8" } }
      );
    }

    return Response.redirect("https://thehighwrlddashboard.pages.dev/", 302);
  } catch (err) {
    return json({ error: String(err && err.message || err) }, 500);
  }
}
