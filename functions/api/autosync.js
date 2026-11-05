// The owner's Auto Sync switch.
//
// GET   public - whether the track-sync pipeline is allowed to write tracks.js
//                on its own schedule. The scheduled GitHub workflow asks this
//                before doing anything, so the answer here is the single
//                source of truth. No row yet means ENABLED (the pipeline has
//                been running since before this switch existed).
// POST  owner-gated, same OWNER_PASSCODE as /api/announcements and
//       /api/stats?code= - flips the switch. The passcode arrives from the
//       client's localStorage (script.js stores it after a successful
//       unlock), so the owner never types it twice.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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
  try {
    const db = context.env.wanted_vault;
    /* If the table has not arrived yet (migrations behind the deploy), report
       enabled - a broken switch must never silently stop the pipeline. */
    let row = null;
    try {
      row = await db
        .prepare("SELECT value, updated_at FROM site_flags WHERE name = 'autosync'")
        .first();
    } catch (_) {
      row = null;
    }
    return json({
      ok: true,
      enabled: row ? String(row.value).trim() !== "0" : true,
      updated_at: row ? row.updated_at : null,
    });
  } catch (e) {
    return json({ ok: false, error: String((e && e.message) || e) }, 500);
  }
}

export async function onRequestPost(context) {
  try {
    const secret = context.env.OWNER_PASSCODE || "";
    const body = await context.request.json().catch(() => ({}));
    const code = String(body.code || "");
    if (!secret || code !== secret) {
      return json({ ok: false, error: "forbidden" }, 403);
    }
    const enabled = body.enabled ? 1 : 0;
    const db = context.env.wanted_vault;
    await db
      .prepare(
        "INSERT INTO site_flags (name, value, updated_at) VALUES ('autosync', ?1, strftime('%Y-%m-%dT%H:%M:%fZ','now')) " +
          "ON CONFLICT(name) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
      )
      .bind(String(enabled))
      .run();
    return json({ ok: true, enabled: enabled === 1 });
  } catch (e) {
    return json({ ok: false, error: String((e && e.message) || e) }, 500);
  }
}
