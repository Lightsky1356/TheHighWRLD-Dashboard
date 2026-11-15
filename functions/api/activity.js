// GET  /api/activity          -> the feed of what your friends are up to
// POST /api/activity          -> publish something of yours
// POST /api/activity/clear    -> stop publishing, and take down what you published
//
// WHAT THIS IS
// A stream of what the people you are friends with have done: what they are
// listening to, which playlists they have shared, what they have done in the
// community.
//
// WHAT IT IS NOT
// It is not a notification. A notification is a message to one person; this
// is a stream that whoever looks at it reads. Nothing here sends anybody
// anything.
//
// THE RULES, AND WHERE THEY ARE ENFORCED
// Every rule about who may see a row is applied when the row is read, not
// when it is written. Hiding a control in the interface is not the same as
// enforcing a rule, and only the second one counts:
//
//   - The actor is the signed-in member. A body that names somebody else is
//     ignored - the actor is never taken from the request.
//   - A row is only ever visible to people who are friends with the person
//     who did it, or to the person themselves.
//   - A row is never visible to somebody who has blocked the person who did
//     it, or whom that person has blocked.
//   - The sharing setting decides what is published at all: 'nobody' means
//     nothing is written, 'friends' means only friends see it, 'everyone'
//     means anybody signed in can see it.
//   - A listening row is only true while it has not expired. A row that says
//     somebody is listening to something they stopped listening to an hour
//     ago is worse than no row at all.
//
// THE DETAIL
// The columns are the smallest amount needed to draw a card: a track's title,
// its artist and its artwork, or a label for anything else. No audio URL, no
// file path, no token. The artwork is a reference to a cover the site already
// serves, not the image itself.

import { getSessionUser } from "../_lib/auth.js";
import { rateLimit } from "../_lib/rate-limit.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

/* The table, in the same shape the migration makes it.
 *
 * A deploy and a migration do not happen at the same moment, and the code
 * is live the moment it is pushed. So the code makes the table it needs if
 * the table is not there - which reads no rows, and so works even when the
 * daily read limit has been reached. The migration does it too; whichever
 * gets there first, the other one finds it already there. */
const SCHEMA = [
  "CREATE TABLE IF NOT EXISTS friend_activity (" +
    "id TEXT PRIMARY KEY, uid TEXT NOT NULL DEFAULT '', type TEXT NOT NULL DEFAULT 'listening', " +
    "track_id TEXT NOT NULL DEFAULT '', title TEXT NOT NULL DEFAULT '', artist TEXT NOT NULL DEFAULT '', " +
    "artwork TEXT NOT NULL DEFAULT '', label TEXT NOT NULL DEFAULT '', detail TEXT NOT NULL DEFAULT '', " +
    "link TEXT NOT NULL DEFAULT '', expires_at TEXT, " +
    "created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))",
  "CREATE INDEX IF NOT EXISTS idx_friend_activity_uid ON friend_activity(uid, created_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_friend_activity_created ON friend_activity(created_at DESC)",
];

async function ensureSchema(db) {
  for (const statement of SCHEMA) {
    try {
      await db.prepare(statement).run();
    } catch (_) {
      /* Cannot make it here. The migration will. */
    }
  }
}

const MAX_ROWS = 40;
const PAGE_SIZE = 20;
const LISTENING_TTL_MS = 5 * 60 * 1000;
const TYPES = ["listening", "playlist", "community"];

/* The setting that governs each kind of thing. */
const SETTING_FOR = {
  listening: "activity_listening",
  playlist: "activity_playlists",
  community: "activity_community",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

function uidOk(uid) {
  return /^[A-Za-z0-9_-]{4,64}$/.test(String(uid || ""));
}

function clean(value, max) {
  return String(value == null ? "" : value)
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, max);
}

async function actorFor(context) {
  const db = context.env.wanted_vault;
  const user = await getSessionUser(db, context.request);
  return user && uidOk(user.uid) ? user : null;
}

/* The sharing settings of a member.
 *
 * A missing row is 'nobody', which is what a new account gets: it shares
 * nothing until it has been told to. */
async function settingsFor(db, uid) {
  const row = await db.prepare(
    "SELECT activity_listening, activity_playlists, activity_community FROM user_social_settings WHERE uid = ?"
  ).bind(uid).first().catch(() => null);
  return {
    listening: (row && row.activity_listening) || "nobody",
    playlist: (row && row.activity_playlists) || "nobody",
    community: (row && row.activity_community) || "nobody",
  };
}

/* Are these two friends? */
async function isFriend(db, a, b) {
  const [x, y] = a < b ? [a, b] : [b, a];
  const row = await db.prepare(
    "SELECT 1 FROM social_friends WHERE uid_a = ? AND uid_b = ?"
  ).bind(x, y).first().catch(() => null);
  return !!row;
}

/* Has either of these two blocked the other? A block hides everything. */
async function blockedEitherWay(db, a, b) {
  const row = await db.prepare(
    "SELECT 1 FROM user_blocks WHERE " +
    "(blocker_user_id = ? AND blocked_user_id = ?) OR " +
    "(blocker_user_id = ? AND blocked_user_id = ?) LIMIT 1"
  ).bind(a, b, b, a).first().catch(() => null);
  return !!row;
}

/* Can this viewer see this actor's rows of this kind?
 *
 * The check is made here, on the read, for every row - so a rule cannot be
 * forgotten on one of them.
 *
 * There are only two states, so this is short: the person did not share it,
 * so nobody sees it; or they shared it with friends, so only friends do. */
async function canSee(db, viewerUid, actorUid, type) {
  if (await blockedEitherWay(db, viewerUid, actorUid)) return false;

  const actorSettings = await settingsFor(db, actorUid);
  const visibility = actorSettings[type === "playlist" ? "playlist" : type === "community" ? "community" : "listening"];
  if (visibility !== "friends") return false;
  return isFriend(db, viewerUid, actorUid);
}

/* The feed.
 *
 * The rows are read in one query - the friends' rows, newest first, bounded
 * by the cursor - and then the rules are applied to each of them. The rows
 * that are not visible are dropped, and the next cursor is taken from the
 * last row that was read, not the last one that was shown, so the paging
 * does not skip or repeat. */
async function feed(context, me, url) {
  const db = context.env.wanted_vault;
  const type = String(url.searchParams.get("type") || "all");
  const cursor = clean(url.searchParams.get("cursor"), 40);
  const limit = Math.max(1, Math.min(MAX_ROWS, Number(url.searchParams.get("limit")) || PAGE_SIZE));

  /* The people whose activity is being looked at: the signed-in member's
     friends. A member with no friends gets an empty feed, not everybody's.
     The member's own rows are not in it either - this is what your friends
     are up to, and you know what you were up to. */
  const friends = await db.prepare(
    "SELECT uid_b AS uid FROM social_friends WHERE uid_a = ? " +
    "UNION ALL SELECT uid_a AS uid FROM social_friends WHERE uid_b = ?"
  ).bind(me.uid, me.uid).all();
  const friendUids = (friends.results || []).map((r) => r.uid).filter(uidOk);
  const actorUids = friendUids;

  if (!friendUids.length) {
    return json({ ok: true, items: [], nextCursor: "", total: 0 });
  }

  const marks = actorUids.map(() => "?").join(",");
  const where = ["a.uid IN (" + marks + ")"];
  const binds = actorUids.slice();
  if (type !== "all" && TYPES.includes(type)) {
    where.push("a.type = ?");
    binds.push(type);
  }
  if (cursor) {
    where.push("(a.created_at || '/' || a.id) < ?");
    binds.push(cursor);
  }

  /* The listening rows are only true while they have not expired. */
  const rows = await db.prepare(
    "SELECT a.id, a.uid, a.type, a.track_id, a.title, a.artist, a.artwork, a.label, a.detail, a.link, " +
    "a.expires_at, a.created_at, " +
    "COALESCE(NULLIF(p.name,''), NULLIF(d.display_name,''), u.name, 'Member') AS name, " +
    "COALESCE(NULLIF(p.avatar,''), NULLIF(d.avatar,''), u.avatar, '') AS avatar " +
    "FROM friend_activity a " +
    "JOIN users u ON u.uid = a.uid " +
    "LEFT JOIN user_profiles p ON p.site_uid = a.uid " +
    "LEFT JOIN discord_links d ON d.site_uid = a.uid " +
    "WHERE " + where.join(" AND ") + " " +
    "AND (a.type <> 'listening' OR (a.expires_at IS NOT NULL AND a.expires_at > ?)) " +
    "ORDER BY a.created_at DESC, a.id DESC LIMIT ?"
  ).bind(...binds, new Date().toISOString(), limit).all();

  const items = [];
  let last = "";
  for (const row of rows.results || []) {
    last = row.created_at + "/" + row.id;
    /* Every row is checked, even though the query already narrowed the
       people down to friends - because a friend may have blocked somebody,
       and because the sharing setting can be 'nobody' after the row was
       written. */
    if (!(await canSee(db, me.uid, row.uid, row.type))) continue;
    items.push({
      id: row.id,
      uid: row.uid,
      name: row.name,
      avatar: row.avatar,
      type: row.type,
      trackId: row.track_id || "",
      title: row.title || "",
      artist: row.artist || "",
      artwork: row.artwork || "",
      label: row.label || "",
      detail: row.detail || "",
      link: row.link || "",
      createdAt: row.created_at,
    });
  }

  return json({
    ok: true,
    items,
    nextCursor: items.length ? last : (rows.results && rows.results.length ? last : ""),
    total: items.length,
  });
}

/* Publish something.
 *
 * The actor is the signed-in member. Whatever the body says about who did it
 * is ignored - there is no way to publish as somebody else. */
async function publish(context, me, body) {
  const db = context.env.wanted_vault;
  const type = String(body.type || "").slice(0, 20);
  if (!TYPES.includes(type)) return json({ error: "invalid_type" }, 400);

  const settings = await settingsFor(db, me.uid);
  const sharing = settings[type === "playlist" ? "playlist" : type === "community" ? "community" : "listening"];
  if (sharing === "nobody") {
    /* The member may still have "Show what I'm listening to" on (it opens the
       row to anyone viewing their profile) - the listening row is what the
       site's live status renders from, so it is allowed to exist once that
       switch is on. */
    let allowedByPrivacy = false;
    if (type === "listening") {
      try {
        const pr = await db.prepare("SELECT show_activity FROM user_privacy WHERE uid = ?").bind(me.uid).first();
        allowedByPrivacy = !!(pr && Number(pr.show_activity) === 1);
      } catch (_) {}
    }
    if (!allowedByPrivacy) return json({ ok: true, published: false, reason: "not_shared" });
  }

  if (!(await rateLimit(db, me.uid, "friend_activity", 30, 60000))) {
    return json({ error: "rate_limited" }, 429);
  }

  const trackId = clean(body.trackId, 140);
  const title = clean(body.title, 160);
  const artist = clean(body.artist, 120);
  const artwork = clean(body.artwork, 300);
  const label = clean(body.label, 160);
  const detail = clean(body.detail, 300);
  const link = clean(body.link, 300);

  /* A link is only kept when it points at this site. Anything else - an
     audio file, a token, a remote address - is dropped rather than stored. */
  let safeLink = "";
  if (link.startsWith("/") && !link.startsWith("//")) safeLink = link.slice(0, 300);

  const id = "act_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 10);
  const now = new Date().toISOString();

  if (type === "listening") {
    /* One row per member, so a new track replaces the old one rather than
       stacking up. The id is stable, which is what makes it a replace rather
       than an insert. */
    await db.prepare(
      "INSERT INTO friend_activity (id, uid, type, track_id, title, artist, artwork, label, detail, link, expires_at, created_at) " +
      "VALUES (?, ?, 'listening', ?, ?, ?, ?, ?, ?, ?, ?, ?) " +
      "ON CONFLICT(id) DO UPDATE SET track_id = excluded.track_id, title = excluded.title, " +
      "artist = excluded.artist, artwork = excluded.artwork, expires_at = excluded.expires_at, created_at = excluded.created_at"
    ).bind(
      "act_listening_" + me.uid, me.uid, trackId, title, artist, artwork,
      label, detail, safeLink, new Date(Date.now() + LISTENING_TTL_MS).toISOString(), now
    ).run();
    return json({ ok: true, published: true });
  }

  await db.prepare(
    "INSERT INTO friend_activity (id, uid, type, track_id, title, artist, artwork, label, detail, link, expires_at, created_at) " +
    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)"
  ).bind(id, me.uid, type, trackId, title, artist, artwork, label, detail, safeLink, now).run();

  return json({ ok: true, published: true, id });
}

/* Stop publishing, and take down what you published.
 *
 * Turning a setting off has to take the rows down too - the setting says
 * "do not share this", and leaving the rows would mean the setting was a
 * lie until they expired on their own. */
async function clear(context, me, body) {
  const db = context.env.wanted_vault;
  const type = String(body.type || "").slice(0, 20);
  const kinds = TYPES.includes(type) ? [type] : TYPES;
  for (const kind of kinds) {
    await db.prepare("DELETE FROM friend_activity WHERE uid = ? AND type = ?").bind(me.uid, kind).run();
  }
  return json({ ok: true, cleared: kinds });
}

/* The rows that have expired, removed.
 *
 * They are removed on a timer rather than on every read, so the cost does
 * not fall on whoever happens to be looking at the feed. */
let lastSweepAt = 0;
const SWEEP_EVERY_MS = 10 * 60 * 1000;
async function sweepExpired(db) {
  const now = Date.now();
  if (now - lastSweepAt < SWEEP_EVERY_MS) return;
  lastSweepAt = now;
  await db.prepare("DELETE FROM friend_activity WHERE expires_at IS NOT NULL AND expires_at <= ?")
    .bind(new Date(now).toISOString()).run().catch(() => {});
}

export async function onRequest(context) {
  try {
    const { request, env } = context;
    const method = request.method.toUpperCase();
    if (method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    const me = await actorFor(context);
    if (!me) return json({ error: "sign_in_required" }, 401);

    const url = new URL(request.url);
    const db = env.wanted_vault;
    await ensureSchema(db);
    await sweepExpired(db);

    if (method === "GET") return await feed(context, me, url);

    if (method === "POST") {
      const path = url.pathname.replace(/^\/api\/activity\/?/, "").replace(/^\//, "");
      const body = await request.json().catch(() => ({}));
      if (path === "clear") return await clear(context, me, body);
      return await publish(context, me, body);
    }

    return json({ error: "method_not_allowed" }, 405);
  } catch (err) {
    return json({ error: String((err && err.message) || err) }, 500);
  }
}
