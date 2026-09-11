import { hubBroadcast, resolveSiteUid } from "../_lib/realtime.js";

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

const VALID_TYPES = ["WANTED", "SUGGESTION"];
const VALID_STATUSES = ["OPEN", "REVIEWING", "RESOLVED", "DISMISSED"];
const VALID_REASONS = [
  "Spam",
  "Duplicate",
  "Incorrect Information",
  "Harassment",
  "Inappropriate Content",
  "Copyright Concern",
  "Scam / Malicious Content",
  "Other",
];
// Reasons that are meaningless without an explanation.
const DETAILS_REQUIRED = ["Other", "Copyright Concern"];
const MAX_DETAILS = 1000;
const MIN_DETAILS_WHEN_REQUIRED = 10;
const RATE_LIMIT_MAX = 10;

async function isAdmin(db, uid, env) {
  if (!uid) return false;
  const link = await db.prepare("SELECT discord_id FROM discord_links WHERE site_uid = ?").bind(uid).first();
  const ownerDiscordId = env.OWNER_DISCORD_ID || "1016529053659967629";
  return !!(link && link.discord_id && link.discord_id === ownerDiscordId);
}

// Staff = site owner (same model as every other admin tool).
async function isStaff(db, uid, env) {
  return isAdmin(db, uid, env);
}

// Reporter identity is ALWAYS resolved server-side. The uid may come from a
// session or the legacy site-uid body field, but the Discord id + name come
// exclusively from the discord_links row. Returns null when not linked.
async function resolveReporter(db, request, bodyUser) {
  const uid = await resolveSiteUid(db, request, bodyUser);
  if (!uid) return null;
  const link = await db.prepare(
    "SELECT discord_id, display_name FROM discord_links WHERE site_uid = ?"
  ).bind(uid).first();
  if (!link || !link.discord_id) return null;
  return { uid, discordId: link.discord_id, name: link.display_name || "Discord User" };
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

export async function onRequestGet(context) {
  try {
    const db = context.env.wanted_vault;
    const url = new URL(context.request.url);
    const uid = await resolveSiteUid(db, context.request, url.searchParams.get("user") || "");
    if (!uid || !(await isStaff(db, uid, context.env))) return json({ error: "staff only" }, 403);
    const status = (url.searchParams.get("status") || "all").toUpperCase();
    const type = (url.searchParams.get("type") || "all").toUpperCase();
    const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
    const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get("limit") || "20", 10)));
    const offset = (page - 1) * limit;
    let where = "1=1";
    const binds = [];
    if (status !== "ALL" && VALID_STATUSES.includes(status)) {
      where += " AND status = ?";
      binds.push(status);
    }
    if (type !== "ALL" && VALID_TYPES.includes(type)) {
      where += " AND target_type = ?";
      binds.push(type);
    }
    const countRow = await db.prepare("SELECT COUNT(*) as n FROM reports WHERE " + where).bind(...binds).first();
    const total = countRow ? countRow.n : 0;
    const rows = await db.prepare(
      "SELECT " + REPORT_COLS + " FROM reports WHERE " + where + " ORDER BY id DESC LIMIT ? OFFSET ?"
    ).bind(...binds, limit, offset).all();
    return json({ ok: true, reports: rows.results.map(rowToJson), total, page, limit, pages: Math.ceil(total / limit) });
  } catch (err) {
    return json({ error: String((err && err.message) || err) }, 500);
  }
}

export async function onRequestPost(context) {
  const body = await context.request.json().catch(() => null);
  if (!body) return json({ error: "missing body" }, 400);
  const env = context.env;
  const db = env.wanted_vault;
  try {
    const reporter = await resolveReporter(db, context.request, body.user);
    if (!reporter) {
      return json({ error: "discord_link_required", message: "You must be connected with Discord to report content." }, 403);
    }
    const targetType = String(body.target_type || "").trim().toUpperCase();
    const targetId = String(body.target_id || "").trim().slice(0, 80);
    const reason = String(body.reason || "").trim().slice(0, 60);
    const details = String(body.details || "").trim().slice(0, MAX_DETAILS);
    if (!VALID_TYPES.includes(targetType)) return json({ error: "invalid target type" }, 400);
    if (!targetId) return json({ error: "invalid target" }, 400);
    if (!VALID_REASONS.includes(reason)) return json({ error: "a reason is required" }, 400);
    if (DETAILS_REQUIRED.includes(reason) && details.length < MIN_DETAILS_WHEN_REQUIRED) {
      return json({ error: "please add a few words of detail for this reason" }, 400);
    }

    // Snapshot the reported content at report time (titles can be edited later).
    let snapTitle = "";
    let snapBody = "";
    if (targetType === "WANTED") {
      const post = await db.prepare(
        "SELECT title, alt_name, description FROM wanted_posts WHERE id = ?"
      ).bind(Number(targetId) || 0).first();
      if (!post) return json({ error: "reported content not found" }, 404);
      snapTitle = post.title || "";
      snapBody = [post.alt_name, post.description].filter(Boolean).join("\n").slice(0, MAX_DETAILS);
    } else {
      const sug = await db.prepare(
        "SELECT title, description FROM suggestions_v2 WHERE id = ?"
      ).bind(Number(targetId) || 0).first();
      if (!sug) return json({ error: "reported content not found" }, 404);
      snapTitle = sug.title || "";
      snapBody = String(sug.description || "").slice(0, MAX_DETAILS);
    }

    // Duplicate protection: same reporter + item + reason.
    const dup = await db.prepare(
      "SELECT id FROM reports WHERE reporter_discord_id = ? AND target_type = ? AND target_id = ? AND reason = ?"
    ).bind(reporter.discordId, targetType, targetId, reason).first();
    if (dup) return json({ error: "duplicate", message: "This report has already been submitted." }, 409);

    // Server-side rate limit (per reporter, rolling hour).
    const recent = await db.prepare(
      "SELECT COUNT(*) as n FROM reports WHERE reporter_discord_id = ? AND created_at >= datetime('now','-1 hour')"
    ).bind(reporter.discordId).first();
    if (recent && recent.n >= RATE_LIMIT_MAX) {
      return json({ error: "slow down - too many reports recently" }, 429);
    }

    let ins;
    try {
      ins = await db.prepare(
        "INSERT INTO reports (target_type, target_id, reporter_discord_id, reporter_name, reason, details, snapshot_title, snapshot_body) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      ).bind(targetType, targetId, reporter.discordId, reporter.name, reason, details, snapTitle.slice(0, 120), snapBody).run();
    } catch (e) {
      // UNIQUE constraint race (two tabs at once) -> treat as duplicate.
      if (String((e && e.message) || e).toLowerCase().indexOf("unique") >= 0) {
        return json({ error: "duplicate", message: "This report has already been submitted." }, 409);
      }
      throw e;
    }
    const reportId = ins.meta && ins.meta.last_row_id ? Number(ins.meta.last_row_id) : 0;

    await hubBroadcast(env, {
      type: "report:created",
      report: { id: reportId, target_type: targetType, target_id: targetId, reason, status: "OPEN" },
    });

    notifyStaff(env, {
      id: reportId,
      targetType, targetId, reason, details,
      snapshotTitle: snapTitle,
      reporterName: reporter.name,
      reporterDiscordId: reporter.discordId,
    }).catch(() => {});

    return json({ ok: true, id: reportId });
  } catch (err) {
    return json({ error: String((err && err.message) || err) }, 500);
  }
}

async function notifyStaff(env, r) {
  const webhook = env.REPORTS_WEBHOOK_URL || "";
  if (!webhook) {
    console.log(JSON.stringify({ level: "info", msg: "report created (no webhook configured)", id: r.id }));
    return;
  }
  const typeLabel = r.targetType === "WANTED" ? "Wanted Vault" : "Suggestion";
  const now = new Date().toISOString();
  const payload = {
    embeds: [{
      title: "New TheHighWRLD Report",
      description: ":rotating_light: A new report needs review.",
      color: 15158332,
      fields: [
        { name: "Type", value: typeLabel, inline: true },
        { name: "Reason", value: r.reason || "-", inline: true },
        { name: "Status", value: "OPEN", inline: true },
        { name: "Reported Content", value: (r.snapshotTitle || "(untitled)").slice(0, 256) },
        { name: "Details", value: (r.details || "—").slice(0, 1024) },
        { name: "Reported By", value: (r.reporterName || "Unknown") + " (`" + r.reporterDiscordId + "`)", inline: false },
        { name: "Report ID", value: String(r.id), inline: true },
        { name: "Submitted", value: now, inline: true },
      ],
      timestamp: now,
    }],
  };
  try {
    const resp = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) console.log(JSON.stringify({ level: "warn", msg: "report webhook failed", status: resp.status, id: r.id }));
  } catch (err) {
    console.log(JSON.stringify({ level: "warn", msg: "report webhook error", error: String((err && err.message) || err), id: r.id }));
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}
