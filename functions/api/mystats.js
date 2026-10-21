// GET /api/mystats — personal listening stats for the signed-in user.
// Reads the listens table (uid, track_id, seconds, ts). 401 when signed out.

import { getSessionUser } from "../_lib/auth.js";
import { listeningStats, streakFromDays } from "../_lib/listens-stats.js";

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
  try {
    const db = context.env.wanted_vault;
    const user = await getSessionUser(db, context.request);
    if (!user) return json({ ok: false, error: "not signed in" }, 401);

    const uid = user.uid;

    /* The listening summaries. Every one of these used to read the whole
       history - the totals, the most played tracks, the days, the hours of
       the day and the months - so opening your own statistics read it four
       times over. They are kept now, and read in one place. */
    const stats = await listeningStats(db, uid, { topLimit: 10 });

    // Day streak: consecutive UTC days with >=1 listen ending today/yesterday.
    let streak = 0;
    try { streak = streakFromDays(stats.days); } catch (_) {}

    const activity30 = stats.activity30 || [];
    const hours = stats.hours || new Array(24).fill(0);
    const byMonth = stats.byMonth || [];

    return json({
      ok: true,
      totals: {
        plays: stats.plays || 0,
        seconds: stats.seconds || 0,
        unique_tracks: stats.uniqueTracks || 0,
        first_ts: stats.firstTs || "",
        last_ts: stats.lastTs || "",
      },
      streak,
      activity30,
      hours,
      by_month: byMonth,
      top: (stats.top || []).map((r, i) => ({
        rank: i + 1,
        title: r.track_id || "",
        plays: r.n || 0,
        seconds: r.seconds || 0,
      })),
      per_day: (stats.daily || []).map((r) => ({ day: r.day, plays: r.n || 0 })),
    });
  } catch (err) {
    return json({ ok: false, error: String((err && err.message) || err) }, 500);
  }
}
