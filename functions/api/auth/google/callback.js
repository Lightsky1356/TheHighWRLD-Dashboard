import { json, nowIso, newUid, getCookie, createSession, setSessionCookie } from "../../../_lib/auth.js";

function htmlRedirect(location, text) {
  return new Response(
    '<!DOCTYPE html><html><head><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=' + location + '"></head><body><p style="font-family:sans-serif;text-align:center;padding:40px;color:#333">' + text + '</p></body></html>',
    { headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}

export async function onRequestGet(context) {
  try {
    const url = new URL(context.request.url);
    const code = url.searchParams.get("code") || "";
    const state = url.searchParams.get("state") || "";
    const expected = getCookie(context.request, "oauth_state");
    if (!code) return json({ error: "missing code" }, 400);
    if (!state || !expected || state !== expected) return json({ error: "state mismatch or missing oauth state cookie" }, 400);

    const clientId = context.env.GOOGLE_CLIENT_ID || "";
    const clientSecret = context.env.GOOGLE_CLIENT_SECRET || "";
    if (!clientId || !clientSecret) return json({ error: "Google not configured" }, 503);
    const db = context.env.wanted_vault;
    if (!db) return json({ error: "Database binding missing: wanted_vault" }, 503);
    const redirectUri = "https://thehighwrlddashboard.pages.dev/api/auth/google/callback";

    const tokenResp = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code: code,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });
    const tokenData = await tokenResp.json();
    if (!tokenData.access_token) return json({ error: "Google token failed" }, 401);

    const infoResp = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: "Bearer " + tokenData.access_token },
    });
    const info = await infoResp.json();
    const googleId = String(info.id || "").slice(0, 64);
    const email = String(info.email || "").trim().toLowerCase().slice(0, 160);
    if (!googleId) return json({ error: "Google user info failed" }, 401);

    const name = String(info.name || email.split("@")[0] || "Google User").replace(/[^\p{L}\p{N} _.-]/gu, "").slice(0, 24) || "999 Member";
    const avatar = String(info.picture || "").slice(0, 500);

    let user = await db.prepare("SELECT uid, email_lower FROM users WHERE google_id = ?").bind(googleId).first();
    if (!user) {
      const byEmail = await db.prepare("SELECT uid, email_lower FROM users WHERE email_lower = ?").bind(email || "__none__").first();
      if (byEmail) {
        await db.prepare("UPDATE users SET google_id = ?, name = ?, avatar = ?, provider = 'google', updated_at = ? WHERE uid = ?").bind(googleId, name, avatar, nowIso(), byEmail.uid).run();
        user = { uid: byEmail.uid };
      } else {
        const uid = newUid();
        await db.prepare(
          "INSERT INTO users (uid, email, email_lower, name, avatar, google_id, provider, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'google', ?, ?)"
        ).bind(uid, email, email, name, avatar, googleId, nowIso(), nowIso()).run();
        await db.prepare(
          "INSERT INTO user_profiles (site_uid, name, created_at) VALUES (?, ?, ?) ON CONFLICT(site_uid) DO NOTHING"
        ).bind(uid, name, nowIso()).run();
        user = { uid };
      }
    }

    const token = await createSession(db, user.uid, context.request);
    return new Response(null, {
      status: 302,
      headers: {
        Location: "/?auth=ok",
        "Set-Cookie": setSessionCookie(token),
      },
    });
  } catch (err) {
    return htmlRedirect("/", "Google sign-in failed: " + String(err && err.message || err));
  }
}
