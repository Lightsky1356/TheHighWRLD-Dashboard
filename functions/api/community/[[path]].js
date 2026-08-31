/*
  Community REST API — Cloudflare Pages Function.
  Persistent data lives in D1 (`wanted_vault`). Live events (reply:created,
  reply:updated, reply:deleted, reaction:*, notification:*) are fanned out to
  connected WebSocket clients through the CommunityHub Durable Object.

  Auth: identity is derived from the authenticated session cookie via _lib/auth.js.
  Client-supplied uid/role is NEVER trusted for authorization.
*/

import { getSessionUser } from "../../_lib/auth.js";
import { hubBroadcast } from "../../_lib/realtime.js";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const MAX_BODY = 5000;
const MAX_TITLE = 140;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function pathParts(url) {
  return url.pathname.replace(/^\/api\/community\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
}

function idNum(raw) {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : 0;
}

function cleanText(s, max) {
  return String(s || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function cleanBody(s) {
  return String(s || "").trim().slice(0, MAX_BODY);
}

// Derive identity from the session cookie. Returns null when signed out.
async function requireSession(db, env, request) {
  try {
    const session = await getSessionUser(db, request);
    if (session && session.uid && /^[A-Za-z0-9_-]{4,64}$/.test(session.uid)) {
      const link = await db.prepare(
        "SELECT site_uid, display_name, avatar, discord_id FROM discord_links WHERE site_uid = ?"
      ).bind(session.uid).first();
      if (link && link.display_name) {
        return { uid: session.uid, name: link.display_name, avatar: link.avatar || "", discordId: link.discord_id || "" };
      }
    }
  } catch (_) {}
  return null;
}

function mapPost(p, replyCount) {
  return {
    id: p.id,
    title: p.title,
    body: p.body,
    author_uid: p.author_uid || "",
    user_name: p.user_name || "",
    avatar: p.avatar || "",
    discord_id: p.discord_id || "",
    pinned: !!p.pinned,
    reply_count: replyCount || 0,
    created_at: p.created_at,
    edited_at: p.edited_at || null,
  };
}

function mapReply(r) {
  return {
    id: r.id,
    post_id: r.post_id,
    author_uid: r.author_uid || "",
    user_name: r.user_name || "",
    avatar: r.avatar || "",
    discord_id: r.discord_id || "",
    body: r.body,
    parent_id: r.parent_id || null,
    reply_to: r.reply_to || "",
    created_at: r.created_at,
    edited_at: r.edited_at || null,
  };
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
    // ----- posts -----
    if (parts[0] === "posts" && parts.length === 1 && method === "GET") {
      return listPosts(db, url);
    }
    if (parts[0] === "posts" && parts.length === 1 && method === "POST") {
      return createPost(request, env, db);
    }
    if (parts[0] === "posts" && parts.length === 2 && method === "GET") {
      return getPost(db, parts[1]);
    }
    if (parts[0] === "posts" && parts[2] === "replies" && parts.length === 3 && method === "GET") {
      return listReplies(db, parts[1]);
    }
    if (parts[0] === "posts" && parts[2] === "replies" && parts.length === 3 && method === "POST") {
      return createReply(request, env, db, parts[1]);
    }

    // ----- replies (community) -----
    if (parts[0] === "replies" && parts.length === 2 && method === "PATCH") {
      return editReply(request, env, db, parts[1]);
    }
    if (parts[0] === "replies" && parts.length === 2 && method === "DELETE") {
      return deleteReply(request, env, db, parts[1]);
    }
    if (parts[0] === "replies" && parts[2] === "reactions" && parts.length === 3 && method === "POST") {
      return addReaction(request, env, db, parts[1]);
    }
    if (parts[0] === "replies" && parts[2] === "reactions" && parts.length === 3 && method === "DELETE") {
      return removeReaction(request, env, db, parts[1]);
    }

    // ----- reconciliation after reconnect / legacy wanted vault -----
    if (parts[0] === "updates" && method === "GET") {
      return getUpdates(db, url);
    }
    if (parts[0] === "typing") {
      return json({ ok: true, typing: [], note: "typing is realtime-only via /api/realtime" });
    }

    return json({ error: "not found" }, 404);
  } catch (err) {
    return json({ error: String(err && err.message ? err.message : err) }, 500);
  }
}

/* ----------------------------- posts ----------------------------- */

async function listPosts(db, url) {
  const only = url.searchParams.get("pinned");
  let q = `SELECT cp.*,
    (SELECT COUNT(*) FROM community_replies cr WHERE cr.post_id = cp.id) AS reply_count
    FROM community_posts cp`;
  const binds = [];
  if (only === "1") {
    q += ` WHERE cp.pinned = 1`;
  }
  q += ` ORDER BY cp.pinned DESC, cp.created_at DESC LIMIT 200`;
  const rows = await db.prepare(q).bind(...binds).all();
  return json({ ok: true, posts: (rows.results || []).map((p) => mapPost(p, p.reply_count)) });
}

async function getPost(db, idRaw) {
  const pid = idNum(idRaw);
  if (!pid) return json({ error: "malformed id" }, 400);
  const p = await db.prepare("SELECT * FROM community_posts WHERE id = ?").bind(pid).first();
  if (!p) return json({ error: "post not found" }, 404);
  const rc = await db.prepare("SELECT COUNT(*) AS c FROM community_replies WHERE post_id = ?").bind(pid).first();
  return json({ ok: true, post: mapPost(p, rc ? rc.c : 0) });
}

async function createPost(request, env, db) {
  const body = await request.json().catch(() => ({}));
  const auth = await requireSession(db, env, request);
  if (!auth) return json({ error: "not signed in" }, 401);

  const title = cleanText(body.title || body.topic, MAX_TITLE);
  const text = cleanBody(body.body || body.text);
  if (!title) return json({ error: "missing title" }, 400);

  const canPin = await isOwner(env, db, auth);
  const pinned = canPin ? (body.pinned ? 1 : 0) : 0;

  const ins = await db.prepare(
    "INSERT INTO community_posts (author_uid, user_name, avatar, discord_id, title, body, pinned) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).bind(auth.uid, auth.name, auth.avatar, auth.discordId, title, text, pinned).run();
  const pid = ins.meta && ins.meta.last_row_id ? Number(ins.meta.last_row_id) : 0;
  const row = await db.prepare("SELECT * FROM community_posts WHERE id = ?").bind(pid).first();
  const post = mapPost(row || {}, 0);
  await hubBroadcast(env, { type: "post:created", post });
  const event = { type: "post:created", post };
  return json({ ok: true, post, event, clientTempId: body.clientTempId || null });
}

/* ----------------------------- replies ----------------------------- */

async function listReplies(db, postIdRaw) {
  const pid = idNum(postIdRaw);
  if (!pid) return json({ error: "malformed id" }, 400);
  const rows = await db.prepare(
    `SELECT * FROM community_replies WHERE post_id = ? ORDER BY created_at ASC LIMIT 300`
  ).bind(pid).all();
  return json({ ok: true, replies: (rows.results || []).map(mapReply) });
}

async function createReply(request, env, db, postIdRaw) {
  const body = await request.json().catch(() => ({}));
  const auth = await requireSession(db, env, request);
  if (!auth) return json({ error: "not signed in" }, 401);

  const text = cleanBody(body.text || body.body);
  if (!text) return json({ error: "missing text" }, 400);

  const pid = idNum(postIdRaw);
  if (!pid) return json({ error: "malformed post id" }, 400);
  const post = await db.prepare("SELECT * FROM community_posts WHERE id = ?").bind(pid).first();
  if (!post) return json({ error: "post not found" }, 404);

  let parentId = null;
  let replyTo = "";
  let parentAuthorUid = null;
  let parentAuthorName = "";
  const parent = body.parent != null ? idNum(body.parent) : 0;
  if (parent) {
    const pr = await db.prepare("SELECT id, user_name, author_uid FROM community_replies WHERE id = ? AND post_id = ?").bind(parent, pid).first();
    if (pr) {
      parentId = pr.id;
      replyTo = String(pr.user_name).slice(0, 24);
      parentAuthorUid = pr.author_uid || null;
      parentAuthorName = pr.user_name || "";
    }
  }

  const ins = await db.prepare(
    "INSERT INTO community_replies (post_id, author_uid, user_name, avatar, discord_id, body, parent_id, reply_to) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).bind(pid, auth.uid, auth.name, auth.avatar, auth.discordId, text, parentId, replyTo).run();
  const rid = ins.meta && ins.meta.last_row_id ? Number(ins.meta.last_row_id) : 0;
  const row = await db.prepare("SELECT * FROM community_replies WHERE id = ?").bind(rid).first();
  const reply = mapReply(row || {});

  // Broadcast instantly to all connected clients (dedup via server id on client).
  const event = {
    type: "reply:created",
    reply,
    conversationId: "post-" + pid,
    postId: pid,
    clientTempId: body.clientTempId || null,
  };
  await hubBroadcast(env, event);

  // Notification to the post author (and parent author when replying).
  const notifyTargets = new Set();
  if (post.author_uid && post.author_uid !== auth.uid) notifyTargets.add(post.author_uid);
  if (parentAuthorUid && parentAuthorUid !== auth.uid) notifyTargets.add(parentAuthorUid);
  for (const targetUid of notifyTargets) {
    const msg = auth.name + " replied" + (replyTo ? " to " + parentAuthorName : "") + " on \"" + String(post.title).slice(0, 60) + "\"";
    const n = await db.prepare(
      "INSERT INTO community_notifications (recipient_uid, type, actor_uid, actor_name, message, post_id, reply_id) VALUES (?, 'reply', ?, ?, ?, ?, ?)"
    ).bind(targetUid, auth.uid, auth.name, msg, pid, rid).run();
    await hubBroadcast(env, {
      type: "notification:created",
      recipientUid: targetUid,
      notification: {
        id: n.meta && n.meta.last_row_id ? Number(n.meta.last_row_id) : 0,
        type: "reply",
        message: msg,
        post_id: pid,
        reply_id: rid,
        actor: auth.name,
      },
    });
  }

  return json({ ok: true, reply, replyId: rid, event, clientTempId: body.clientTempId || null });
}

async function loadOwnedReply(db, env, request, idRaw) {
  const rid = idNum(idRaw);
  if (!rid) return { error: json({ error: "malformed id" }, 400) };
  const auth = await requireSession(db, env, request);
  if (!auth) return { error: json({ error: "not signed in" }, 401) };
  const row = await db.prepare("SELECT * FROM community_replies WHERE id = ?").bind(rid).first();
  if (!row) return { error: json({ error: "reply not found" }, 404) };
  const isAuthor = row.author_uid && row.author_uid === auth.uid;
  const isDiscordOwner = row.discord_id && auth.discordId && row.discord_id === auth.discordId;
  const isOwnerUser = await isOwner(env, db, auth);
  if (!isAuthor && !isDiscordOwner && !isOwnerUser) return { error: json({ error: "not your reply" }, 403) };
  return { rid, row, auth };
}

async function editReply(request, env, db, idRaw) {
  const body = await request.json().catch(() => ({}));
  const text = cleanBody(body.text || body.body);
  if (!text) return json({ error: "missing text" }, 400);
  const owned = await loadOwnedReply(db, env, request, idRaw);
  if (owned.error) return owned.error;
  const now = new Date().toISOString();
  await db.prepare("UPDATE community_replies SET body = ?, edited_at = ? WHERE id = ?").bind(text, now, owned.rid).run();
  const event = { type: "reply:updated", replyId: owned.rid, text, edited_at: now, postId: owned.row.post_id, conversationId: "post-" + owned.row.post_id };
  await hubBroadcast(env, event);
  return json({ ok: true, event });
}

async function deleteReply(request, env, db, idRaw) {
  const owned = await loadOwnedReply(db, env, request, idRaw);
  if (owned.error) return owned.error;
  await db.prepare("UPDATE community_replies SET parent_id = NULL WHERE parent_id = ?").bind(owned.rid).run();
  await db.prepare("DELETE FROM community_reactions WHERE reply_id = ?").bind(owned.rid).run();
  await db.prepare("DELETE FROM community_notifications WHERE reply_id = ?").bind(owned.rid).run();
  await db.prepare("DELETE FROM community_replies WHERE id = ?").bind(owned.rid).run();
  const event = { type: "reply:deleted", replyId: owned.rid, postId: owned.row.post_id, conversationId: "post-" + owned.row.post_id };
  await hubBroadcast(env, event);
  return json({ ok: true, event });
}

/* ----------------------------- reactions ----------------------------- */

async function addReaction(request, env, db, idRaw) {
  const body = await request.json().catch(() => ({}));
  const auth = await requireSession(db, env, request);
  if (!auth) return json({ error: "not signed in" }, 401);
  const rid = idNum(idRaw);
  if (!rid) return json({ error: "malformed id" }, 400);
  const emoji = cleanText(body.emoji || "❤️", 16);
  try {
    await db.prepare(
      "INSERT OR IGNORE INTO community_reactions (reply_id, author_uid, user_name, emoji) VALUES (?, ?, ?, ?)"
    ).bind(rid, auth.uid, auth.name, emoji).run();
  } catch (_) {
    await db.prepare(
      "INSERT OR IGNORE INTO community_reactions (reply_id, author_uid, user_name, emoji) VALUES (?, ?, ?, ?)"
    ).bind(rid, auth.uid, auth.name, emoji).run();
  }
  const event = { type: "reaction:added", replyId: rid, emoji, userName: auth.name, userId: auth.uid, postId: body.postId || null };
  await hubBroadcast(env, event);
  return json({ ok: true, event });
}

async function removeReaction(request, env, db, idRaw) {
  const body = await request.json().catch(() => ({}));
  const auth = await requireSession(db, env, request);
  if (!auth) return json({ error: "not signed in" }, 401);
  const rid = idNum(idRaw);
  if (!rid) return json({ error: "malformed id" }, 400);
  const emoji = cleanText(body.emoji || "❤️", 16);
  await db.prepare("DELETE FROM community_reactions WHERE reply_id = ? AND author_uid = ? AND emoji = ?").bind(rid, auth.uid, emoji).run();
  const event = { type: "reaction:removed", replyId: rid, emoji, userName: auth.name, userId: auth.uid, postId: body.postId || null };
  await hubBroadcast(env, event);
  return json({ ok: true, event });
}

/* ----------------------------- updates / reconcile ----------------------------- */

async function getUpdates(db, url) {
  const since = url.searchParams.get("since") || new Date(Date.now() - 60000).toISOString();
  const postId = url.searchParams.get("post") ? idNum(url.searchParams.get("post")) : 0;

  const binds = [since];
  let q = `SELECT * FROM community_replies WHERE (created_at > ? OR (edited_at IS NOT NULL AND edited_at > ?))`;
  binds.push(since);
  if (postId) {
    q += ` AND post_id = ?`;
    binds.push(postId);
  }
  q += ` ORDER BY created_at ASC LIMIT 200`;
  const replies = await db.prepare(q).bind(...binds).all();
  return json({
    ok: true,
    replies: (replies.results || []).map(mapReply),
    typing: [],
    timestamp: new Date().toISOString(),
  });
}

/* ----------------------------- helpers ----------------------------- */

async function isOwner(env, db, auth) {
  const ownerDiscordId = (env && env.OWNER_DISCORD_ID) || "1016529053659967629";
  return !!(auth.discordId && auth.discordId === ownerDiscordId);
}
