function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

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

    const env = context.env;
    const db = env.wanted_vault;

    // Bound table growth so owner stats scans stay cheap: keep 90 days.
    try {
      await db.prepare("DELETE FROM analytics_visits WHERE ts < datetime('now', '-90 days')").run();
    } catch (_) {}

    const totals = await db.prepare(
      "SELECT COUNT(*) as visits, COUNT(DISTINCT uid) as uniques FROM analytics_visits"
    ).first();

    const perDay = await db.prepare(
      "SELECT substr(ts,1,10) as day, COUNT(*) as visits, COUNT(DISTINCT uid) as uniques FROM analytics_visits GROUP BY day ORDER BY day DESC LIMIT 14"
    ).all();

    const perPage = await db.prepare(
      "SELECT page, COUNT(*) as visits, COUNT(DISTINCT uid) as uniques FROM analytics_visits GROUP BY page ORDER BY visits DESC"
    ).all();

    const perCountry = await db.prepare(
      "SELECT country, COUNT(*) as visits FROM analytics_visits GROUP BY country ORDER BY visits DESC"
    ).all();

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

    return json({
      totals: totals,
      perDay: perDay.results,
      perPage: perPage.results,
      perCountry: perCountry.results,
      topTracks: topTracks.results,
      recentReplies: recentReplies.results,
      discordLinks: linked.results,
      wanted: wantedCounts,
    });
  } catch (err) {
    return json({ error: String(err && err.message || err) }, 500);
  }
}
