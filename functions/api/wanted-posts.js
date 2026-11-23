import { hubBroadcast, resolveSiteUid } from "../_lib/realtime.js";
import { banRejection } from "../_lib/bans.js";
import { activeReview, removeContent, notifyModeration } from "../_lib/active-mod.js";
import { evaluateSurfaceRules, recordRuleFlags } from "../_lib/submissionRules.js";
import { createNotification } from "../_lib/notifications.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const VALID_STATUSES = ["wanted", "searching", "found", "closed"];
const VALID_SORT = ["newest", "oldest"];
const MAX_TITLE = 120;
const MAX_ALT = 120;
const MAX_DESC = 600;
const MAX_ERA = 80;

async function isAdmin(db, uid, env) {
  if (!uid) return false;
  const link = await db.prepare("SELECT discord_id FROM discord_links WHERE site_uid = ?").bind(uid).first();
  const ownerDiscordId = env.OWNER_DISCORD_ID || "1016529053659967629";
  return !!(link && link.discord_id && link.discord_id === ownerDiscordId);
}

// Wanted requests in the last 10 minutes, for the flooding detector.
async function recentCount(db, uid) {
  if (!uid) return null;
  const row = await db.prepare(
    "SELECT COUNT(*) as n FROM wanted_posts WHERE author_uid = ? AND created_at >= datetime('now','-10 minutes')"
  ).bind(uid).first().catch(() => null);
  return row ? Number(row.n) : null;
}

// AI first, rules second. A high-confidence AI verdict removes the request;
// the vault-specific rules and every lesser finding still go to a human.
async function flagSubmission(db, env, targetId, uid, fields) {
  const violations = evaluateSurfaceRules("wanted", fields);
  const review = await activeReview(db, env, {
    targetType: "wanted", targetId: String(targetId || ""), uid,
    text: String(fields.title || "") + "\n" + String(fields.altName || "") + "\n" +
      String(fields.description || "") + "\n" + String(fields.era || ""),
    author: fields.author, recentCount: fields.recentCount,
  });
  let rule = null;
  if (violations.length) rule = await recordRuleFlags(db, { surface: "wanted", targetId, uid, violations });

  if (review.action === "remove") {
    const removed = await removeContent(db, env, "wanted", targetId);
    await notifyModeration(db, env, uid,
      "Your wanted request was removed by AI moderation (" + review.category + ").",
      "wanted", String(targetId || ""));
    return { severity: "high", codes: ["ai:" + review.category], removed, flagId: review.flagId };
  }
  if (rule || review.action === "flag") {
    const codes = violations.map((v) => v.code);
    if (review.action === "flag") codes.push(review.category);
    const severity = (rule && rule.severity) || review.severity || "low";
    await notifyModeration(db, env, uid,
      "Your wanted request was sent to staff review (" + codes.join(", ") + ")",
      "wanted-posts:" + targetId, String(targetId || ""));
    return { severity, codes, flagId: review.flagId };
  }
  return null;
}

async function loadPosts(env, params) {
  const db = env.wanted_vault;
  const status = params.get("status") || "all";
  const sort = params.get("sort") || "newest";
  const search = params.get("q") || "";
  const page = Math.max(1, parseInt(params.get("page") || "1", 10));
  const limit = Math.min(50, Math.max(1, parseInt(params.get("limit") || "30", 10)));
  const offset = (page - 1) * limit;

  let where = "1=1";
  const binds = [];
  if (status && status !== "all" && VALID_STATUSES.includes(status)) {
    where += " AND status = ?";
    binds.push(status);
  }
  if (search) {
    where += " AND (title LIKE ? OR alt_name LIKE ? OR description LIKE ? OR era LIKE ?)";
    const q = "%" + search.slice(0, 80) + "%";
    binds.push(q, q, q, q);
  }
  const orderBy = sort === "oldest" ? "created_at ASC" : "created_at DESC";

  const countRow = await db.prepare("SELECT COUNT(*) as n FROM wanted_posts WHERE " + where).bind(...binds).first();
  const total = countRow ? countRow.n : 0;

  const rows = await db.prepare(
    "SELECT id, title, alt_name, description, era, author_uid, author_name, status, created_at, updated_at FROM wanted_posts WHERE " + where + " ORDER BY " + orderBy + " LIMIT ? OFFSET ?"
  ).bind(...binds, limit, offset).all();

  return {
    posts: rows.results.map(r => ({
      id: r.id,
      title: r.title,
      altName: r.alt_name,
      description: r.description,
      era: r.era,
      authorUid: r.author_uid,
      authorName: r.author_name,
      status: r.status,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    })),
    total,
    page,
    limit,
    pages: Math.ceil(total / limit),
  };
}

export async function onRequestGet(context) {
  try {
    const url = new URL(context.request.url);
    const user = url.searchParams.get("user") || "";
    const data = await loadPosts(context.env, url.searchParams);
    if (user) {
      const db = context.env.wanted_vault;
      data.isOwner = await isAdmin(db, user, context.env);
    }
    return json(data);
  } catch (err) {
    return json({ error: String(err && err.message || err) }, 500);
  }
}

export async function onRequestPost(context) {
  const body = await context.request.json().catch(() => null);
  if (!body || !body.action) return json({ error: "missing action" }, 400);
  const env = context.env;
  const db = env.wanted_vault;
  let liveEvent = null;
  let ruleFlag = null;

  // Ban enforcement: every action here mutates (create/edit/delete/status).
  try {
    const gateUid = await resolveSiteUid(db, context.request, body.user);
    if (gateUid) {
      const rej = await banRejection(db, gateUid);
      if (rej) return rej.response;
    }
  } catch (_) {}

  try {
    switch (body.action) {
      case "create": {
        const uid = await resolveSiteUid(db, context.request, body.user);
        const link = uid ? await db.prepare("SELECT display_name FROM discord_links WHERE site_uid = ?").bind(uid).first() : null;
        if (!link || !link.display_name) return json({ error: "discord_link_required", message: "Submitting a Wanted request requires a LINKED Discord Account" }, 403);
        const title = String(body.title || "").trim().slice(0, MAX_TITLE);
        if (!title) return json({ error: "Title is required" }, 400);
        const altName = String(body.altName || "").trim().slice(0, MAX_ALT);
        const description = String(body.description || "").trim().slice(0, MAX_DESC);
        const era = String(body.era || "").trim().slice(0, MAX_ERA);
        if (uid) {
          try {
            await db.prepare(
              "INSERT INTO notifications (uid, type, message, href, post_id, data, actor) VALUES (?, 'info', ?, ?, ?, ?, ?)"
            ).bind(uid, "Wanted request posted — good hunting in the vault", "wanted-posts:create", "", "", String(body.authorName || "System").slice(0, 40)).run();
          } catch (_) {}
        }
        let authorName = "🖥️System";
        if (uid) {
          const link = await db.prepare("SELECT display_name FROM discord_links WHERE site_uid = ?").bind(uid).first();
          if (link && link.display_name) authorName = link.display_name;
          else {
            const u = await db.prepare("SELECT name FROM users WHERE uid = ?").bind(uid).first();
            if (u && u.name) authorName = u.name;
          }
        }
        const dup = await db.prepare(
          "SELECT id FROM wanted_posts WHERE LOWER(title) = LOWER(?) AND status != 'closed'"
        ).bind(title).first();
        if (dup) return json({ error: "A similar wanted request already exists" }, 409);
        const ins = await db.prepare(
          "INSERT INTO wanted_posts (title, alt_name, description, era, author_uid, author_name) VALUES (?, ?, ?, ?, ?, ?)"
        ).bind(title, altName, description, era, uid || "", authorName).run();
        const postId = ins.meta && ins.meta.last_row_id ? Number(ins.meta.last_row_id) : 0;
        const post = await db.prepare("SELECT * FROM wanted_posts WHERE id = ?").bind(postId).first();
        // Vault rules: never blocks the request, only flags it for staff.
        ruleFlag = await flagSubmission(db, env, postId, uid, {
          title, altName, description, era, author: authorName, recentCount: await recentCount(db, uid),
        });
        liveEvent = (ruleFlag && ruleFlag.removed)
          ? { type: "wanted:deleted", postId }
          : {
          type: "wanted:created",
          post: post ? {
            id: post.id, title: post.title, altName: post.alt_name,
            description: post.description, era: post.era,
            authorUid: post.author_uid, authorName: post.author_name,
            status: post.status, createdAt: post.created_at, updatedAt: post.updated_at,
          } : null,
        };
        break;
      }
      case "updateStatus": {
        const postId = Number(body.id);
        const newStatus = String(body.status || "").toLowerCase();
        if (!postId || !VALID_STATUSES.includes(newStatus)) return json({ error: "invalid id or status" }, 400);
        const uid = await resolveSiteUid(db, context.request, body.user);
        if (!uid || !(await isAdmin(db, uid, env))) return json({ error: "admin only" }, 403);
        await db.prepare("UPDATE wanted_posts SET status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").bind(newStatus, postId).run();
        liveEvent = { type: "wanted:status", postId, status: newStatus };
        try {
          const tgt = await db.prepare("SELECT author_uid, title FROM wanted_posts WHERE id = ?").bind(postId).first();
          if (tgt && tgt.author_uid && tgt.author_uid !== uid) {
            const msg = 'Your wanted post "' + String(tgt.title || "").slice(0, 60) + '" is now ' + newStatus;
            await createNotification(db, env, tgt.author_uid, {
              type: "wanted",
              actorUid: uid,
              actorName: "Staff",
              message: msg,
            }, context);
          }
        } catch (_) {}
        break;
      }
      case "edit": {
        const postId = Number(body.id);
        if (!postId) return json({ error: "missing id" }, 400);
        const uid = await resolveSiteUid(db, context.request, body.user);
        if (!uid) return json({ error: "sign in required" }, 401);
        const post = await db.prepare("SELECT author_uid FROM wanted_posts WHERE id = ?").bind(postId).first();
        if (!post) return json({ error: "not found" }, 404);
        const ownerOrAdmin = (post.author_uid === uid) || (await isAdmin(db, uid, env));
        if (!ownerOrAdmin) return json({ error: "not authorized" }, 403);
        const title = String(body.title || "").trim().slice(0, MAX_TITLE);
        const altName = String(body.altName || "").trim().slice(0, MAX_ALT);
        const description = String(body.description || "").trim().slice(0, MAX_DESC);
        const era = String(body.era || "").trim().slice(0, MAX_ERA);
        if (title) {
          await db.prepare("UPDATE wanted_posts SET title=?, alt_name=?, description=?, era=?, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?")
            .bind(title, altName, description, era, postId).run();
          ruleFlag = await flagSubmission(db, env, postId, uid, {
            title, altName, description, era, author: uid, recentCount: null,
          });
        }
        liveEvent = (ruleFlag && ruleFlag.removed)
          ? { type: "wanted:deleted", postId }
          : { type: "wanted:edited", postId };
        break;
      }
      case "delete": {
        const postId = Number(body.id);
        if (!postId) return json({ error: "missing id" }, 400);
        const uid = await resolveSiteUid(db, context.request, body.user);
        if (!uid || !(await isAdmin(db, uid, env))) return json({ error: "admin only" }, 403);
        await db.prepare("DELETE FROM wanted_posts WHERE id = ?").bind(postId).run();
        liveEvent = { type: "wanted:deleted", postId };
        break;
      }
      default:
        return json({ error: "unknown action" }, 400);
    }
    if (liveEvent) await hubBroadcast(env, liveEvent);
    return json({ ok: true, flagged: ruleFlag });
  } catch (err) {
    return json({ error: String(err && err.message || err) }, 500);
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}
