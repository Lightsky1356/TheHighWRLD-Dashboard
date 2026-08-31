import { hubBroadcast, resolveSiteUid } from "../_lib/realtime.js";

const OWNER_DISCORD_ID_DEFAULT = "1016529053659967629";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

async function loadState(env, user) {
  const tracks = await env.wanted_vault.prepare("SELECT title, note FROM tracks").all();
  const votes = await env.wanted_vault.prepare(
    "SELECT track_id, COUNT(*) as n FROM votes GROUP BY track_id"
  ).all();
  const replies = await env.wanted_vault.prepare(
    "SELECT id, track_id, user_name, avatar, discord_id, body, created_at, edited_at, parent_id, reply_to FROM replies ORDER BY created_at ASC"
  ).all();

  const voteMap = {};
  for (const v of votes.results) voteMap[v.track_id] = v.n;

  const rv = await env.wanted_vault.prepare(
    "SELECT reply_id, SUM(value) as s FROM reply_votes GROUP BY reply_id"
  ).all();
  const rvMap = {};
  for (const v of rv.results) rvMap[v.reply_id] = v.s;

  const replyMap = {};
  for (const r of replies.results) {
    if (!replyMap[r.track_id]) replyMap[r.track_id] = [];
    replyMap[r.track_id].push({
      id: r.id,
      u: r.user_name,
      a: r.avatar || "",
      d: r.discord_id || "",
      r: r.body,
      t: r.created_at,
      e: r.edited_at || null,
      p: r.parent_id || null,
      at: r.reply_to || "",
      v: rvMap[r.id] || 0,
    });
  }

  const state = {
    tracks: tracks.results.map((t) => ({ t: t.title, n: t.note })),
    votes: voteMap,
    replies: replyMap,
  };

  if (user) {
    const my = await env.wanted_vault.prepare(
      "SELECT track_id FROM votes WHERE user_id = ?"
    ).bind(user).all();
    const myMap = {};
    for (const v of my.results) myMap[v.track_id] = true;
    state.myVotes = myMap;

    const myrv = await env.wanted_vault.prepare(
      "SELECT reply_id, value FROM reply_votes WHERE site_uid = ?"
    ).bind(user).all();
    const myrvMap = {};
    for (const v of myrv.results) myrvMap[v.reply_id] = v.value;
    state.myReplyVotes = myrvMap;

    const link = await env.wanted_vault.prepare(
      "SELECT display_name, avatar, discord_id FROM discord_links WHERE site_uid = ?"
    ).bind(user).first();
    if (link && link.display_name) {
      state.me = {
        discord: link.display_name,
        avatar: link.avatar || "",
        id: link.discord_id || "",
      };
    }
    const ownerDiscordId = env.OWNER_DISCORD_ID || OWNER_DISCORD_ID_DEFAULT;
    state.owner = !!(link && link.discord_id && link.discord_id === ownerDiscordId);
  }

  return state;
}

export async function onRequestGet(context) {
  try {
    const url = new URL(context.request.url);
    const user = url.searchParams.get("user") || "";
    return json(await loadState(context.env, user));
  } catch (err) {
    return json({ error: String(err && err.message || err) }, 500);
  }
}

function frontendReply(row, voteTotal) {
  return {
    id: row.id,
    u: row.user_name,
    a: row.avatar || "",
    d: row.discord_id || "",
    r: row.body,
    t: row.created_at,
    e: row.edited_at || null,
    p: row.parent_id || null,
    at: row.reply_to || "",
    v: voteTotal || 0,
    track_id: row.track_id,
  };
}

export async function onRequestPost(context) {
  const body = await context.request.json().catch(() => null);
  if (!body || !body.action) return json({ error: "missing action" }, 400);
  const env = context.env;
  const db = env.wanted_vault;
  const request = context.request;
  let liveEvent = null;
  let createdReply = null;
  try {
    const uid = await resolveSiteUid(db, request, body.user);
    if (body.user && uid) body.user = uid;
    switch (body.action) {
      case "vote": {
        const { track, user } = body;
        if (!track || !user) return json({ error: "missing track or user" }, 400);
        const link = await db.prepare(
          "SELECT 1 FROM discord_links WHERE site_uid = ?"
        ).bind(user).first();
        if (!link) return json({ error: "Link Discord to vote" }, 403);
        const existing = await db.prepare(
          "SELECT id FROM votes WHERE track_id = ? AND user_id = ?"
        ).bind(track, user).first();
        if (existing) {
          await db.prepare("DELETE FROM votes WHERE id = ?").bind(existing.id).run();
        } else {
          await db.prepare("INSERT INTO votes (track_id, user_id) VALUES (?, ?)").bind(track, user).run();
          try {
            await db.prepare(
              "INSERT INTO activity (uid, type, label, detail, track_id) VALUES (?, 'vote', ?, '', ?)"
            ).bind(user, "You voted for " + String(track).slice(0, 120), String(track).slice(0, 80)).run();
            await db.prepare("DELETE FROM activity WHERE uid = ? AND id NOT IN (SELECT id FROM activity WHERE uid = ? ORDER BY id DESC LIMIT 80)").bind(user, user).run();
          } catch (e) {}
        }
        break;
      }
      case "reply": {
        const { track, user, text, parent } = body;
        if (!track || !user || !text) return json({ error: "missing fields" }, 400);
        const link = await db.prepare(
          "SELECT display_name, avatar, discord_id FROM discord_links WHERE site_uid = ?"
        ).bind(user).first();
        if (!link || !link.display_name) return json({ error: "Link Discord to reply" }, 403);
        let parentId = null;
        let replyTo = "";
        let parentAuthorId = "";
        if (parent != null) {
          const pr = await db.prepare(
            "SELECT id, user_name, discord_id FROM replies WHERE id = ?"
          ).bind(Number(parent)).first();
          if (pr) {
            parentId = pr.id;
            replyTo = String(pr.user_name).slice(0, 24);
            parentAuthorId = String(pr.discord_id || "");
          }
        }
        let ins;
        try {
          ins = await db.prepare(
            "INSERT INTO replies (track_id, user_name, avatar, discord_id, body, parent_id, reply_to, author_uid) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
          ).bind(track, link.display_name, link.avatar || "", link.discord_id || "", String(text).slice(0, 500), parentId, replyTo, user).run();
        } catch (e) {
          ins = await db.prepare(
            "INSERT INTO replies (track_id, user_name, avatar, discord_id, body, parent_id, reply_to) VALUES (?, ?, ?, ?, ?, ?, ?)"
          ).bind(track, link.display_name, link.avatar || "", link.discord_id || "", String(text).slice(0, 500), parentId, replyTo).run();
        }
        const replyId = ins.meta && ins.meta.last_row_id ? Number(ins.meta.last_row_id) : 0;
        const saved = await db.prepare(
          "SELECT id, track_id, user_name, avatar, discord_id, body, created_at, edited_at, parent_id, reply_to FROM replies WHERE id = ?"
        ).bind(replyId).first();
        createdReply = frontendReply(saved || {
          id: replyId,
          track_id: track,
          user_name: link.display_name,
          avatar: link.avatar || "",
          discord_id: link.discord_id || "",
          body: String(text).slice(0, 500),
          created_at: new Date().toISOString(),
          edited_at: null,
          parent_id: parentId,
          reply_to: replyTo,
        }, 0);
        createdReply.clientTempId = body.clientTempId || null;
        liveEvent = { type: "reply:created", reply: createdReply, conversationId: track, clientTempId: body.clientTempId || null };
        if (parentAuthorId && link.discord_id && parentAuthorId !== link.discord_id) {
          const target = await db.prepare(
            "SELECT site_uid FROM discord_links WHERE discord_id = ?"
          ).bind(parentAuthorId).first();
          if (target && target.site_uid && target.site_uid !== user) {
            const n = await db.prepare(
              "INSERT INTO notifications (uid, type, message, track_id, reply_id, actor) VALUES (?, 'reply', ?, ?, ?, ?)"
            ).bind(
              target.site_uid,
              link.display_name + " replied to your comment on " + String(track).slice(0, 80),
              String(track).slice(0, 80),
              replyId,
              link.display_name
            ).run();
            await hubBroadcast(env, {
              type: "notification:created",
              recipientUid: target.site_uid,
              notification: {
                id: n.meta && n.meta.last_row_id ? Number(n.meta.last_row_id) : 0,
                type: "reply",
                message: link.display_name + " replied to your comment on " + String(track).slice(0, 80),
                track_id: String(track).slice(0, 80),
                reply_id: replyId,
                actor: link.display_name,
              },
            });
          }
        }
        break;
      }
      case "disconnect": {
        const { user } = body;
        if (!user) return json({ error: "missing user" }, 400);
        await db.prepare("DELETE FROM discord_links WHERE site_uid = ?").bind(user).run();
        break;
      }
      case "voteReply": {
        const { id, value, user } = body;
        if (!id || !user) return json({ error: "missing fields" }, 400);
        const link = await db.prepare(
          "SELECT display_name, discord_id FROM discord_links WHERE site_uid = ?"
        ).bind(user).first();
        if (!link) return json({ error: "Link Discord to vote" }, 403);
        const rid = Number(id);
        const v = value === -1 ? -1 : 1;
        const existing = await db.prepare(
          "SELECT value FROM reply_votes WHERE site_uid = ? AND reply_id = ?"
        ).bind(user, rid).first();
        let voted = false;
        if (existing) {
          if (existing.value === v) {
            await db.prepare("DELETE FROM reply_votes WHERE site_uid = ? AND reply_id = ?").bind(user, rid).run();
          } else {
            await db.prepare("UPDATE reply_votes SET value = ? WHERE site_uid = ? AND reply_id = ?").bind(v, user, rid).run();
            voted = true;
          }
        } else {
          await db.prepare("INSERT INTO reply_votes (site_uid, reply_id, value) VALUES (?, ?, ?)").bind(user, rid, v).run();
          voted = true;
        }
        if (voted) {
          try {
            const rr = await db.prepare("SELECT track_id, discord_id FROM replies WHERE id = ?").bind(rid).first();
            if (rr && rr.discord_id && link.discord_id && rr.discord_id !== link.discord_id) {
              const tgt = await db.prepare(
                "SELECT site_uid FROM discord_links WHERE discord_id = ?"
              ).bind(rr.discord_id).first();
              if (tgt && tgt.site_uid && tgt.site_uid !== user) {
                const label = v === 1 ? "upvoted" : "downvoted";
                await db.prepare(
                  "INSERT INTO notifications (uid, type, message, track_id, reply_id, actor) VALUES (?, 'vote', ?, ?, ?, ?)"
                ).bind(
                  tgt.site_uid,
                  (link.display_name || "Someone") + " " + label + " your comment on " + String(rr.track_id).slice(0, 80),
                  String(rr.track_id).slice(0, 80),
                  rid,
                  link.display_name || ""
                ).run();
              }
            }
          } catch (e) {}
        }
        break;
      }
      case "deleteReply": {
        const { id, user } = body;
        if (!id) return json({ error: "missing id" }, 400);
        const rid = Number(id);
        const row = await db.prepare("SELECT discord_id, track_id FROM replies WHERE id = ?").bind(rid).first();
        if (!row) return json({ error: "reply not found" }, 404);
        const link = await db.prepare(
          "SELECT discord_id FROM discord_links WHERE site_uid = ?"
        ).bind(user).first();
        if (!link || !row.discord_id || link.discord_id !== row.discord_id) {
          return json({ error: "not your reply" }, 403);
        }
        await db.prepare("UPDATE replies SET parent_id = NULL WHERE parent_id = ?").bind(rid).run();
        await db.prepare("DELETE FROM replies WHERE id = ?").bind(rid).run();
        liveEvent = { type: "reply:deleted", replyId: rid, conversationId: String(row.track_id || "wanted") };
        break;
      }
      case "editReply": {
        const { id, text, user } = body;
        if (!id || !text) return json({ error: "missing id or text" }, 400);
        const rid = Number(id);
        const row = await db.prepare("SELECT discord_id, track_id FROM replies WHERE id = ?").bind(rid).first();
        if (!row) return json({ error: "reply not found" }, 404);
        const link = await db.prepare(
          "SELECT discord_id FROM discord_links WHERE site_uid = ?"
        ).bind(user).first();
        if (!link || !row.discord_id || link.discord_id !== row.discord_id) {
          return json({ error: "not your reply" }, 403);
        }
        await db.prepare(
          "UPDATE replies SET body = ?, edited_at = ? WHERE id = ?"
        ).bind(String(text).slice(0, 500), new Date().toISOString(), rid).run();
        liveEvent = { type: "reply:updated", replyId: rid, text: String(text).slice(0, 500), conversationId: String(row.track_id || "wanted") };
        break;
      }
      case "nominate": {
        const { track, note } = body;
        if (!track) return json({ error: "missing track" }, 400);
        const exists = await db.prepare("SELECT id FROM tracks WHERE title = ?").bind(String(track).slice(0, 80)).first();
        if (exists) return json({ error: "already nominated" }, 409);
        await db.prepare("INSERT INTO tracks (title, note) VALUES (?, ?)")
          .bind(String(track).slice(0, 80), String(note || "nominated by you").slice(0, 120)).run();
        break;
      }
      default:
        return json({ error: "unknown action: " + body.action }, 400);
    }
    if (liveEvent) { await hubBroadcast(env, liveEvent); }
    return json(await loadState(env, body.user || ""));
  } catch (err) {
    return json({ error: String(err && err.message || err) }, 500);
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
