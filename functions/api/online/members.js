/* ==========================================================================
   Online now — the members on the site, right now
   GET /api/online/members → { ok, members: [{uid, handle, name, avatar, level, xp}], guests }

   The rows in online_visitors are a per-tab record with a 90-second TTL.
   Only signed-in members are listed by name — a guest is a count, not a
   person. Levels come from the xp table when it exists; absence of it is
   not an error, it just means level 1 everywhere.
   ========================================================================== */

import { levelFor } from "../../_lib/xp.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestGet(context) {
  const { env } = context;
  const db = env.wanted_vault;
  if (!db) return json({ ok: false, error: "no db" }, 500);

  try {
    const now = new Date().toISOString();
    /* Live rows only: signed in, last seen within 90 seconds. */
    const rows = await db.prepare(
      "SELECT visitor_id FROM online_visitors " +
      "WHERE authed = 1 AND last_seen >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-90 seconds')"
    ).bind().all();

    const ids = (rows.results || []).map((r) => r.visitor_id).filter(Boolean);
    const members = [];
    for (const uid of ids) {
      if (!/^[A-Za-z0-9_-]{4,64}$/.test(uid)) continue;
      let name = "", avatar = "", handle = "";
      try {
        const u = await db.prepare("SELECT name, avatar FROM users WHERE uid = ?").bind(uid).first();
        if (u) { name = u.name || ""; avatar = u.avatar || ""; handle = u.name || ""; }
      } catch (_) {}
      try {
        const p = await db.prepare("SELECT name, avatar FROM user_profiles WHERE site_uid = ?").bind(uid).first();
        if (p) { name = p.name || name; avatar = p.avatar || avatar; }
      } catch (_) {}
      try {
        const d = await db.prepare("SELECT display_name, avatar FROM discord_links WHERE site_uid = ?").bind(uid).first();
        if (d) { name = d.display_name || name; avatar = d.avatar || avatar; }
      } catch (_) {}
      if (!name) continue;
      let level = 1, xp = 0;
      try {
        const x = await db.prepare("SELECT xp, level FROM xp WHERE user_id = ?").bind(uid).first();
        if (x) { xp = x.xp || 0; level = x.level || levelFor(xp); }
      } catch (_) { /* the xp table may not exist yet - level 1 for everyone */ }
      members.push({ uid, handle: String(handle || name).slice(0, 64), name: String(name).slice(0, 64), avatar: String(avatar || "").slice(0, 512), level, xp });
    }

    /* Most level first, like the tracker. */
    members.sort((a, b) => (b.level - a.level) || (b.xp - a.xp));

    /* The guest count for the footer of the popover. */
    let guests = 0;
    try {
      const g = await db.prepare(
        "SELECT COUNT(*) AS n FROM online_visitors WHERE authed = 0 AND last_seen >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-90 seconds')"
      ).first();
      guests = (g && g.n) || 0;
    } catch (_) {}

    return json({ ok: true, members, guests, total: members.length });
  } catch (e) {
    return json({ ok: false, error: String((e && e.message) || e) }, 500);
  }
}
