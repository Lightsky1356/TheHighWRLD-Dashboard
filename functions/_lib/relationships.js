// Shared helpers for the user relationship API (functions/_lib is not routable).
// Identity is ALWAYS derived from the authenticated session cookie — client-
// supplied uid/discord ids are never trusted for authorization.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

// Any authenticated site account (email/Google/Discord) is a valid actor.
// Returns null when there is no session.
async function getActor(db, request) {
  const { getSessionUser } = await import("./auth.js");
  const session = await getSessionUser(db, request);
  if (session && session.uid && /^[A-Za-z0-9_-]{4,64}$/.test(session.uid)) return session.uid;
  return "";
}

// Resolve a target user from "u:<uid>", "d:<discordId>", raw site uid, or a
// profile display name. Returns { uid, discordId, name } or null.
async function resolveTarget(db, raw) {
  const id = String(raw || "").trim().slice(0, 80);
  if (!id) return null;
  let wantUid = "";
  let wantDiscord = "";
  if (id.startsWith("u:")) wantUid = id.slice(2);
  else if (id.startsWith("d:")) wantDiscord = id.slice(2);
  else if (/^[A-Za-z0-9_-]{4,64}$/.test(id)) wantUid = id;

  let row = null;
  if (wantUid) {
    row = await db.prepare(
      "SELECT site_uid, discord_id, display_name FROM discord_links WHERE site_uid = ?"
    ).bind(wantUid).first();
    if (!row && /^[A-Za-z0-9_-]{4,64}$/.test(wantUid)) {
      // Fall back to a profile display-name lookup (same behaviour as /api/profile).
      const byName = await db.prepare(
        "SELECT site_uid FROM user_profiles WHERE LOWER(name) = LOWER(?) LIMIT 1"
      ).bind(wantUid).first();
      if (byName && byName.site_uid) {
        row = await db.prepare(
          "SELECT site_uid, discord_id, display_name FROM discord_links WHERE site_uid = ?"
        ).bind(byName.site_uid).first();
      }
    }
  }
  if (!row && wantDiscord) {
    row = await db.prepare(
      "SELECT site_uid, discord_id, display_name FROM discord_links WHERE discord_id = ?"
    ).bind(wantDiscord).first();
  }
  if (!row) return null;
  return { uid: row.site_uid, discordId: row.discord_id || "", name: row.display_name || "" };
}

// Rolling-hour per (actor, action) rate limit. Returns true when allowed.
const LIMIT_ACTION_MAX = 10;

async function rateLimit(db, actorUid, action) {
  try {
    const hourAgo = new Date(Date.now() - 3600000).toISOString();
    const cnt = await db.prepare(
      "SELECT COUNT(*) AS n FROM user_action_log WHERE actor_uid = ? AND action = ? AND created_at >= ?"
    ).bind(actorUid, action, hourAgo).first();
    if (cnt && cnt.n >= LIMIT_ACTION_MAX) return false;
    await db.prepare(
      "INSERT INTO user_action_log (actor_uid, action) VALUES (?, ?)"
    ).bind(actorUid, action).run();
    // Opportunistic sweep of expired rows (bounded, indexed). Probabilistic so
    // the daily D1 row-read budget isn't burned on every single action.
    if (Math.random() < 0.05) {
      await db.prepare(
        "DELETE FROM user_action_log WHERE created_at < ?"
      ).bind(new Date(Date.now() - 86400000).toISOString()).run();
    }
    return true;
  } catch (e) {
    return true; // fail-open: the write that follows will surface D1 errors anyway
  }
}

export { CORS, json, getActor, resolveTarget, rateLimit, LIMIT_ACTION_MAX };