// Automated moderation review queue (Phase 6B). Staff-only.
// Review actions reuse the existing ban/notification systems; nothing here
// auto-bans. Every decision is written to user_action_log.

import { getSessionUser } from "../_lib/auth.js";
import { hubBroadcast } from "../_lib/realtime.js";
import { createNotification } from "../_lib/notifications.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};
const PAGE_CAP = 25;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { "Content-Type": "application/json", ...CORS },
  });
}

async function resolveSiteUid(db, request, bodyUser) {
  try {
    const s = await getSessionUser(db, request);
    if (s && s.uid) return s.uid;
  } catch (_) {}
  return String(bodyUser || "").slice(0, 40) || "";
}

async function isStaff(db, uid, env) {
  if (!uid) return false;
  try {
    const link = await db.prepare("SELECT discord_id FROM discord_links WHERE site_uid = ?").bind(uid).first();
    const ownerId = env.OWNER_DISCORD_ID || "1016529053659967629";
    return !!(link && link.discord_id && link.discord_id === ownerId);
  } catch (_) {
    return false;
  }
}

async function audit(db, actorUid, text) {
  try {
    await db.prepare("INSERT INTO user_action_log (actor_uid, action) VALUES (?, ?)")
      .bind(String(actorUid).slice(0, 40), String(text).slice(0, 200)).run();
  } catch (_) {}
}

async function notifyUser(db, env, uid, type, message, ctx) {
  await createNotification(db, env, uid, { type, actorName: "Staff", message }, ctx);
}

// Content is loaded live so the reviewer sees what exists now, not a stale copy.
// Every target_type must be handled explicitly: guessing against
// community_posts would show the wrong row (or a random one) for the Suggestions,
// Wanted Vault, and Gallery flags.
async function loadContent(db, type, id) {
  const n = Number(id) || 0;
  if (!n) return null;
  if (type === "reply") {
    const r = await db.prepare("SELECT * FROM community_replies WHERE id = ?").bind(n).first();
    return r ? { text: (r.user_name + ": " + r.body).slice(0, 500), exists: true, author: r.user_name, uid: r.author_uid } : { text: "(reply removed)", exists: false };
  }
  if (type === "post") {
    const p = await db.prepare("SELECT * FROM community_posts WHERE id = ?").bind(n).first();
    return p ? { text: (p.title + "\n" + p.body).slice(0, 500), exists: true, author: p.user_name, uid: p.author_uid } : { text: "(post removed)", exists: false };
  }
  if (type === "suggestion") {
    const s = await db.prepare("SELECT * FROM suggestions_v2 WHERE id = ?").bind(n).first();
    return s ? { text: (s.title + "\n" + (s.description || "")).slice(0, 500), exists: true, author: s.author_name, uid: s.author_uid } : { text: "(suggestion removed)", exists: false };
  }
  if (type === "wanted") {
    const w = await db.prepare("SELECT * FROM wanted_posts WHERE id = ?").bind(n).first();
    return w ? { text: (w.title + "\n" + (w.description || "")).slice(0, 500), exists: true, author: w.author_name, uid: w.author_uid } : { text: "(wanted request removed)", exists: false };
  }
  if (type === "wanted_reply") {
    const r = await db.prepare("SELECT * FROM replies WHERE id = ?").bind(n).first();
    return r ? { text: (r.track_id + "\n" + r.user_name + ": " + r.body).slice(0, 500), exists: true, author: r.user_name, uid: r.author_uid } : { text: "(comment removed)", exists: false };
  }
  if (type === "gallery") {
    // Never select the image blob here - just enough to judge the caption.
    const g = await db.prepare("SELECT id, title, caption, user_name, uid, status FROM gallery_items WHERE id = ?").bind(n).first();
    return g ? { text: (g.title + "\n" + (g.caption || "") + "\n[status: " + g.status + "]").slice(0, 500), exists: true, author: g.user_name, uid: g.uid } : { text: "(upload removed)", exists: false };
  }
  return { text: "(" + String(type || "item") + " #" + n + ")", exists: false };
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestGet(context) {
  try {
    const db = context.env.wanted_vault;
    const url = new URL(context.request.url);
    const uid = await resolveSiteUid(db, context.request, url.searchParams.get("user") || "");
    if (!uid || !(await isStaff(db, uid, context.env))) return json({ error: "forbidden" }, 403);
    const status = (url.searchParams.get("status") || "pending").toLowerCase();
    const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
    const limit = Math.max(1, Math.min(PAGE_CAP, Number(url.searchParams.get("limit")) || PAGE_CAP));
    const sev = (url.searchParams.get("severity") || "all").toLowerCase();
    let where = "1 = 1";
    const args = [];
    if (["pending", "approved", "removed", "actioned"].includes(status)) {
      where += " AND status = ?";
      args.push(status);
    }
    if (["low", "medium", "high"].includes(sev)) {
      where += " AND severity = ?";
      args.push(sev);
    }
    const total = await db.prepare("SELECT COUNT(*) AS n FROM automod_flags WHERE " + where).bind(...args).first();
    const rows = await db.prepare(
      "SELECT * FROM automod_flags WHERE " + where +
      " ORDER BY CASE severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, id DESC LIMIT ? OFFSET ?"
    ).bind(...args, limit, (page - 1) * limit).all();
    const flags = [];
    for (const r of (rows.results || [])) {
      const c = await loadContent(db, r.target_type, r.target_id);
      flags.push({
        id: r.id, target_type: r.target_type, target_id: r.target_id, uid: r.uid,
        category: r.category, confidence: r.confidence, severity: r.severity,
        recommended_action: r.recommended_action, detail: r.detail, ai_verdict: r.ai_verdict,
        status: r.status, created_at: r.created_at, reviewed_at: r.reviewed_at, reviewed_by: r.reviewed_by,
        content: c ? c.text : "(unavailable)", content_exists: c ? c.exists : false,
      });
    }
    const counts = await db.prepare(
      "SELECT status, COUNT(*) AS n FROM automod_flags GROUP BY status"
    ).all();
    return json({ ok: true, page, total: total ? total.n : 0, flags, counts: counts.results || [] });
  } catch (err) {
    return json({ error: String((err && err.message) || err) }, 500);
  }
}

export async function onRequestPost(context) {
  try {
    const db = context.env.wanted_vault;
    const body = await context.request.json().catch(() => ({}));
    const uid = await resolveSiteUid(db, context.request, body.user);
    if (!uid || !(await isStaff(db, uid, context.env))) return json({ ok: false, error: "forbidden" }, 403);
    const id = Number(body.id) || 0;
    const action = String(body.action || "");
    if (!id) return json({ ok: false, error: "missing id" }, 400);
    const flag = await db.prepare("SELECT * FROM automod_flags WHERE id = ?").bind(id).first();
    if (!flag) return json({ ok: false, error: "not found" }, 404);
    if (flag.status !== "pending") return json({ ok: false, error: "already reviewed" }, 409);
    const now = new Date().toISOString();
    const target = flag.uid || "";

    if (action === "dismiss" || action === "remove" || action === "warn" || action === "strike" || action === "temp_ban") {
      let status = action === "dismiss" ? "approved" : "actioned";
      if (action === "remove") {
        const t = Number(flag.target_id) || 0;
        if (t) {
          if (flag.target_type === "reply") {
            const r = await db.prepare("SELECT id, post_id FROM community_replies WHERE id = ?").bind(t).first();
            await db.prepare("UPDATE community_replies SET parent_id = NULL WHERE parent_id = ?").bind(t).run().catch(() => null);
            await db.prepare("DELETE FROM community_reactions WHERE reply_id = ?").bind(t).run().catch(() => null);
            await db.prepare("DELETE FROM community_notifications WHERE reply_id = ?").bind(t).run().catch(() => null);
            await db.prepare("DELETE FROM community_replies WHERE id = ?").bind(t).run().catch(() => null);
            await hubBroadcast(context.env, {
              type: "reply:deleted", replyId: t,
              postId: r ? r.post_id : null,
              conversationId: "post-" + (r ? r.post_id : 0),
            });
          } else if (flag.target_type === "post") {
            const kids = await db.prepare("SELECT id FROM community_replies WHERE post_id = ?").all(t).catch(() => null);
            for (const k of (kids && kids.results ? kids.results : [])) {
              await db.prepare("DELETE FROM community_reactions WHERE reply_id = ?").bind(k.id).run().catch(() => null);
              await hubBroadcast(context.env, { type: "reply:deleted", replyId: k.id, postId: t, conversationId: "post-" + t });
            }
            await db.prepare("DELETE FROM community_replies WHERE post_id = ?").bind(t).run().catch(() => null);
            await db.prepare("DELETE FROM community_reactions WHERE post_id = ?").bind(t).run().catch(() => null);
            await db.prepare("DELETE FROM community_notifications WHERE post_id = ?").bind(t).run().catch(() => null);
            await db.prepare("DELETE FROM community_posts WHERE id = ?").bind(t).run().catch(() => null);
            await hubBroadcast(context.env, { type: "post:deleted", postId: t });
          } else if (flag.target_type === "suggestion") {
            await db.prepare("DELETE FROM suggestion_votes WHERE suggestion_id = ?").bind(t).run().catch(() => null);
            await db.prepare("DELETE FROM suggestions_v2 WHERE id = ?").bind(t).run().catch(() => null);
            await hubBroadcast(context.env, { type: "suggestion:deleted", suggestionId: t });
          } else if (flag.target_type === "wanted") {
            await db.prepare("DELETE FROM wanted_posts WHERE id = ?").bind(t).run().catch(() => null);
            await hubBroadcast(context.env, { type: "wanted:deleted", postId: t });
          } else if (flag.target_type === "wanted_reply") {
            const r = await db.prepare("SELECT track_id FROM replies WHERE id = ?").bind(t).first().catch(() => null);
            await db.prepare("UPDATE replies SET parent_id = NULL WHERE parent_id = ?").bind(t).run().catch(() => null);
            await db.prepare("DELETE FROM notifications WHERE reply_id = ?").bind(t).run().catch(() => null);
            await db.prepare("DELETE FROM reply_votes WHERE reply_id = ?").bind(t).run().catch(() => null);
            await db.prepare("DELETE FROM replies WHERE id = ?").bind(t).run().catch(() => null);
            await hubBroadcast(context.env, {
              type: "reply:deleted", replyId: t, postId: null,
              conversationId: r ? r.track_id : null,
            });
          } else if (flag.target_type === "gallery") {
            // Reject rather than hard-delete, matching the gallery queue's own
            // moderation action, and drop the stored bytes either way.
            await db.prepare("UPDATE gallery_items SET status = 'rejected', data = NULL WHERE id = ?").bind(t).run().catch(() => null);
          }
        }
        status = "removed";
        if (target) {
          await notifyUser(db, context.env, target, "moderation",
            "Moderation removed your " + flag.target_type + " (" + flag.category + ").");
        }
      } else if (action === "warn" && target) {
        await notifyUser(db, context.env, target, "warning",
          "Warning from moderation: your " + flag.target_type + " broke the rules (" + flag.category + ").");
      } else if (action === "strike" && target) {
        const ins = await db.prepare(
          "INSERT INTO strikes (user_id, reason, moderator_id, moderator_notes) VALUES (?, ?, ?, ?)"
        ).bind(target, "Automod review: " + flag.category, uid, "automod flag #" + id).run();
        await audit(db, uid, "strike:issue:" + target + ":" +
          (ins.meta && ins.meta.last_row_id ? Number(ins.meta.last_row_id) : 0));
        await notifyUser(db, context.env, target, "warning",
          "You received a strike from moderation (" + flag.category + ").");
      } else if (action === "temp_ban" && target) {
        const hours = Math.max(1, Math.min(720, Number(body.hours) || 24));
        const expires = new Date(Date.now() + hours * 3600000).toISOString();
        const ins = await db.prepare(
          "INSERT INTO bans (user_id, reason, moderator_id, moderator_notes, expires_at) VALUES (?, ?, ?, ?, ?)"
        ).bind(target, "Automod review: " + flag.category, uid, "automod flag #" + id, expires).run();
        await audit(db, uid, "ban:create:" + target + ":" +
          (ins.meta && ins.meta.last_row_id ? Number(ins.meta.last_row_id) : 0));
        await notifyUser(db, context.env, target, "ban",
          "Your account is temporarily restricted until " + expires.slice(0, 10) + ".");
      }
      const upd = await db.prepare(
        "UPDATE automod_flags SET status = ?, reviewed_at = ?, reviewed_by = ? WHERE id = ? AND status = 'pending'"
      ).bind(status, now, uid, id).run().catch(() => null);
      if (!upd || (upd.meta && upd.meta.changes === 0)) {
        return json({ ok: false, error: "already reviewed" }, 409);
      }
      await audit(db, uid, "automod:" + action + ":" + id + ":" + target);
      await hubBroadcast(context.env, { type: "automod:reviewed", flagId: id, action, status });
      return json({ ok: true, status });
    }
    return json({ ok: false, error: "unknown action" }, 400);
  } catch (err) {
    return json({ ok: false, error: String((err && err.message) || err) }, 500);
  }
}
