function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/* The statistics are asked for again every thirty seconds while the owner's
 * panel is on screen, and they are the same numbers each time - a visit has
 * to have happened for them to change. So they are remembered for a few
 * minutes, and the table is pruned at the same time rather than on every
 * request.
 *
 * Only the owner ever gets here, and there is only one of them, so there is
 * one remembered copy. */
const STATS_CACHE = { at: 0, data: null };
const STATS_TTL_MS = 300000;

export async function onRequestGet(context) {
  try {
    const url = new URL(context.request.url);
    const code = url.searchParams.get("code") || "";
    const user = (url.searchParams.get("user") || "").slice(0, 40);
    const secret = context.env.OWNER_PASSCODE || "";

    if (user) {
      const link = await context.env.wanted_vault.prepare(
        "SELECT discord_id FROM discord_links WHERE site_uid = ?"
      ).bind(user).first();
      const ownerId = context.env.OWNER_DISCORD_ID || "1016529053659967629";
      if (!link || !link.discord_id || link.discord_id !== ownerId) {
        return json({ error: "forbidden" }, 403);
      }
    } else if (!secret || code !== secret) {
      return json({ error: "forbidden" }, 403);
    }

    /* Served from the remembered copy while it is fresh. */
    if (STATS_CACHE.data && Date.now() - STATS_CACHE.at < STATS_TTL_MS) {
      return json(STATS_CACHE.data);
    }

    const env = context.env;
    const db = env.wanted_vault;

    /* The visits are read once, and the four summaries are made from what
       comes back.
     
       They used to be asked for one at a time - the totals, the days, the
       pages and the countries - and each one was a scan of the whole table,
       so one request for the statistics read the table four times over. The
       free tier counts rows read rather than queries, and this panel is
       open on the owner's screen, so it is asked for over and over again. */
    const since = new Date(Date.now() - 90 * 86400000).toISOString();
    const rows = await db.prepare(
      "SELECT ts, page, country, uid FROM analytics_visits WHERE ts >= ?"
    ).bind(since).all();
    const visits = rows.results || [];

    const seenVisitors = new Set();
    const days = new Map();
    const pages = new Map();
    const countries = new Map();

    for (const r of visits) {
      seenVisitors.add(r.uid);

      const day = String(r.ts || "").slice(0, 10);
      let d = days.get(day);
      if (!d) { d = { day, visits: 0, uniques: new Set() }; days.set(day, d); }
      d.visits++; d.uniques.add(r.uid);

      const page = r.page || "";
      let p = pages.get(page);
      if (!p) { p = { page, visits: 0, uniques: new Set() }; pages.set(page, p); }
      p.visits++; p.uniques.add(r.uid);

      const country = r.country || "";
      let c = countries.get(country);
      if (!c) { c = { country, visits: 0 }; countries.set(country, c); }
      c.visits++;
    }

    const totals = { visits: visits.length, uniques: seenVisitors.size };
    const perDay = {
      results: [...days.values()]
        .sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0))
        .slice(0, 14)
        .map((d) => ({ day: d.day, visits: d.visits, uniques: d.uniques.size })),
    };
    const perPage = {
      results: [...pages.values()]
        .sort((a, b) => b.visits - a.visits)
        .map((p) => ({ page: p.page, visits: p.visits, uniques: p.uniques.size })),
    };
    const perCountry = {
      results: [...countries.values()]
        .sort((a, b) => b.visits - a.visits)
        .map((c) => ({ country: c.country, visits: c.visits })),
    };

    const topTracks = await db.prepare(
      "SELECT track_id, COUNT(*) as n FROM votes GROUP BY track_id ORDER BY n DESC LIMIT 10"
    ).all();

    const recentReplies = await db.prepare(
      "SELECT track_id, user_name, body, created_at FROM replies ORDER BY id DESC LIMIT 10"
    ).all();

    const linked = await db.prepare(
      "SELECT site_uid, display_name, linked_at FROM discord_links ORDER BY linked_at DESC LIMIT 20"
    ).all();

    const wantedCounts = await db.prepare(
      "SELECT (SELECT COUNT(*) FROM tracks) as tracks, (SELECT COUNT(*) FROM votes) as votes, (SELECT COUNT(*) FROM replies) as replies"
    ).first();

    // Search analytics (last 30 days): top queries + queries with zero hits.
    let searchStats = { total: 0, top: [], noHits: [] };
    try {
      const total = await db.prepare(
        "SELECT COUNT(*) as c FROM search_logs WHERE ts >= datetime('now', '-30 days')"
      ).first();
      const top = await db.prepare(
        "SELECT q, COUNT(*) as n, AVG(results) as avg_hits FROM search_logs WHERE ts >= datetime('now', '-30 days') GROUP BY q ORDER BY n DESC LIMIT 15"
      ).all();
      const noHits = await db.prepare(
        "SELECT q, COUNT(*) as n, MAX(ts) as last_ts FROM search_logs WHERE ts >= datetime('now', '-30 days') AND results = 0 GROUP BY q ORDER BY n DESC LIMIT 15"
      ).all();
      searchStats = {
        total: total ? total.c : 0,
        top: top.results || [],
        noHits: noHits.results || [],
      };
    } catch (_) {}

    const data = {
      totals: totals,
      perDay: perDay.results,
      perPage: perPage.results,
      perCountry: perCountry.results,
      topTracks: topTracks.results,
      recentReplies: recentReplies.results,
      discordLinks: linked.results,
      wanted: wantedCounts,
      search: searchStats,
    };
    STATS_CACHE.data = data;
    STATS_CACHE.at = Date.now();
    return json(data);
  } catch (err) {
    return json({ error: String(err && err.message || err) }, 500);
  }
}
