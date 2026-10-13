// Strikes + automatic escalation (Phase 6A).
// Staff-only issue/revoke; escalation runs server-side on every new strike:
// exact active-count match against an enabled rule (no repeat bans), skips
// stacking when an active ban already exists. Warnings/bans notify the user.
//
// GET  /api/strikes?action=list&uid=&status=&page=&limit=&user=   (staff)
// GET  /api/strikes?action=rules&user=                            (staff)
// POST /api/strikes { action:"issue", uid, reason, expires_at?, notes?, user }
// POST /api/strikes { action:"revoke", id, user }                 (staff)
// POST /api/strikes { action:"rule", id?, threshold, rule_action, duration, enabled, user } (staff)

import { getSessionUser } from "../_lib/auth.js";
import { createNotification } from "../_lib/notifications.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const PAGE_CAP = 20;
const RULE_ACTIONS = ["warn", "temp_ban", "perm_ban"];

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

function strikeJson(r, withNotes) {
  const now = new Date().toISOString();
  const out = {
    id: r.id,
    user_id: r.user_id,
    reason: r.reason || "",
    status: r.revoked_at ? "revoked" : (!r.expires_at || r.expires_at > now) ? "active" : "expired",
    created_at: r.created_at || "",
    expires_at: r.expires_at || "",
    revoked_at: r.revoked_at || "",
  };
  if (withNotes) {
    out.moderator_id = r.moderator_id || "";
    out.moderator_notes = r.moderator_notes || "";
    out.revoked_by = r.revoked_by || "";
  }
  return out;
}

async function activeStrikeCount(db, uid) {
  const r = await db.prepare(
    "SELECT COUNT(*) AS n FROM strikes WHERE user_id = ? AND revoked_at IS NULL " +
    "AND (expires_at IS NULL OR expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now'))"
  ).bind(uid).first().catch(() => null);
  return r ? r.n : 0;
}

async function notifyUser(db, env, uid, type, message) {
  await createNotification(db, env, uid, { type, actorName: "Staff", message });
}

async function audit(db, actorUid, text) {
  try {
    await db.prepare("INSERT INTO user_action_log (actor_uid, action) VALUES (?, ?)")
      .bind(String(actorUid).slice(0, 40), String(text).slice(0, 200)).run();
  } catch (_) {}
}

// Runs after every new strike. Exact-threshold match only (no repeats),
// skips when an active ban already exists (no stacking).
async function evaluateEscalation(db, env, uid) {
  const out = { escalated: false };
  try {
    const count = await activeStrikeCount(db, uid);
    const rule = await db.prepare(
      "SELECT * FROM escalation_rules WHERE enabled = 1 AND threshold = ? ORDER BY id ASC LIMIT 1"
    ).bind(count).first().catch(() => null);
    if (!rule) return out;
    const now = new Date().toISOString();
    const activeBan = await db.prepare(
      "SELECT id FROM bans WHERE user_id = ? AND revoked_at IS NULL " +
      "AND (expires_at IS NULL OR expires_at > ?) LIMIT 1"
    ).bind(uid, now).first().catch(() => null);
    if (activeBan) return { ...out, skipped: "active ban exists" };
    const nowIso = new Date().toISOString();
    if (rule.action === "warn") {
      await notifyUser(db, env, uid, "warning",
        "Warning from moderation: you now have " + count + " active strikes. Further violations may restrict your account.");
      await audit(db, "system", "escalation:warn:" + uid + ":rule:" + rule.id);
      return { escalated: true, action: "warn", rule: rule.id };
    }
    if (rule.action === "temp_ban" || rule.action === "perm_ban") {
      const secs = Number(rule.duration) || 0;
      const expires = rule.action === "perm_ban" || secs <= 0
        ? null
        : new Date(Date.now() + secs * 1000).toISOString();
      const ins = await db.prepare(
        "INSERT INTO bans (user_id, reason, moderator_id, moderator_notes, expires_at) VALUES (?, ?, 'system', ?, ?)"
      ).bind(uid, "Automatic escalation: " + count + " active strikes", "rule:" + rule.id, expires).run();
      const bid = ins.meta && ins.meta.last_row_id ? Number(ins.meta.last_row_id) : 0;
      await audit(db, "system", "escalation:ban:" + uid + ":rule:" + rule.id + ":" + bid);
      await notifyUser(db, env, uid, "ban",
        expires ? "Your account is temporarily restricted until " + expires.slice(0, 10) + "."
                : "Your account has been permanently restricted.");
      return { escalated: true, action: rule.action, rule: rule.id, ban_id: bid };
    }
  } catch (_) {}
  return out;
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestGet(context) {
  try {
    const db = context.env.wanted_vault;
    const url = new URL(context.request.url);
    const uid = await resolveSiteUid(db, context.request, url.searchParams.get("user") || "");
    if (!uid || !(await isStaff(db, uid, context.env))) {
      return json({ error: "forbidden" }, 403);
    }
    const action = url.searchParams.get("action") || "list";

    if (action === "rules") {
      const rows = await db.prepare("SELECT * FROM escalation_rules ORDER BY threshold ASC").all();
      return json({ ok: true, rules: rows.results || [] });
    }

    const target = (url.searchParams.get("uid") || "").slice(0, 40);
    const status = (url.searchParams.get("status") || "all").toLowerCase();
    const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
    const limit = Math.max(1, Math.min(PAGE_CAP, Number(url.searchParams.get("limit")) || PAGE_CAP));
    const now = new Date().toISOString();
    let where = "1 = 1";
    const args = [];
    if (target) { where += " AND user_id = ?"; args.push(target); }
    if (status === "active") where += " AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > '" + now + "')";
    else if (status === "revoked") where += " AND revoked_at IS NOT NULL";
    else if (status === "expired") where += " AND revoked_at IS NULL AND expires_at IS NOT NULL AND expires_at <= '" + now + "'";
    const total = await db.prepare("SELECT COUNT(*) AS n FROM strikes WHERE " + where).bind(...args).first();
    const rows = await db.prepare(
      "SELECT * FROM strikes WHERE " + where + " ORDER BY id DESC LIMIT ? OFFSET ?"
    ).bind(...args, limit, (page - 1) * limit).all();
    return json({
      ok: true, page, total: total ? total.n : 0,
      strikes: (rows.results || []).map((r) => strikeJson(r, true)),
    });
  } catch (err) {
    return json({ ok: false, error: String((err && err.message) || err) }, 500);
  }
}

export async function onRequestPost(context) {
  try {
    const db = context.env.wanted_vault;
    const body = await context.request.json().catch(() => ({}));
    const uid = await resolveSiteUid(db, context.request, body.user);
    if (!uid || !(await isStaff(db, uid, context.env))) {
      return json({ ok: false, error: "forbidden" }, 403);
    }
    const action = String(body.action || "");

    if (action === "issue") {
      const target = String(body.uid || "").slice(0, 40);
      const reason = String(body.reason || "").trim().slice(0, 200);
      const notes = String(body.notes || "").trim().slice(0, 500);
      let expires = null;
      if (body.expires_at) {
        const t = new Date(String(body.expires_at)).getTime();
        if (isNaN(t) || t <= Date.now()) return json({ ok: false, error: "invalid expires_at" }, 400);
        expires = new Date(t).toISOString();
      }
      if (!target) return json({ ok: false, error: "missing uid" }, 400);
      if (!reason) return json({ ok: false, error: "reason required" }, 400);
      const exists = await db.prepare(
        "SELECT uid FROM users WHERE uid = ? UNION SELECT site_uid AS uid FROM user_profiles WHERE site_uid = ? UNION SELECT site_uid AS uid FROM discord_links WHERE site_uid = ? LIMIT 1"
      ).bind(target, target, target).first().catch(() => null);
      if (!exists) return json({ ok: false, error: "user not found" }, 404);
      const ins = await db.prepare(
        "INSERT INTO strikes (user_id, reason, moderator_id, moderator_notes, expires_at) VALUES (?, ?, ?, ?, ?)"
      ).bind(target, reason, uid, notes, expires).run();
      const id = ins.meta && ins.meta.last_row_id ? Number(ins.meta.last_row_id) : 0;
      await audit(db, uid, "strike:issue:" + target + ":" + id);
      const esc = await evaluateEscalation(db, context.env, target);
      const row = await db.prepare("SELECT * FROM strikes WHERE id = ?").bind(id).first();
      return json({ ok: true, strike: row ? strikeJson(row, true) : { id }, escalation: esc });
    }

    if (action === "revoke") {
      const id = Number(body.id) || 0;
      if (!id) return json({ ok: false, error: "missing id" }, 400);
      const row = await db.prepare("SELECT * FROM strikes WHERE id = ?").bind(id).first();
      if (!row) return json({ ok: false, error: "not found" }, 404);
      if (row.revoked_at) return json({ ok: false, error: "already revoked" }, 409);
      const now = new Date().toISOString();
      await db.prepare("UPDATE strikes SET revoked_at = ?, revoked_by = ? WHERE id = ?")
        .bind(now, uid, id).run();
      await audit(db, uid, "strike:revoke:" + row.user_id + ":" + id);
      const updated = await db.prepare("SELECT * FROM strikes WHERE id = ?").bind(id).first();
      return json({ ok: true, strike: updated ? strikeJson(updated, true) : { id } });
    }

    if (action === "rule") {
      const threshold = Number(body.threshold) || 0;
      const ruleAction = String(body.rule_action || body.action_type || "");
      if (!threshold || threshold < 1 || threshold > 100) {
        return json({ ok: false, error: "invalid threshold" }, 400);
      }
      if (!RULE_ACTIONS.includes(ruleAction)) {
        return json({ ok: false, error: "invalid action" }, 400);
      }
      let duration = null;
      if (ruleAction === "temp_ban") {
        duration = Number(body.duration) || 0;
        if (duration <= 0 || duration > 31536000) return json({ ok: false, error: "invalid duration" }, 400);
      }
      const enabled = body.enabled === undefined ? 1 : (body.enabled ? 1 : 0);
      const id = Number(body.id) || 0;
      const now = new Date().toISOString();
      if (id) {
        await db.prepare(
          "UPDATE escalation_rules SET threshold = ?, action = ?, duration = ?, enabled = ?, updated_at = ? WHERE id = ?"
        ).bind(threshold, ruleAction, duration, enabled, now, id).run();
        await audit(db, uid, "escalation:rule:update:" + id);
        return json({ ok: true, id });
      }
      const ins = await db.prepare(
        "INSERT INTO escalation_rules (threshold, action, duration, enabled) VALUES (?, ?, ?, ?)"
      ).bind(threshold, ruleAction, duration, enabled).run();
      const nid = ins.meta && ins.meta.last_row_id ? Number(ins.meta.last_row_id) : 0;
      await audit(db, uid, "escalation:rule:create:" + nid);
      return json({ ok: true, id: nid });
    }

    return json({ ok: false, error: "unknown action" }, 400);
  } catch (err) {
    return json({ ok: false, error: String((err && err.message) || err) }, 500);
  }
}
