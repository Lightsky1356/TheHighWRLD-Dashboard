// Ban appeals (Phase 4): user submission + moderator review.
// User endpoints derive identity from the session only. Staff endpoints reuse
// the owner-discord single-role model (same as bans.js / reports.js).
//
// POST /api/appeals { action:"submit", body }
// GET  /api/appeals?action=mine
// GET  /api/appeals?action=queue&status=&page=&limit=      (staff)
// GET  /api/appeals?action=get&id=                        (staff)
// POST /api/appeals { action:"decide", id, decision, response, user } (staff)

import { getSessionUser } from "../_lib/auth.js";
import { banStatus } from "../_lib/bans.js";
import { createNotification } from "../_lib/notifications.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const PAGE_CAP = 20;
const BODY_MIN = 10;
const BODY_MAX = 2000;
const SUBMITS_PER_DAY = 3;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
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

function publicAppeal(r) {
  return {
    id: r.id,
    ban_id: r.ban_id,
    status: r.status,
    body: r.body || "",
    created_at: r.created_at || "",
    reviewed_at: r.reviewed_at || "",
    moderator_response: r.moderator_response || "",
  };
}

async function notifyUser(db, env, uid, type, message) {
  await createNotification(db, env, uid, { type, actorName: "Staff", message });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestGet(context) {
  try {
    const db = context.env.wanted_vault;
    const url = new URL(context.request.url);
    const action = url.searchParams.get("action") || "mine";

    if (action === "mine") {
      const me = await getSessionUser(db, context.request);
      if (!me) return json({ ok: false, error: "not signed in" }, 401);
      const rows = await db.prepare(
        "SELECT a.*, b.reason AS ban_reason, b.created_at AS ban_created, b.expires_at AS ban_expires " +
        "FROM ban_appeals a LEFT JOIN bans b ON b.id = a.ban_id " +
        "WHERE a.user_id = ? ORDER BY a.id DESC LIMIT 20"
      ).bind(me.uid).all();
      return json({
        ok: true,
        appeals: (rows.results || []).map((r) => ({
          ...publicAppeal(r),
          ban_reason: r.ban_reason || "",
          ban_created: r.ban_created || "",
          ban_expires: r.ban_expires || "",
        })),
      });
    }

    // Staff-only below.
    const gate = await (async () => {
      const uid = await resolveSiteUid(db, context.request, url.searchParams.get("user") || "");
      if (!uid || !(await isStaff(db, uid, context.env))) return { error: json({ error: "forbidden" }, 403) };
      return { uid };
    })();
    if (gate.error) return gate.error;

    if (action === "get") {
      const id = Number(url.searchParams.get("id")) || 0;
      if (!id) return json({ ok: false, error: "missing id" }, 400);
      const r = await db.prepare(
        "SELECT a.*, b.reason AS ban_reason, b.created_at AS ban_created, b.expires_at AS ban_expires, " +
        "b.revoked_at AS ban_revoked, b.moderator_notes AS ban_notes " +
        "FROM ban_appeals a LEFT JOIN bans b ON b.id = a.ban_id WHERE a.id = ?"
      ).bind(id).first();
      if (!r) return json({ ok: false, error: "not found" }, 404);
      return json({
        ok: true,
        appeal: {
          ...publicAppeal(r),
          user_id: r.user_id || "",
          ban_reason: r.ban_reason || "",
          ban_created: r.ban_created || "",
          ban_expires: r.ban_expires || "",
          ban_revoked: r.ban_revoked || "",
          ban_notes: r.ban_notes || "",
        },
      });
    }

    // action=queue (default): pending-first optional filter, paginated.
    const status = (url.searchParams.get("status") || "pending").toLowerCase();
    const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
    const limit = Math.max(1, Math.min(PAGE_CAP, Number(url.searchParams.get("limit")) || PAGE_CAP));
    const where = status === "all" ? "1 = 1" : "a.status = ?";
    const args = status === "all" ? [] : [status];
    const total = await db.prepare("SELECT COUNT(*) AS n FROM ban_appeals a WHERE " + where).bind(...args).first();
    const rows = await db.prepare(
      "SELECT a.*, b.reason AS ban_reason FROM ban_appeals a " +
      "LEFT JOIN bans b ON b.id = a.ban_id WHERE " + where + " ORDER BY a.id DESC LIMIT ? OFFSET ?"
    ).bind(...args, limit, (page - 1) * limit).all();
    return json({
      ok: true, page, total: total ? total.n : 0,
      appeals: (rows.results || []).map((r) => ({
        ...publicAppeal(r),
        user_id: r.user_id || "",
        ban_reason: r.ban_reason || "",
      })),
    });
  } catch (err) {
    return json({ ok: false, error: String((err && err.message) || err) }, 500);
  }
}

export async function onRequestPost(context) {
  try {
    const db = context.env.wanted_vault;
    const body = await context.request.json().catch(() => ({}));
    const action = String(body.action || "");

    if (action === "submit") {
      const me = await getSessionUser(db, context.request);
      if (!me) return json({ ok: false, error: "not signed in" }, 401);
      const st = await banStatus(db, me.uid);
      if (!st.banned) return json({ ok: false, error: "no active ban to appeal" }, 409);
      const dupe = await db.prepare(
        "SELECT id FROM ban_appeals WHERE ban_id = ? AND user_id = ? AND status = 'pending' LIMIT 1"
      ).bind(st.id, me.uid).first().catch(() => null);
      if (dupe) return json({ ok: false, error: "appeal already pending", appeal_id: dupe.id }, 409);
      const text = String(body.body || "").trim();
      if (text.length < BODY_MIN) return json({ ok: false, error: "appeal too short" }, 400);
      if (text.length > BODY_MAX) return json({ ok: false, error: "appeal too long" }, 400);
      try {
        const recent = await db.prepare(
          "SELECT COUNT(*) AS n FROM ban_appeals WHERE user_id = ? AND created_at >= datetime('now', '-1 day')"
        ).bind(me.uid).first();
        if (recent && recent.n >= SUBMITS_PER_DAY) {
          return json({ ok: false, error: "daily appeal limit reached" }, 429);
        }
      } catch (_) {}
      const ins = await db.prepare(
        "INSERT INTO ban_appeals (ban_id, user_id, body, status) VALUES (?, ?, ?, 'pending')"
      ).bind(st.id, me.uid, text.slice(0, BODY_MAX)).run();
      const id = ins.meta && ins.meta.last_row_id ? Number(ins.meta.last_row_id) : 0;
      return json({ ok: true, appeal_id: id });
    }

    if (action === "decide") {
      const uid = await resolveSiteUid(db, context.request, body.user);
      if (!uid || !(await isStaff(db, uid, context.env))) {
        return json({ ok: false, error: "forbidden" }, 403);
      }
      const id = Number(body.id) || 0;
      const decision = String(body.decision || "").toLowerCase();
      const response = String(body.response || body.moderator_response || "").trim().slice(0, 500);
      if (!id) return json({ ok: false, error: "missing id" }, 400);
      if (decision !== "approved" && decision !== "denied") {
        return json({ ok: false, error: "invalid decision" }, 400);
      }
      if (decision === "denied" && !response) {
        return json({ ok: false, error: "a response is required when denying" }, 400);
      }
      const now = new Date().toISOString();
      // Race-safe: only a pending appeal can be decided.
      const upd = await db.prepare(
        "UPDATE ban_appeals SET status = ?, reviewed_at = ?, reviewed_by = ?, moderator_response = ? " +
        "WHERE id = ? AND status = 'pending'"
      ).bind(decision, now, uid, response, id).run();
      const changed = upd.meta && upd.meta.changes ? Number(upd.meta.changes) : 0;
      if (!changed) {
        const cur = await db.prepare("SELECT status FROM ban_appeals WHERE id = ?").bind(id).first().catch(() => null);
        if (!cur) return json({ ok: false, error: "not found" }, 404);
        return json({ ok: false, error: "already decided", status: cur.status }, 409);
      }
      const row = await db.prepare("SELECT * FROM ban_appeals WHERE id = ?").bind(id).first();
      if (decision === "approved" && row) {
        // Revoke via the existing mechanism (same columns Phase 2 uses).
        await db.prepare(
          "UPDATE bans SET revoked_at = ?, revoked_by = ? WHERE id = ? AND revoked_at IS NULL"
        ).bind(now, uid, row.ban_id).run().catch(() => {});
        await db.prepare(
          "INSERT INTO user_action_log (actor_uid, action) VALUES (?, ?)"
        ).bind(uid, "appeal:approved:" + row.user_id + ":" + id).run().catch(() => {});
        await notifyUser(db, context.env, row.user_id, "appeal", "Your ban appeal was approved — welcome back.");
      } else if (row) {
        await db.prepare(
          "INSERT INTO user_action_log (actor_uid, action) VALUES (?, ?)"
        ).bind(uid, "appeal:denied:" + row.user_id + ":" + id).run().catch(() => {});
        await notifyUser(db, context.env, row.user_id, "appeal", "Your ban appeal was reviewed.");
      }
      return json({ ok: true, id, decision });
    }

    return json({ ok: false, error: "unknown action" }, 400);
  } catch (err) {
    return json({ ok: false, error: String((err && err.message) || err) }, 500);
  }
}
