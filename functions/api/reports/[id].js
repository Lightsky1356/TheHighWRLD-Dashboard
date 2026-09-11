import { hubBroadcast, resolveSiteUid } from "../../_lib/realtime.js";

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

const VALID_STATUSES = ["OPEN", "REVIEWING", "RESOLVED", "DISMISSED"];
const MAX_NOTES = 1000;

async function isStaff(db, uid, env) {
  if (!uid) return false;
  const link = await db.prepare("SELECT discord_id FROM discord_links WHERE site_uid = ?").bind(uid).first();
  const ownerDiscordId = env.OWNER_DISCORD_ID || "1016529053659967629";
  return !!(link && link.discord_id && link.discord_id === ownerDiscordId);
}

function rowToJson(r) {
  return {
    id: r.id,
    targetType: r.target_type,
    targetId: r.target_id,
    reporterDiscordId: r.reporter_discord_id,
    reporterName: r.reporter_name,
    reason: r.reason,
    details: r.details,
    snapshotTitle: r.snapshot_title,
    snapshotBody: r.snapshot_body,
    status: r.status,
    notes: r.notes,
    createdAt: r.created_at,
    reviewedAt: r.reviewed_at,
    reviewedBy: r.reviewed_by,
  };
}

const REPORT_COLS = "id, target_type, target_id, reporter_discord_id, reporter_name, reason, details, snapshot_title, snapshot_body, status, notes, created_at, reviewed_at, reviewed_by";

function reportIdFromUrl(url) {
  const parts = new URL(url).pathname.split("/").filter(Boolean);
  return Number(parts[parts.length - 1]) || 0;
}

export async function onRequestGet(context) {
  try {
    const db = context.env.wanted_vault;
    const url = new URL(context.request.url);
    const uid = await resolveSiteUid(db, context.request, url.searchParams.get("user") || "");
    if (!uid || !(await isStaff(db, uid, context.env))) return json({ error: "staff only" }, 403);
    const id = reportIdFromUrl(context.request.url);
    if (!id) return json({ error: "invalid id" }, 400);
    const r = await db.prepare("SELECT " + REPORT_COLS + " FROM reports WHERE id = ?").bind(id).first();
    if (!r) return json({ error: "not found" }, 404);
    return json({ ok: true, report: rowToJson(r) });
  } catch (err) {
    return json({ error: String((err && err.message) || err) }, 500);
  }
}

export async function onRequestPatch(context) {
  const body = await context.request.json().catch(() => null);
  if (!body) return json({ error: "missing body" }, 400);
  try {
    const db = context.env.wanted_vault;
    const uid = await resolveSiteUid(db, context.request, body.user);
    if (!uid || !(await isStaff(db, uid, context.env))) return json({ error: "staff only" }, 403);
    const id = reportIdFromUrl(context.request.url);
    if (!id) return json({ error: "invalid id" }, 400);
    const existing = await db.prepare("SELECT id FROM reports WHERE id = ?").bind(id).first();
    if (!existing) return json({ error: "not found" }, 404);

    const sets = [];
    const vals = [];
    if (body.status !== undefined) {
      const st = String(body.status || "").toUpperCase();
      if (!VALID_STATUSES.includes(st)) return json({ error: "invalid status" }, 400);
      sets.push("status = ?");
      vals.push(st);
      sets.push("reviewed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')");
      const link = await db.prepare("SELECT discord_id FROM discord_links WHERE site_uid = ?").bind(uid).first();
      sets.push("reviewed_by = ?");
      vals.push((link && link.discord_id) || "");
    }
    if (body.notes !== undefined) {
      const notes = String(body.notes || "").slice(0, MAX_NOTES);
      sets.push("notes = ?");
      vals.push(notes);
    }
    if (!sets.length) return json({ error: "nothing to update" }, 400);
    vals.push(id);
    await db.prepare("UPDATE reports SET " + sets.join(", ") + " WHERE id = ?").bind(...vals).run();
    await hubBroadcast(context.env, { type: "report:updated", reportId: id });
    const r = await db.prepare("SELECT " + REPORT_COLS + " FROM reports WHERE id = ?").bind(id).first();
    return json({ ok: true, report: rowToJson(r) });
  } catch (err) {
    return json({ error: String((err && err.message) || err) }, 500);
  }
}

export async function onRequestDelete(context) {
  try {
    const db = context.env.wanted_vault;
    const url = new URL(context.request.url);
    const body = await context.request.json().catch(() => ({}));
    const user = body.user || url.searchParams.get("user") || "";
    const uid = await resolveSiteUid(db, context.request, user);
    if (!uid || !(await isStaff(db, uid, context.env))) return json({ error: "staff only" }, 403);
    const id = reportIdFromUrl(context.request.url);
    if (!id) return json({ error: "invalid id" }, 400);
    await db.prepare("DELETE FROM reports WHERE id = ?").bind(id).run();
    await hubBroadcast(context.env, { type: "report:deleted", reportId: id });
    return json({ ok: true });
  } catch (err) {
    return json({ error: String((err && err.message) || err) }, 500);
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}
