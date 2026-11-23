/* ==========================================================================
   XP — the read side of the leaderboard.
   GET /api/xp            → { ok, me, board, total }
   GET /api/xp?limit=100  → narrower board

   Public, read-only, one round trip. `me` is null when signed out (no shame
   in signed-out: the board is public). The board is cached a few seconds in
   isolate memory because it is read on every open of the panel and must
   not fan out to 100 member rows per hit.
   ========================================================================== */

import { ensureXpTable, memberStanding, leaderboard, memberCount, levelFor, levelProgress } from "../_lib/xp.js";
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

let cached = null;
let cachedAt = 0;
const TTL_MS = 5000;

async function board(db) {
  if (cached && Date.now() - cachedAt < TTL_MS) return cached;
  const [alltime, week, total] = await Promise.all([
    leaderboard(db, "alltime", 100),
    leaderboard(db, "week", 100),
    memberCount(db),
  ]);
  cached = { alltime: alltime.members || [], week: week.members || [], total: total || 0 };
  cachedAt = Date.now();
  return cached;
}

/* Profile pages ask with a /@handle. Resolve it to the site uid the xp table
   is keyed by, otherwise a member with real XP reads back as zero. A value
   that is already a uid simply falls through. */
async function resolveHandle(db, handle) {
  if (!handle) return "";
  try {
    const steps = [
      "SELECT uid AS id FROM users WHERE LOWER(name) = LOWER(?) LIMIT 1",
      "SELECT site_uid AS id FROM user_profiles WHERE LOWER(name) = LOWER(?) LIMIT 1",
      "SELECT site_uid AS id FROM discord_links WHERE LOWER(display_name) = LOWER(?) LIMIT 1",
    ];
    for (const sql of steps) {
      const row = await db.prepare(sql).bind(handle).first();
      if (row && row.id) return row.id;
    }
  } catch (_) {}
  return handle;
}

export async function onRequestGet(context) {
  const { env, request } = context;
  const db = env.wanted_vault;
  if (!db) return json({ ok: false, error: "no db" }, 500);

  const b = await board(db);

  let me = null;
  try {
    /* A ?user= parameter asks for that member's standing (profile pages use
       it). Without one, the signed-in member is the subject, as before. */
    const asked = String(new URL(request.url).searchParams.get("user") || "").trim().slice(0, 64);
    let subject = asked ? await resolveHandle(db, asked) : "";
    if (!subject) {
      const session = await getSessionUser(db, request);
      subject = session && session.uid ? session.uid : "";
    }
    if (subject) {
      const st = await memberStanding(db, subject);
      const allIdx = b.alltime.findIndex((m) => m.uid === subject);
      const weekIdx = b.week.findIndex((m) => m.uid === subject);
      me = {
        uid: subject,
        name: (asked && st.name) ? st.name : (asked ? subject : "You"),
        xp: st.xp,
        level: st.level || levelFor(st.xp),
        week_xp: st.week_xp,
        levelProgress: levelProgress(st.xp),
        rankAll: allIdx >= 0 ? allIdx + 1 : null,
        rankWeek: weekIdx >= 0 ? weekIdx + 1 : null,
      };
    }
  } catch (_) {}

  return json({
    ok: true,
    me: me,
    total: b.total,
    board: {
      alltime: b.alltime.map(rankRow),
      week: b.week.map(rankRow),
    },
  });
}

function rankRow(m, i) {
  return {
    uid: m.uid,
    name: m.name,
    avatar: m.avatar,
    xp: m.xp,
    score: m.score,
    level: m.level,
    rank: i + 1,
    levelProgress: levelProgress(m.xp),
  };
}
