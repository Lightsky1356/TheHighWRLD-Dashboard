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

// Owner passcode secret - MUST match wrangler.toml OWNER_PASSCODE env var
const CORRECT_PASSCODE = "MRIGHTSKY1356"; // <--- CHANGE THIS to your secret

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

    // Get visit counts
    const visitCount = await db
      .prepare("SELECT COUNT(*) AS cnt FROM analytics_visits")
      .first();

    // Get unique visitors
    const uniqueVisitors = await db
      .prepare("SELECT COUNT(DISTINCT uid) AS cnt FROM analytics_visits")
      .first();

    // Get per-day stats (last 14 days)
    const perDay = await db
      .prepare(
        "SELECT substr(ts,1,10) as day, COUNT(*) as visits, COUNT(DISTINCT uid) as uniques FROM analytics_visits GROUP BY day ORDER BY day DESC LIMIT 14"
      ).all();

    // Get per-country stats
    const perCountry = await db
      .prepare("SELECT country, COUNT(*) as visits FROM analytics_visits GROUP BY country ORDER BY visits DESC")
      .all();

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