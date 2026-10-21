import { getSessionUser } from "../_lib/auth.js";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

/* The prune runs on a timer of its own, not on every visit. */
let lastPruneAt = 0;
const PRUNE_EVERY_MS = 10 * 60 * 1000;

function clamp(v, n) {
  return String(v || "").replace(/[^\x20-\x7E]/g, "").slice(0, n);
}

export async function onRequestPost(context) {
  try {
    const body = await context.request.json().catch(() => ({}));
    const env = context.env;
    const uid = clamp(body.uid, 40) || "anon";
    const page = clamp(body.page, 40);
    const ua = clamp(body.ua, 300);
    const ip = context.request.headers.get("CF-Connecting-IP") || "";
    const country = context.request.headers.get("CF-IPCountry") || "";
    let authed = false;
    try {
      const session = await getSessionUser(env.wanted_vault, context.request);
      if (session && session.uid) authed = true;
      else {
        /* Whether this uid belongs to a linked Discord account does not change
           between visits, and the answer was read from the database on every
           single one of them. It is remembered per uid for the life of the
           isolate instead: one read the first time a uid is seen, none after
           that. */
        let linked = linkedCache.get(uid);
        if (linked === undefined) {
          const link = await env.wanted_vault.prepare(
            "SELECT display_name FROM discord_links WHERE site_uid = ?"
          ).bind(uid).first();
          linked = !!(link && link.display_name);
          linkedCache.set(uid, linked);
        }
        if (linked) authed = true;
      }
    } catch (_) {}
    if (!authed) return json({ ok: true, tracked: false });
    await env.wanted_vault.prepare(
      "INSERT INTO analytics_visits (uid, page, ua, ip, country, ts) VALUES (?, ?, ?, ?, ?, ?)"
    ).bind(uid, page, ua, ip, country, new Date().toISOString()).run();

    /* The table is pruned here rather than by whoever reads it.
     *
     * It used to be pruned only when the owner's dashboard was opened, so it
     * held every visit ever made - and it grew for as long as the site was
     * up, for a report about the last few months. Ninety days is what the
     * dashboard shows, so that is what is kept.
     *
     * On a timer of its own: a prune on every visit would be a cost on every
     * visit, and the index on the timestamp makes it a range delete rather
     * than a scan of the whole table. */
    const now = Date.now();
    if (now - lastPruneAt > PRUNE_EVERY_MS) {
      lastPruneAt = now;
      try {
        await env.wanted_vault.prepare(
          "DELETE FROM analytics_visits WHERE ts < ?"
        ).bind(new Date(now - 90 * 86400000).toISOString()).run();
      } catch (_) {}
    }
    return json({ ok: true });
  } catch (err) {
    return json({ error: String(err && err.message || err) }, 500);
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
