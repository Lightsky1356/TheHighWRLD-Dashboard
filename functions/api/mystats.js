// GET /api/mystats — personal listening stats for the signed-in user.
// Reads the listens table (uid, track_id, seconds, ts). 401 when signed out.

import { getSessionUser } from "../_lib/auth.js";

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
    const totals = await db.prepare(
      "SELECT COUNT(*) AS plays, COALESCE(SUM(seconds),0) AS seconds, COUNT(DISTINCT track_id) AS unique_tracks, MIN(ts) AS first_ts, MAX(ts) AS last_ts FROM listens WHERE uid = ?"
    ).bind(uid).first();

    const top = await db.prepare(
      "SELECT track_id AS title, COUNT(*) AS plays, COALESCE(SUM(seconds),0) AS seconds FROM listens WHERE uid = ? GROUP BY track_id ORDER BY plays DESC LIMIT 10"
    ).bind(uid).all();

    const perDay = await db.prepare(
      "SELECT substr(ts,1,10) AS day, COUNT(*) AS plays FROM listens WHERE uid = ? AND ts >= datetime('now', '-30 days') GROUP BY day ORDER BY day ASC"
    ).bind(uid).all();

    // Day streak: consecutive UTC days with >=1 listen ending today/yesterday.
    let streak = 0;
    try {
      const days = await db.prepare(
        "SELECT DISTINCT substr(ts,1,10) AS day FROM listens WHERE uid = ? ORDER BY day DESC LIMIT 400"
      ).bind(uid).all();
      const set = new Set((days.results || []).map((r) => r.day));
      const d = new Date();
      const iso = (dt) => dt.toISOString().slice(0, 10);
      if (!set.has(iso(d))) d.setUTCDate(d.getUTCDate() - 1);
      while (set.has(iso(d))) { streak++; d.setUTCDate(d.getUTCDate() - 1); }
    } catch (_) {}

    // 30-day daily activity + 24h histogram (shared with profile panels).
    let activity30 = [], hours = new Array(24).fill(0);
    try {
      const act = await db.prepare(
        "SELECT substr(ts,1,10) AS day, COUNT(*) AS n FROM listens WHERE uid = ? AND ts >= datetime('now', '-30 days') GROUP BY day ORDER BY day ASC"
      ).bind(uid).all();
      activity30 = (act.results || []).map((r) => ({ day: r.day, n: r.n || 0 }));
    } catch (_) {}
    try {
      const hh = await db.prepare(
        "SELECT CAST(strftime('%H', ts) AS INTEGER) AS h, COUNT(*) AS n FROM listens WHERE uid = ? GROUP BY h"
      ).bind(uid).all();
      for (const r of (hh.results || [])) {
        const h = Number(r.h);
        if (h >= 0 && h < 24) hours[h] = r.n || 0;
      }
    } catch (_) {}

    // Monthly summaries (last 12 months) for the profile strip.
    let byMonth = [];
    try {
      const bm = await db.prepare(
        "SELECT substr(ts,1,7) AS m, COUNT(*) AS n FROM listens WHERE uid = ? AND ts >= datetime('now', '-12 months') GROUP BY m ORDER BY m ASC"
      ).bind(uid).all();
      byMonth = (bm.results || []).map((r) => ({ m: r.m, n: r.n || 0 }));
    } catch (_) {}

    return json({
      ok: true,
      totals: {
        plays: totals ? totals.plays : 0,
        seconds: totals ? totals.seconds : 0,
        unique_tracks: totals ? totals.unique_tracks : 0,
        first_ts: totals ? totals.first_ts : "",
        last_ts: totals ? totals.last_ts : "",
      },
      streak,
      activity30,
      hours,
      by_month: byMonth,
      top: (top.results || []).map((r, i) => ({
        rank: i + 1,
        title: r.title || "",
        plays: r.plays || 0,
        seconds: r.seconds || 0,
      })),
      per_day: perDay.results || [],
    });
  } catch (err) {
    return json({ ok: false, error: String((err && err.message) || err) }, 500);
  }
}
