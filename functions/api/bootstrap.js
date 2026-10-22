/* Everything a page needs, in one request.
 *
 * WHY THIS EXISTS
 * Opening the site asked for a dozen separate things: the announcements,
 * the drops, the trending tracks, the submission rules, the sign-in
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
 * The parts that are the same for everybody - the announcements, the drops,
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
 * It is remembered for a minute: the announcements, the drops and the
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
    announcements = rows.results || [];
  } catch (_) {}

  /* The drops, in the shape the client reads them in: the ones that
     are live now, the ones coming up, and the ones that have been. */
  let drops = { live: [], upcoming: [], past: [] };
  try {
    const rows = await db.prepare("SELECT * FROM drops ORDER BY starts_at DESC LIMIT 25").all();
    const now = Date.now();
    const live = [], upcoming = [], past = [];
    for (const d of rows.results || []) {
      const start = Date.parse(d.starts_at || "");
      const end = Date.parse(d.ends_at || "");
      if (Number.isFinite(start) && Number.isFinite(end)) {
        if (now >= start && now < end) live.push(d);
        else if (now < start) upcoming.push(d);
        else past.push(d);
      } else {
        upcoming.push(d);
      }
    }
    drops = { live, upcoming, past };
  } catch (_) {}

  let trending = [];
  let totalListens = 0;
  try {
    const rows = await db.prepare(
      /* The index is named outright - see the trending endpoint for why. */
      "SELECT track_id AS title, COUNT(*) AS plays FROM listens INDEXED BY idx_listens_ts_track " +
      "WHERE ts >= datetime('now', '-7 days') GROUP BY track_id ORDER BY plays DESC LIMIT 10"
    ).all();
    trending = rows.results || [];
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

  shared = { announcements, drops, trending, totalListens };
  sharedAt = now;
  return shared;
}

/* The part that is about the visitor.
 *
 * It is read for them every time, and never handed to anybody else. */
async function visitorParts(env, request) {
  const db = env.wanted_vault;
  const out = { user: null, account: null, notifications: [], recent: [], notificationSettings: null, push: null };

  let session = null;
  try { session = await getSessionUser(db, request); } catch (_) {}
  if (!session || !session.uid) return out;
  out.user = { uid: session.uid, email: session.email || "", name: session.name || "", avatar: session.avatar || "", provider: session.provider || "" };

  try {
    const rows = await db.prepare(
      "SELECT id, type, actor_uid, actor_name, message, post_id, reply_id, read, created_at " +
      "FROM community_notifications WHERE recipient_uid = ? ORDER BY id DESC LIMIT 40"
    ).bind(session.uid).all();
    out.notifications = rows.results || [];
  } catch (_) {}

  try {
    const rows = await db.prepare(
      "SELECT id, track_id, seconds, ts FROM listens WHERE uid = ? ORDER BY id DESC LIMIT 200"
    ).bind(session.uid).all();
    out.recent = rows.results || [];
  } catch (_) {}

  try {
    const row = await db.prepare(
      "SELECT * FROM user_notification_prefs WHERE uid = ?"
    ).bind(session.uid).first();
    out.notificationSettings = row || null;
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
      drops: sharedPartsResult.drops,
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
    });
  } catch (err) {
    return json({ error: String((err && err.message) || err) }, 500);
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
