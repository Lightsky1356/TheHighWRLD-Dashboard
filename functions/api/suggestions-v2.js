import { hubBroadcast, resolveSiteUid } from "../_lib/realtime.js";
import { getSessionUser } from "../_lib/auth.js";

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

const VALID_STATUSES = ["new", "under_review", "planned", "in_progress", "completed", "declined"];
const VALID_CATEGORIES = ["dashboard", "player", "community", "bug_fix", "feature_request", "other"];
const VALID_SORT = ["newest", "most_voted"];
const MAX_TITLE = 120;
const MAX_DESC = 600;

async function isAdmin(db, uid, env) {
  if (!uid) return false;
  const link = await db.prepare("SELECT discord_id FROM discord_links WHERE site_uid = ?").bind(uid).first();
  const ownerDiscordId = env.OWNER_DISCORD_ID || "1016529053659967629";
  return !!(link && link.discord_id && link.discord_id === ownerDiscordId);
}

async function isLinked(db, uid) {
  if (!uid) return false;
  const link = await db.prepare("SELECT display_name FROM discord_links WHERE site_uid = ?").bind(uid).first();
  return !!(link && link.display_name);
}

async function loadSuggestions(env, params) {
  const db = env.wanted_vault;
  const status = params.get("status") || "all";
  const category = params.get("category") || "all";
  const sort = params.get("sort") || "newest";
  const search = params.get("q") || "";
  const page = Math.max(1, parseInt(params.get("page") || "1", 10));
  const limit = Math.min(50, Math.max(1, parseInt(params.get("limit") || "30", 10)));
  const offset = (page - 1) * limit;

  let where = "1=1";
  const binds = [];
  if (status && status !== "all" && VALID_STATUSES.includes(status)) {
    where += " AND s.status = ?";
    binds.push(status);
  }
  if (category && category !== "all" && VALID_CATEGORIES.includes(category)) {
    where += " AND s.category = ?";
    binds.push(category);
  }
  if (search) {
    where += " AND (s.title LIKE ? OR s.description LIKE ?)";
    const q = "%" + search.slice(0, 80) + "%";
    binds.push(q, q);
  }
  const orderBy = sort === "most_voted" ? "s.vote_count DESC, s.created_at DESC" : "s.created_at DESC";

  const countRow = await db.prepare("SELECT COUNT(*) as n FROM suggestions_v2 s WHERE " + where).bind(...binds).first();
  const total = countRow ? countRow.n : 0;

  const rows = await db.prepare(
    "SELECT s.id, s.title, s.description, s.category, s.author_uid, s.author_name, s.status, s.vote_count, s.created_at, s.updated_at FROM suggestions_v2 s WHERE " + where + " ORDER BY " + orderBy + " LIMIT ? OFFSET ?"
  ).bind(...binds, limit, offset).all();

  return {
    suggestions: rows.results.map(r => ({
      id: r.id,
      title: r.title,
      description: r.description,
      category: r.category,
      authorUid: r.author_uid,
      authorName: r.author_name,
      status: r.status,
      voteCount: r.vote_count,
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
    const data = await loadSuggestions(context.env, url.searchParams);
    if (user) {
      const db = context.env.wanted_vault;
      data.isOwner = await isAdmin(db, user, context.env);
      data.linked = await isLinked(db, user);
      const myVotes = await db.prepare(
        "SELECT suggestion_id, value FROM suggestion_votes WHERE user_id = ?"
      ).bind(user).all();
      data.myVotes = {};
      for (const v of myVotes.results) data.myVotes[v.suggestion_id] = v.value;
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

  try {
    switch (body.action) {
      case "create": {
        const uid = await resolveSiteUid(db, context.request, body.user);
        if (!(await isLinked(db, uid))) return json({ error: "discord_link_required", message: "Creating a Suggestion requires a LINKED Discord Account" }, 403);
        const title = String(body.title || "").trim().slice(0, MAX_TITLE);
        if (!title) return json({ error: "Title is required" }, 400);
        const description = esc(String(body.description || "").trim().slice(0, MAX_DESC));
        const category = VALID_CATEGORIES.includes(String(body.category || "")) ? String(body.category) : "other";
        let authorName = "🖥️System";
        if (uid) {
          const link = await db.prepare("SELECT display_name FROM discord_links WHERE site_uid = ?").bind(uid).first();
          if (link && link.display_name) authorName = link.display_name;
          else {
            const u = await db.prepare("SELECT name FROM users WHERE uid = ?").bind(uid).first();
            if (u && u.name) authorName = u.name;
          }
        }
        const recent = uid ? await db.prepare(
          "SELECT COUNT(*) as n FROM suggestions_v2 WHERE author_uid = ? AND created_at >= datetime('now','-1 hour')"
        ).bind(uid).first() : null;
        if (recent && recent.n >= 10) return json({ error: "Too many suggestions recently. Try again later." }, 429);
        const ins = await db.prepare(
          "INSERT INTO suggestions_v2 (title, description, category, author_uid, author_name) VALUES (?, ?, ?, ?, ?)"
        ).bind(title, description, category, uid || "", authorName).run();
        const sugId = ins.meta && ins.meta.last_row_id ? Number(ins.meta.last_row_id) : 0;
        const sug = await db.prepare("SELECT * FROM suggestions_v2 WHERE id = ?").bind(sugId).first();
        liveEvent = {
          type: "suggestion:created",
          suggestion: sug ? {
            id: sug.id, title: sug.title, description: sug.description,
            category: sug.category, authorUid: sug.author_uid, authorName: sug.author_name,
            status: sug.status, voteCount: sug.vote_count,
            createdAt: sug.created_at, updatedAt: sug.updated_at,
          } : null,
        };
        break;
      }
      case "vote": {
        const sugId = Number(body.id);
        const rawVal = Number(body.value);
        const value = rawVal === -1 ? -1 : (rawVal === 0 ? 0 : 1);
        if (!sugId) return json({ error: "missing id" }, 400);
        const uid = await resolveSiteUid(db, context.request, body.user);
        if (!uid) return json({ error: "sign in to vote" }, 401);
        if (!(await isLinked(db, uid))) return json({ error: "discord_link_required", message: "Voting requires a LINKED Discord Account" }, 403);
        const existing = await db.prepare(
          "SELECT id, value FROM suggestion_votes WHERE suggestion_id = ? AND user_id = ?"
        ).bind(sugId, uid).first();
        let delta = 0;
        let voted = 0;
        if (existing) {
          if (value === 0 || existing.value === value) {
            await db.prepare("DELETE FROM suggestion_votes WHERE id = ?").bind(existing.id).run();
            delta = -existing.value;
            voted = 0;
          } else {
            await db.prepare("UPDATE suggestion_votes SET value = ? WHERE id = ?").bind(value, existing.id).run();
            delta = value - existing.value;
            voted = value;
          }
        } else if (value !== 0) {
          await db.prepare("INSERT INTO suggestion_votes (suggestion_id, user_id, value) VALUES (?, ?, ?)").bind(sugId, uid, value).run();
          delta = value;
          voted = value;
        }
        await db.prepare("UPDATE suggestions_v2 SET vote_count = MAX(0, vote_count + ?) WHERE id = ?").bind(delta, sugId).run();
        const updated = await db.prepare("SELECT vote_count FROM suggestions_v2 WHERE id = ?").bind(sugId).first();
        liveEvent = {
          type: "suggestion:voted",
          suggestionId: sugId,
          voteCount: updated ? updated.vote_count : 0,
        };
        break;
      }
      case "updateStatus": {
        const sugId = Number(body.id);
        const newStatus = String(body.status || "").toLowerCase();
        if (!sugId || !VALID_STATUSES.includes(newStatus)) return json({ error: "invalid id or status" }, 400);
        const uid = await resolveSiteUid(db, context.request, body.user);
        if (!uid || !(await isAdmin(db, uid, env))) return json({ error: "admin only" }, 403);
        await db.prepare("UPDATE suggestions_v2 SET status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").bind(newStatus, sugId).run();
        liveEvent = { type: "suggestion:status", suggestionId: sugId, status: newStatus };
        break;
      }
      case "edit": {
        const sugId = Number(body.id);
        if (!sugId) return json({ error: "missing id" }, 400);
        const uid = await resolveSiteUid(db, context.request, body.user);
        if (!uid) return json({ error: "sign in required" }, 401);
        const sug = await db.prepare("SELECT author_uid FROM suggestions_v2 WHERE id = ?").bind(sugId).first();
        if (!sug) return json({ error: "not found" }, 404);
        const ownerOrAdmin = (sug.author_uid === uid) || (await isAdmin(db, uid, env));
        if (!ownerOrAdmin) return json({ error: "not authorized" }, 403);
        const title = String(body.title || "").trim().slice(0, MAX_TITLE);
        const description = esc(String(body.description || "").trim().slice(0, MAX_DESC));
        const category = VALID_CATEGORIES.includes(String(body.category || "")) ? String(body.category) : null;
        if (title) {
          const sets = ["title=?", "description=?", "updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')"];
          const vals = [title, description];
          if (category) { sets.push("category=?"); vals.push(category); }
          vals.push(sugId);
          await db.prepare("UPDATE suggestions_v2 SET " + sets.join(",") + " WHERE id=?").bind(...vals).run();
        }
        liveEvent = { type: "suggestion:edited", suggestionId: sugId };
        break;
      }
      case "delete": {
        const sugId = Number(body.id);
        if (!sugId) return json({ error: "missing id" }, 400);
        const uid = await resolveSiteUid(db, context.request, body.user);
        if (!uid || !(await isAdmin(db, uid, env))) return json({ error: "admin only" }, 403);
        await db.prepare("DELETE FROM suggestion_votes WHERE suggestion_id = ?").bind(sugId).run();
        await db.prepare("DELETE FROM suggestions_v2 WHERE id = ?").bind(sugId).run();
        liveEvent = { type: "suggestion:deleted", suggestionId: sugId };
        break;
      }
      default:
        return json({ error: "unknown action" }, 400);
    }
    if (liveEvent) await hubBroadcast(env, liveEvent);
    return json({ ok: true });
  } catch (err) {
    return json({ error: String(err && err.message || err) }, 500);
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}
