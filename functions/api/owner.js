const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-HHeaders": "Content-Type",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

// Owner passcode secret - MUST match the OWNER_PASSCODE env var (dashboard secret).
// NOTE: this file is currently unused; the live check is /api/stats?code= vs OWNER_PASSCODE.
const CORRECT_PASSCODE = "Light";

// Simple in-memory store for unlocked state (persists via localStorage on client, DB on server)
var unlocked = false;
var unlockTs = 0;

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

// POST /api/owner/passcode — verify passcode
export async function onRequestPost(context) {
  try {
    const { env } = context;
    const body = await context.request.json().catch(() => ({}));
    const passcode = String(body.passcode || "").trim();

    if (passcode === CORRECT_PASSCODE) {
      // Unlock for 30 minutes
      unlocked = true;
      unlockTs = Date.now();
      return json({ ok: true, expiresIn: 30 * 60 * 1000 });
    }

    if (unlocked && Date.now() - unlockTs < 30 * 60 * 1000) {
      // Already unlocked, extend session
      unlockTs = Date.now();
      return json({ ok: true, extends: true, expiresIn: 30 * 60 * 1000 });
    }

    return json({ ok: false, reason: "invalid passcode" }, 403);
  } catch (e) {
    return json({ ok: false, error: String(e && e.message || e) }, 500);
  }
}

// GET /api/owner/analytics — return analytics when unlocked
export async function onRequestGet(context) {
  try {
    const { env } = context;

    if (!unlocked || Date.now() - unlockTs >= 30 * 60 * 1000) {
      // Auto-expire after 30 min
      unlocked = false;
      return json({ ok: false, reason: "session expired" }, 403);
    }

    const db = env.wanted_vault;

    /* The visits are read once, and the summaries are made from what comes
       back. They used to be asked for one at a time, and each one was a scan
       of the whole table - so one request for the dashboard read the table
       four times over, and the free tier counts rows read. */
    const rows = await db
      .prepare("SELECT ts, country, uid FROM analytics_visits")
      .all();
    const visits = rows.results || [];

    const seenVisitors = new Set();
    const days = new Map();
    const countries = new Map();
    for (const r of visits) {
      seenVisitors.add(r.uid);

      const day = String(r.ts || "").slice(0, 10);
      let d = days.get(day);
      if (!d) { d = { day, visits: 0, uniques: new Set() }; days.set(day, d); }
      d.visits++; d.uniques.add(r.uid);

      const country = r.country || "";
      let c = countries.get(country);
      if (!c) { c = { country, visits: 0 }; countries.set(country, c); }
      c.visits++;
    }

    const visitCount = { cnt: visits.length };
    const uniqueVisitors = { cnt: seenVisitors.size };
    const perDay = {
      results: [...days.values()]
        .sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0))
        .slice(0, 14)
        .map((d) => ({ day: d.day, visits: d.visits, uniques: d.uniques.size })),
    };
    const perCountry = {
      results: [...countries.values()]
        .sort((a, b) => b.visits - a.visits)
        .map((c) => ({ country: c.country, visits: c.visits })),
    };

    // Get top tracks from votes
    const topTracks = await db
      .prepare("SELECT track_id, COUNT(*) as n FROM votes GROUP BY track_id ORDER BY n DESC LIMIT 10")
      .all();

    return json({
      ok: true,
      visitCount: visitCount ? visitCount.cnt : 0,
      uniqueVisitors: uniqueVisitors ? uniqueVisitors.cnt : 0,
      perDay: perDay ? perDay.results : [],
      perCountry: perCountry ? perCountry.results : [],
      topTracks: topTracks ? topTracks.results : [],
    });
  } catch (e) {
    return json({ ok: false, error: String(e && e.message || e) }, 500);
  }
}