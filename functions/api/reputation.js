// Trust & reputation lookup (Phase 6C).
// GET /api/reputation                 -> own standing (session-derived only)
// GET /api/reputation?uid=X&user=    -> staff-only lookup of another member
// GET /api/reputation?action=limits   -> the published limit table
//
// Privacy: responses carry only first-party moderation aggregates. No IP,
// user agent or device data is read, stored or returned.

import { getSessionUser } from "../_lib/auth.js";
import { getReputation, LIMITS, NEW_ACCOUNT_THRESHOLD_DAYS } from "../_lib/reputation.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { "Content-Type": "application/json", ...CORS },
  });
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

function publicView(rep) {
  if (!rep) return null;
  return {
    score: rep.score,
    tier: rep.tier,
    computed_at: rep.computed_at,
    signals: rep.signals,
  };
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestGet(context) {
  try {
    const db = context.env.wanted_vault;
    const url = new URL(context.request.url);
    const me = await getSessionUser(db, context.request);
    if (!me) return json({ error: "sign in required" }, 401);

    if (url.searchParams.get("action") === "limits") {
      return json({ ok: true, limits: LIMITS, new_account_days: NEW_ACCOUNT_THRESHOLD_DAYS });
    }

    const requested = String(url.searchParams.get("uid") || "").slice(0, 40);
    let target = me.uid;
    let staffView = false;
    if (requested && requested !== me.uid) {
      if (!(await isStaff(db, me.uid, context.env))) return json({ error: "forbidden" }, 403);
      target = requested;
      staffView = true;
    }
    const rep = await getReputation(db, target);
    if (!rep) return json({ error: "not found" }, 404);
    return json({
      ok: true,
      uid: target,
      self: target === me.uid,
      staff_view: staffView,
      reputation: publicView(rep),
      limits: LIMITS,
    });
  } catch (err) {
    return json({ error: String((err && err.message) || err) }, 500);
  }
}
