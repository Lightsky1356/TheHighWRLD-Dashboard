/* Everything a page needs, in one request.
 *
 * WHY THIS EXISTS
 * Opening the site asked for a dozen separate things: the announcements,
 * the trending tracks, the submission rules, the sign-in
 * configuration, the session, the account, the notifications, the recent
 * plays, the notification settings, the push state and the presence.
 *
 * Each of those is a request, and the free tier allows a hundred thousand
 * a day. A visitor who opened six pages was spending eighty-four requests
 * before doing anything at all - and the requests were made one after
 * another, each waiting for the last.
 *
 * So they are asked for together. One request carries the lot, and the
 * database is read once rather than once per thing.
 *
 * WHAT IS IN IT
 * The parts that are the same for everybody - the announcements,
 * the trending tracks, the submission rules, the sign-in configuration -
 * are answered from a copy that is remembered for a minute, so a hundred
 * visitors in a minute cost one read rather than a hundred.
 *
 * The parts that are about the visitor - the session, the account, the
 * notifications, the recent plays, the notification settings and the push
 * state - are read for them, and are keyed to them: a remembered answer is
 * never handed to somebody else.
 *
 * The page still asks for anything else it needs on its own; this is the
 * first call, not the only one.
 */
import { getSessionUser } from "../_lib/auth.js";
import { publicRuleSet } from "../_lib/submissionRules.js";

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

/* The part that is the same for everybody.
 *
 * It is remembered for a minute: the announcements and the
 * trending tracks change a few times a day, and a hundred visitors in a
 * minute should cost one read rather than a hundred. */
let shared = null;
let sharedAt = 0;
const SHARED_TTL_MS = 60000;

async function sharedParts(env) {
  const now = Date.now();
  if (shared && now - sharedAt < SHARED_TTL_MS) return shared;
  const db = env.wanted_vault;

  let announcements = [];
  try {
    const rows = await db.prepare(
      "SELECT id, title, message, created_at, rev FROM announcements ORDER BY id DESC LIMIT 5"
    ).all();
    /* The exact shape /api/announcements answers in (that endpoint maps them
       identically). The raw rows used to travel as-is, so every bootstrapped
       announcement reached the bell without a type, a seenKey or a ts: the row
       rendered untyped, clicking it fell through gotoNotif into the
       wanted-vault fallback ("Track not found in the vault"), and the badge /
       seen logic fell back to its own guesses. */
    announcements = (rows.results || []).map((r) => ({
      id: "a" + r.id,
      type: "announcement",
      actor: "Staff",
      message: (r.title ? r.title + " — " : "") + (r.message || ""),
      title: r.title || "",
      body: r.message || "",
      seenKey: "a" + r.id + "r" + (Number(r.rev) || 1),
      rev: Number(r.rev) || 1,
      post_id: null,
      reply_id: null,
      read: true,
      ts: r.created_at || "",
    }));
  } catch (_) {}

  /* The trending tracks, in the shape the trending endpoint answers in.
   *
   * It has to be the same shape, because the client reads the two the same
   * way whichever it got - and it was not. The bootstrap handed over a bare
   * list of rows and the client was looking for an object with an "ok" in
   * it, so it threw the whole section away. The trending strip was not
   * there, and nobody could say why. */
  let trending = [];
  let totalListens = 0;
  try {
    const rows = await db.prepare(
      /* The index is named outright - see the trending endpoint for why. */
      "SELECT track_id AS title, COUNT(*) AS plays, COUNT(DISTINCT uid) AS listeners, MAX(ts) AS last_play " +
      "FROM listens INDEXED BY idx_listens_ts_track " +
      "WHERE ts >= datetime('now', '-7 days') GROUP BY track_id ORDER BY plays DESC LIMIT 10"
    ).all();
    trending = (rows.results || []).map((r, i) => ({
      rank: i + 1,
      title: r.title || "",
      plays: r.plays || 0,
      listeners: r.listeners || 0,
      last_play: r.last_play || "",
    }));
  } catch (_) {}
  try {
    /* The number of plays, counted day by day. Asking the history meant
       counting every row of it, for one line of text - and asking the
       summaries for a member's own number would be the wrong question
       anyway, since this is everybody's plays. */
    const row = await db.prepare("SELECT COALESCE(SUM(plays),0) AS total FROM listens_day").first();
    totalListens = row ? row.total || 0 : 0;
  } catch (_) {
    /* The table is not there yet - the trending page has its own count. */
  }

  /* The same shapes the endpoints answer in, so the client reads them the
     same way whichever it got. */
  shared = {
    announcements,
    trending: { ok: true, days: 7, trending, total_listens: totalListens },
    totalListens,
  };
  sharedAt = now;
  return shared;
}

/* The part that is about the visitor.
 *
 * It is read for them every time, and never handed to anybody else. */
async function visitorParts(env, request) {
  const db = env.wanted_vault;
  const out = { user: null, account: null, notifications: [], recent: [], notificationSettings: null, push: null, privacy: null, activitySettings: null };

  let session = null;
  try { session = await getSessionUser(db, request); } catch (_) {}
  if (!session || !session.uid) return out;
  out.user = { uid: session.uid, email: session.email || "", name: session.name || "", avatar: session.avatar || "", provider: session.provider || "" };

  try {
    const rows = await db.prepare(
      "SELECT id, type, actor_uid, actor_name, message, post_id, reply_id, read, created_at " +
      "FROM community_notifications WHERE recipient_uid = ? ORDER BY id DESC LIMIT 40"
    ).bind(session.uid).all();
    /* The same shape the notifications endpoint answers in. */
    out.notifications = { ok: true, notifications: rows.results || [] };
  } catch (_) {}

  try {
    const rows = await db.prepare(
      "SELECT id, track_id AS title, seconds, ts FROM listens WHERE uid = ? ORDER BY id DESC LIMIT 200"
    ).bind(session.uid).all();
    /* The same shape the recent endpoint answers in. */
    out.recent = { ok: true, recent: rows.results || [] };
  } catch (_) {}

  try {
    /* The push state: the public key and the devices registered against
       this account. It is asked for when the settings are opened. */
    const devices = await db.prepare(
      "SELECT id, endpoint, user_agent, created_at, failure_count FROM push_subscriptions " +
      "WHERE uid = ? ORDER BY id DESC"
    ).bind(session.uid).all();
    out.push = {
      ok: true,
      publicKey: env.VAPID_PUBLIC_KEY || "",
      supported: typeof env.VAPID_PUBLIC_KEY === "string" && !!env.VAPID_PUBLIC_KEY,
      devices: (devices.results || []).map((d) => ({
        id: d.id,
        endpoint: d.endpoint,
        userAgent: d.user_agent,
        createdAt: d.created_at,
        failureCount: d.failure_count,
      })),
    };
  } catch (_) {}

  try {
    const row = await db.prepare(
      "SELECT * FROM user_notification_prefs WHERE uid = ?"
    ).bind(session.uid).first();
    /* The same shape the settings endpoint answers in, so the panel can
       read either without knowing where it came from. */
    out.notificationSettings = { ok: true, prefs: row || {} };
  } catch (_) {}

  try {
    const row = await db.prepare(
      "SELECT activity_listening, activity_playlists, activity_community " +
      "FROM user_social_settings WHERE uid = ?"
    ).bind(session.uid).first();
    /* Off unless the member says otherwise - which is what the servers
       default is, and what a missing row means. */
    out.activitySettings = {
      ok: true,
      settings: {
        activity_listening: (row && row.activity_listening) || "nobody",
        activity_playlists: (row && row.activity_playlists) || "nobody",
        activity_community: (row && row.activity_community) || "nobody",
      },
    };
  } catch (_) {}

  try {
    const row = await db.prepare(
      "SELECT show_playlists, show_stats, show_activity, show_favorites FROM user_privacy WHERE uid = ?"
    ).bind(session.uid).first();
    /* The same shape the privacy endpoint answers in, with the flags
       normalised to numbers the same way. */
    const flags = {};
    for (const k of ["show_playlists", "show_stats", "show_activity", "show_favorites"]) {
      flags[k] = row && row[k] != null ? Number(row[k]) : 1;
    }
    out.privacy = { ok: true, privacy: flags };
  } catch (_) {}

  return out;
}

export async function onRequestGet(context) {
  try {
    const env = context.env;
    const [sharedPartsResult, visitor] = await Promise.all([
      sharedParts(env),
      visitorParts(env, context.request),
    ]);

    return json({
      ok: true,
      // the same for everybody
      announcements: sharedPartsResult.announcements,
      trending: sharedPartsResult.trending,
      totalListens: sharedPartsResult.totalListens,
      submissionRules: publicRuleSet(),
      auth: {
        google: !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
        discord: !!(env.DISCORD_CLIENT_ID && env.DISCORD_CLIENT_SECRET),
        hcaptchaSiteKey: env.HCAPTCHA_SITE_KEY || "",
        hcaptchaConfigured: !!(env.HCAPTCHA_SITE_KEY && env.HCAPTCHA_SECRET),
      },
      // about the visitor
      user: visitor.user,
      notifications: visitor.notifications,
      recent: visitor.recent,
      notificationSettings: visitor.notificationSettings,
      activitySettings: visitor.activitySettings,
    });
  } catch (err) {
    return json({ error: String((err && err.message) || err) }, 500);
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
