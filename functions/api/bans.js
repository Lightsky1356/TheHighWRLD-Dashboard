// Ban management API (Phase 2: moderator UI backend).
// Staff = site owner (same single-role model as reports.js: discord ID match).
// Every endpoint verifies staff server-side; normal users get 403.
//
// GET  /api/bans?action=list&status=active|all&q=&page=&limit=&user=
// GET  /api/bans?action=history&uid=<target>&user=
// GET  /api/bans?action=status&uid=<target>&user=
// GET  /api/bans?action=search&username=<q>&user=
// POST /api/bans { action:"ban", uid, duration, reason, notes, user }
// POST /api/bans { action:"revoke", id, user }

import { getSessionUser } from "../_lib/auth.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const DURATIONS = {
  "3600": "1 hour",
  "21600": "6 hours",
  "43200": "12 hours",
  "86400": "1 day",
  "259200": "3 days",
  "604800": "7 days",
  "2592000": "30 days",
  "permanent": "Permanent",
};

const PAGE_CAP = 20;

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

async function staffOr403(db, request, env, bodyUser) {
  const uid = await resolveSiteUid(db, request, bodyUser);
  if (!uid || !(await isStaff(db, uid, env))) return { error: json({ error: "forbidden" }, 403) };
  return { uid };
}

async function displayName(db, uid) {
  try {
    const p = await db.prepare("SELECT name FROM user_profiles WHERE site_uid = ?").bind(uid).first();
    if (p && p.name) return p.name;
    const l = await db.prepare("SELECT display_name FROM discord_links WHERE site_uid = ?").bind(uid).first();
    if (l && l.display_name) return l.display_name;
    const u = await db.prepare("SELECT name FROM users WHERE uid = ?").bind(uid).first();
    if (u && u.name) return u.name;
  } catch (_) {}
  return String(uid || "").slice(0, 12) + "…";
}

function banJson(r, withNotes) {
  const now = new Date().toISOString();
  const active = !r.revoked_at && (!r.expires_at || r.expires_at > now);
  const out = {
    id: r.id,
    user_id: r.user_id,
    reason: r.reason || "",
    status: r.revoked_at ? "revoked" : active ? "active" : "expired",
    permanent: !r.expires_at,
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

async function audit(db, actorUid, text) {
  try {
    await db.prepare("INSERT INTO user_action_log (actor_uid, action) VALUES (?, ?)")
      .bind(String(actorUid).slice(0, 40), String(text).slice(0, 200)).run();
  } catch (_) {}
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestGet(context) {
  try {
    const db = context.env.wanted_vault;
    const url = new URL(context.request.url);
    const action = url.searchParams.get("action") || "list";
    const gate = await staffOr403(db, context.request, context.env, url.searchParams.get("user") || "");
    if (gate.error) return gate.error;

    if (action === "search") {
      const q = (url.searchParams.get("username") || "").trim().slice(0, 40).toLowerCase();
      if (q.length < 2) return json({ ok: true, users: [] });
      const like = "%" + q.replace(/([%_\\])/g, "\\$1") + "%";
      const rows = await db.prepare(
        "SELECT site_uid AS uid, name, 'profile' AS src FROM user_profiles WHERE LOWER(name) LIKE ? ESCAPE '\\' LIMIT 8"
      ).bind(like).all().catch(() => ({ results: [] }));
      const seen = new Set();
      const out = [];
      for (const r of (rows.results || [])) {
        if (!r.uid || seen.has(r.uid)) continue;
        seen.add(r.uid);
        out.push({ uid: r.uid, name: r.name || r.uid });
      }
      if (out.length < 8) {
        const dl = await db.prepare(
          "SELECT site_uid AS uid, display_name AS name FROM discord_links WHERE LOWER(display_name) LIKE ? ESCAPE '\\' LIMIT 8"
        ).bind(like).all().catch(() => ({ results: [] }));
        for (const r of ((dl.results || []))) {
          if (!r.uid || seen.has(r.uid) || out.length >= 8) continue;
          seen.add(r.uid);
          out.push({ uid: r.uid, name: r.name || r.uid });
        }
      }
      return json({ ok: true, users: out });
    }

    if (action === "status" || action === "history") {
      const target = (url.searchParams.get("uid") || "").slice(0, 40);
      if (!target) return json({ ok: false, error: "missing uid" }, 400);
      const rows = await db.prepare(
        "SELECT * FROM bans WHERE user_id = ? ORDER BY id DESC LIMIT 50"
      ).bind(target).all();
      const all = (rows.results || []).map((r) => banJson(r, true));
      const active = all.find((b) => b.status === "active") || null;
      const name = await displayName(db, target);
      if (action === "status") return json({ ok: true, uid: target, name, active });
      return json({ ok: true, uid: target, name, active, history: all });
    }

    // action=list (default): active bans, or all with search + pagination.
    const status = url.searchParams.get("status") || "active";
    const q = (url.searchParams.get("q") || "").trim().slice(0, 40);
    const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
    const limit = Math.max(1, Math.min(PAGE_CAP, Number(url.searchParams.get("limit")) || PAGE_CAP));
    const now = new Date().toISOString();
    let where = "revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)";
    const args = [now];
    if (status === "all") {
      where = "1 = 1";
      args.pop();
    }
    if (q) {
      where += " AND (user_id LIKE ? ESCAPE '\\' OR reason LIKE ? ESCAPE '\\')";
      const like = "%" + q.replace(/([%_\\])/g, "\\$1") + "%";
      args.push(like, like);
    }
    const total = await db.prepare("SELECT COUNT(*) AS n FROM bans WHERE " + where).bind(...args).first();
    const rows = await db.prepare(
      "SELECT * FROM bans WHERE " + where + " ORDER BY id DESC LIMIT ? OFFSET ?"
    ).bind(...args, limit, (page - 1) * limit).all();
    const items = [];
    const need = {};
    for (const r of (rows.results || [])) {
      need[r.user_id] = 1;
      if (r.moderator_id) need[r.moderator_id] = 1;
    }
    const names = {};
    const uids = Object.keys(need);
    if (uids.length) {
      try {
        const ph = uids.map(() => "?").join(",");
        const pr = await db.prepare(
          "SELECT site_uid AS uid, name FROM user_profiles WHERE site_uid IN (" + ph + ")"
        ).bind(...uids).all();
        for (const r of (pr.results || [])) if (r.name) names[r.uid] = r.name;
        const missing = uids.filter((u) => !names[u]);
        if (missing.length) {
          const ph2 = missing.map(() => "?").join(",");
          const dl = await db.prepare(
            "SELECT site_uid AS uid, display_name AS name FROM discord_links WHERE site_uid IN (" + ph2 + ")"
          ).bind(...missing).all();
          for (const r of ((dl.results || []))) if (r.name) names[r.uid] = r.name;
        }
      } catch (_) {}
    }
    for (const r of (rows.results || [])) {
      const b = banJson(r, true);
      b.name = names[r.user_id] || String(r.user_id || "").slice(0, 12) + "…";
      b.moderator_name = (r.moderator_id && names[r.moderator_id]) || "";
      items.push(b);
    }
    return json({ ok: true, page, total: total ? total.n : 0, bans: items });
  } catch (err) {
    return json({ ok: false, error: String((err && err.message) || err) }, 500);
  }
}

export async function onRequestPost(context) {
  try {
    const db = context.env.wanted_vault;
    const body = await context.request.json().catch(() => ({}));
    const gate = await staffOr403(db, context.request, context.env, body.user);
    if (gate.error) return gate.error;
    const modUid = gate.uid;
    const action = String(body.action || "");

    if (action === "ban") {
      const target = String(body.uid || "").slice(0, 40);
      const duration = String(body.duration || "");
      const reason = String(body.reason || "").trim().slice(0, 200);
      const notes = String(body.notes || body.moderator_notes || "").trim().slice(0, 500);
      if (!target) return json({ ok: false, error: "missing uid" }, 400);
      if (!reason) return json({ ok: false, error: "reason required" }, 400);
      if (!(duration in DURATIONS)) return json({ ok: false, error: "invalid duration" }, 400);
      const targetRow = await db.prepare(
        "SELECT uid FROM users WHERE uid = ? UNION SELECT site_uid AS uid FROM user_profiles WHERE site_uid = ? UNION SELECT site_uid AS uid FROM discord_links WHERE site_uid = ? LIMIT 1"
      ).bind(target, target, target).first().catch(() => null);
      if (!targetRow) return json({ ok: false, error: "user not found" }, 404);
      const now = new Date().toISOString();
      const existing = await db.prepare(
        "SELECT id FROM bans WHERE user_id = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?) LIMIT 1"
      ).bind(target, now).first().catch(() => null);
      if (existing) {
        return json({ ok: false, error: "already banned", ban_id: existing.id }, 409);
      }
      const expires = duration === "permanent"
        ? null
        : new Date(Date.now() + Number(duration) * 1000).toISOString();
      const ins = await db.prepare(
        "INSERT INTO bans (user_id, reason, moderator_id, moderator_notes, expires_at) VALUES (?, ?, ?, ?, ?)"
      ).bind(target, reason, modUid, notes, expires).run();
      const id = ins.meta && ins.meta.last_row_id ? Number(ins.meta.last_row_id) : 0;
      await audit(db, modUid, "ban:create:" + target + ":" + id);
      const row = await db.prepare("SELECT * FROM bans WHERE id = ?").bind(id).first();
      return json({ ok: true, ban: row ? banJson(row, true) : { id } });
    }

    if (action === "revoke") {
      const id = Number(body.id) || 0;
      if (!id) return json({ ok: false, error: "missing id" }, 400);
      const row = await db.prepare("SELECT * FROM bans WHERE id = ?").bind(id).first();
      if (!row) return json({ ok: false, error: "not found" }, 404);
      if (row.revoked_at) return json({ ok: false, error: "already revoked" }, 409);
      const now = new Date().toISOString();
      await db.prepare(
        "UPDATE bans SET revoked_at = ?, revoked_by = ? WHERE id = ?"
      ).bind(now, modUid, id).run();
      await audit(db, modUid, "ban:revoke:" + row.user_id + ":" + id);
      const updated = await db.prepare("SELECT * FROM bans WHERE id = ?").bind(id).first();
      return json({ ok: true, ban: updated ? banJson(updated, true) : { id } });
    }

    return json({ ok: false, error: "unknown action" }, 400);
  } catch (err) {
    return json({ ok: false, error: String((err && err.message) || err) }, 500);
  }
}
