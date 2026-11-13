/*
 * Song comments — Cloudflare Pages Function.
 *
 * A comment thread per song. A comment may answer another one, so a thread
 * reads as a thread. Every comment remembers the moment it was written at,
 * so "1:12 on Fenty" stays true even after the song is renamed.
 *
 * Auth: identity comes from the session cookie via _lib/auth.js. A client
 * that says who it is is believed about nothing.
 *
 * Reads are public. Writes need an account, a clean record and a rate
 * limit - the same rules the community board follows.
 */

import { getSessionUser } from "../../_lib/auth.js";
import { banRejection } from "../../_lib/bans.js";
import { moderateContent } from "../../_lib/automod.js";
import { rateLimit } from "../../_lib/rate-limit.js";
import { awardXp } from "../../_lib/xp.js";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const MAX_BODY = 2000;
const MAX_TRACK = 160;
/* Six comments a minute is enough to talk and not enough to drown. */
const RATE_MAX = 6;
const RATE_WINDOW_MS = 60 * 1000;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function pathParts(url) {
  return url.pathname.replace(/^\/api\/song-comments\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
}

function cleanText(s, max) {
  return String(s || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function cleanBody(s) {
  return String(s || "").trim().slice(0, MAX_BODY);
}

function idNum(raw) {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : 0;
}

/* The name the song is known by. Every part of the site agrees on the
   title, so that is what a thread hangs off. */
function trackKey(s) {
  return cleanText(s, MAX_TRACK);
}

/* The person writing, as the site knows them: their profile name if they
   set one, their Discord name if they linked one, and their account name
   otherwise. */
async function profile(db, uid) {
  return db.prepare(
    "SELECT u.uid, COALESCE(NULLIF(p.name,''), NULLIF(d.display_name,''), u.name, 'Member') AS name, " +
    "COALESCE(NULLIF(p.avatar,''), NULLIF(d.avatar,''), u.avatar, '') AS avatar " +
    "FROM users u LEFT JOIN user_profiles p ON p.site_uid = u.uid " +
    "LEFT JOIN discord_links d ON d.site_uid = u.uid WHERE u.uid = ?"
  ).bind(uid).first();
}

async function requireSession(db, request) {
  try {
    const session = await getSessionUser(db, request);
    if (session && session.uid && /^[A-Za-z0-9_-]{4,64}$/.test(session.uid)) {
      return { uid: session.uid };
    }
  } catch (_) {}
  return null;
}

/* The comments of one song, oldest first, with the replies folded under
   the comment they answer. The heart count comes with each one. */
async function listComments(db, track) {
  const rows = await db.prepare(
    "SELECT c.id, c.track_title, c.parent_id, c.author_uid, c.author_name, c.author_avatar, " +
    "c.body, c.at_seconds, c.at_label, c.created_at, c.edited_at, c.deleted_at, " +
    "(SELECT COUNT(*) FROM song_comment_likes l WHERE l.comment_id = c.id) AS likes " +
    "FROM song_comments c WHERE c.track_title = ? " +
    "ORDER BY c.created_at ASC, c.id ASC LIMIT 500"
  ).bind(track).all();

  const all = (rows.results || rows || []).map((r) => ({
    id: r.id,
    track: r.track_title,
    parentId: r.parent_id || 0,
    authorUid: r.author_uid,
    authorName: r.author_name,
    authorAvatar: r.author_avatar,
    body: r.deleted_at ? "" : r.body,
    deleted: !!r.deleted_at,
    atSeconds: Number(r.at_seconds) || 0,
    atLabel: r.at_label || "",
    createdAt: r.created_at,
    editedAt: r.edited_at || "",
    likes: Number(r.likes) || 0,
  }));

  const top = all.filter((c) => !c.parentId);
  const replies = all.filter((c) => c.parentId);
  top.forEach((c) => { c.replies = []; });
  const byId = new Map(top.map((c) => [c.id, c]));
  replies.forEach((c) => {
    const parent = byId.get(c.parentId);
    /* A reply whose parent was deleted away (or was itself a reply) is
       shown on its own rather than lost. */
    if (parent) parent.replies.push(c);
    else top.push(Object.assign(c, { replies: [] }));
  });

  return { track, comments: top };
}

/* Whether this person already hearted this comment. */
async function likedBy(db, uid, ids) {
  if (!uid || !ids.length) return {};
  const marks = ids.map(() => "?").join(",");
  const rows = await db.prepare(
    "SELECT comment_id FROM song_comment_likes WHERE uid = ? AND comment_id IN (" + marks + ")"
  ).bind(uid, ...ids).all();
  const set = new Set((rows.results || []).map((r) => r.comment_id));
  const out = {};
  ids.forEach((id) => { out[id] = set.has(id); });
  return out;
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function onRequest(context) {
  const { request, env } = context;
  const db = env.wanted_vault;
  const url = new URL(request.url);
  const parts = pathParts(url);
  const method = request.method;

  try {
    /* ----- reads ----- */
    if (parts.length === 0 && method === "GET") {
      const track = trackKey(url.searchParams.get("track") || "");
      if (!track) return json({ error: "no_track" }, 400);
      const data = await listComments(db, track);
      const who = await requireSession(db, request);
      const marks = await likedBy(db, who && who.uid, data.comments.map((c) => c.id));
      data.comments.forEach((c) => {
        c.likedByMe = !!marks[c.id];
        (c.replies || []).forEach((r) => { r.likedByMe = !!marks[r.id]; });
      });
      const count = data.comments.reduce((n, c) => n + 1 + (c.replies || []).length, 0);
      return json({ ok: true, track: data.track, comments: data.comments, count });
    }

    /* ----- writes need an account ----- */
    /* The writer is worked out once, here, and the handlers below use it -
       so "who" has to live outside the block that checks it. */
    let who = null;
    if (method !== "GET") {
      who = await requireSession(db, request);
      if (!who) return json({ error: "sign_in_required" }, 401);
      const rej = await banRejection(db, who.uid);
      if (rej) return rej.response;
    }

    /* ----- a new comment, or a reply ----- */
    if (parts.length === 0 && method === "POST") {
      const body = await request.json().catch(() => ({}));
      const track = trackKey(body.track);
      if (!track) return json({ error: "no_track" }, 400);
      const text = cleanBody(body.body);
      if (!text) return json({ error: "empty_comment" }, 400);

      const parentId = idNum(body.parentId);
      if (parentId) {
        const parent = await db.prepare(
          "SELECT id, track_title, deleted_at FROM song_comments WHERE id = ?"
        ).bind(parentId).first();
        if (!parent) return json({ error: "no_such_comment" }, 404);
        if (parent.deleted_at) return json({ error: "comment_deleted" }, 409);
      }

      const allowed = await rateLimit(db, who.uid, "song_comment", RATE_MAX, RATE_WINDOW_MS);
      if (!allowed) return json({ error: "too_many_comments", message: "Slow down a moment." }, 429);

      const me = await profile(db, who.uid);
      const name = (me && me.name) || "Member";
      const avatar = (me && me.avatar) || "";

      /* The moment of the song the comment was written at. The client
         sends the seconds; the label is drawn from the song itself. */
      const atSeconds = Math.max(0, Math.min(24 * 60 * 60, Math.round(Number(body.atSeconds) || 0)));
      const atLabel = cleanText(body.atLabel || "", 120);

      const ins = await db.prepare(
        "INSERT INTO song_comments (track_title, parent_id, author_uid, author_name, author_avatar, body, at_seconds, at_label) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      ).bind(track, parentId || null, who.uid, name, avatar, text, atSeconds, atLabel).run();
      const id = ins && ins.meta && ins.meta.last_row_id ? Number(ins.meta.last_row_id) : 0;
      try { await awardXp(db, who.uid, parentId ? 10 : 15); } catch (_) {}

      /* The rules engine sees the text, so a comment is held the same way a
         post is. It never blocks: a held comment is flagged for a person. */
      let recent = 0;
      try {
        const r = await db.prepare(
          "SELECT COUNT(*) AS n FROM song_comments WHERE author_uid = ? AND created_at >= datetime('now','-10 minutes')"
        ).bind(who.uid).first();
        recent = r ? Number(r.n) : 0;
      } catch (_) {}
      await moderateContent(db, env, {
        targetType: "song_comment",
        targetId: String(id),
        uid: who.uid,
        text,
        author: name,
        recentCount: recent,
      });

      return json({
        ok: true,
        comment: {
          id,
          track,
          parentId: parentId || 0,
          authorUid: who.uid,
          authorName: name,
          authorAvatar: avatar,
          body: text,
          deleted: false,
          atSeconds,
          atLabel,
          createdAt: new Date().toISOString(),
          editedAt: "",
          likes: 0,
          likedByMe: false,
          replies: [],
        },
      }, 201);
    }

    /* ----- the heart under a comment ----- */
    if (parts[0] === "likes" && parts.length === 1 && method === "POST") {
      const body = await request.json().catch(() => ({}));
      const id = idNum(body.id);
      if (!id) return json({ error: "no_such_comment" }, 404);
      const exists = await db.prepare("SELECT id FROM song_comments WHERE id = ?").bind(id).first();
      if (!exists) return json({ error: "no_such_comment" }, 404);

      const had = await db.prepare(
        "SELECT 1 AS x FROM song_comment_likes WHERE comment_id = ? AND uid = ?"
      ).bind(id, who.uid).first();
      if (had) {
        await db.prepare("DELETE FROM song_comment_likes WHERE comment_id = ? AND uid = ?").bind(id, who.uid).run();
      } else {
        await db.prepare("INSERT OR IGNORE INTO song_comment_likes (comment_id, uid) VALUES (?, ?)").bind(id, who.uid).run();
        try {
          const author = await db.prepare("SELECT author_uid FROM song_comments WHERE id = ?").bind(id).first();
          if (author && author.author_uid && author.author_uid !== who.uid) await awardXp(db, author.author_uid, 2);
        } catch (_) {}
      }
      const count = await db.prepare(
        "SELECT COUNT(*) AS n FROM song_comment_likes WHERE comment_id = ?"
      ).bind(id).first();
      return json({ ok: true, id, liked: !had, likes: count ? Number(count.n) : 0 });
    }

    /* ----- taking a comment back ----- */
    if (parts.length === 1 && method === "DELETE") {
      const id = idNum(parts[0]);
      if (!id) return json({ error: "no_such_comment" }, 404);
      const row = await db.prepare(
        "SELECT id, author_uid FROM song_comments WHERE id = ?"
      ).bind(id).first();
      if (!row) return json({ error: "no_such_comment" }, 404);
      if (row.author_uid !== who.uid) return json({ error: "not_yours" }, 403);
      /* A deleted comment keeps its place in the thread - it says the
         comment was taken back rather than pretending it never happened. */
      await db.prepare(
        "UPDATE song_comments SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), body = '' WHERE id = ?"
      ).bind(id).run();
      return json({ ok: true, id, deleted: true });
    }

    return json({ error: "not found" }, 404);
  } catch (err) {
    return json({ error: String(err && err.message ? err.message : err) }, 500);
  }
}
