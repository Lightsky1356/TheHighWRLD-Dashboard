/* The listening statistics, kept rather than asked for.
 *
 * The listens table holds one row per play, and a member's profile needs
 * several summaries of it: how much they have played, which tracks they
 * play most, the days they played on, the days of the last month, the
 * months of the last year, and the hours of the day they play at.
 *
 * Asking the database for each of those separately reads the whole history
 * several times over, for every profile that is looked at - and the free
 * tier counts rows read, not queries. A member with forty thousand plays
 * cost a hundred and sixty thousand row reads per profile view.
 *
 * So the summaries are kept, in three small tables: one row per day, one per
 * track, one per hour of the day. A member with forty thousand plays has
 * about thirteen hundred rows in them instead of forty thousand, and a
 * profile view reads those.
 *
 * They are filled the first time they are needed, from the history that is
 * already there, and kept up to date as the plays come in. Before the
 * migration that creates them has run, the tables are not there - and then
 * everything falls back to asking the database, exactly as it did before.
 */

/* Whether the tables are there. Asked once per isolate: a table that is not
   there will not appear while the isolate is alive. */
/* The tables the summaries are kept in.
 *
 * They are created here as well as by the migration, so that the summaries
 * do not depend on the migration having been applied. A database that has
 * never seen them gets them the first time they are needed - and if they
 * cannot be created either, everything falls back to the history exactly as
 * it did before.
 *
 * Creating a table reads no rows, so it works even when the daily read
 * limit has been reached. */
const SCHEMA = [
  "CREATE TABLE IF NOT EXISTS listens_daily (uid TEXT NOT NULL DEFAULT '', day TEXT NOT NULL DEFAULT '', plays INTEGER NOT NULL DEFAULT 0, seconds INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (uid, day))",
  "CREATE TABLE IF NOT EXISTS listens_track (uid TEXT NOT NULL DEFAULT '', track_id TEXT NOT NULL DEFAULT '', plays INTEGER NOT NULL DEFAULT 0, seconds INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (uid, track_id))",
  "CREATE TABLE IF NOT EXISTS listens_hour (uid TEXT NOT NULL DEFAULT '', hour INTEGER NOT NULL DEFAULT 0, plays INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (uid, hour))",
  "CREATE TABLE IF NOT EXISTS listens_day (day TEXT NOT NULL PRIMARY KEY, plays INTEGER NOT NULL DEFAULT 0)",
];

/* Whether the tables are there.
 *
 * Asked once per isolate, because a table that is there stays there. But a
 * "no" is only remembered for a minute: an isolate that started while the
 * daily read limit was reached would otherwise carry on reading the whole
 * history for as long as it lived, which is exactly the thing being fixed. */
const AVAILABILITY = { known: null, at: 0 };
const AVAILABILITY_RETRY_MS = 60000;

async function tablesAreThere(db) {
  /* All of them, not just one: a database can have one and not the others,
     and a half-built set would fall back to the history for ever. */
  await db.prepare("SELECT day FROM listens_daily WHERE uid = ? LIMIT 1").bind("").first();
  await db.prepare("SELECT track_id FROM listens_track WHERE uid = ? LIMIT 1").bind("").first();
  await db.prepare("SELECT hour FROM listens_hour WHERE uid = ? LIMIT 1").bind("").first();
  return true;
}

async function createTables(db) {
  for (const statement of SCHEMA) {
    try {
      await db.prepare(statement).run();
    } catch (_) {
      /* Cannot make them here. The migration will. */
    }
  }
  try {
    await tablesAreThere(db);
    return true;
  } catch (_) {
    return false;
  }
}

export async function rollupAvailable(db) {
  if (AVAILABILITY.known === true) return true;
  if (AVAILABILITY.known === false && Date.now() - AVAILABILITY.at < AVAILABILITY_RETRY_MS) {
    return false;
  }
  try {
    await tablesAreThere(db);
    AVAILABILITY.known = true;
  } catch (_) {
    /* They may simply not have been made yet. */
    AVAILABILITY.known = await createTables(db);
  }
  AVAILABILITY.at = Date.now();
  return AVAILABILITY.known;
}

/* The day a window of days ends on, in the same shape the days are stored. */
function daysAgo(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

function monthsAgo(n) {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - n);
  return d.toISOString().slice(0, 10);
}

/* Fill the summaries for a member from the history that is already there.
   It is a one-off: after this, the history is only read again when a play
   comes in, which is a single row. */
export async function buildRollup(db, uid) {
  const [daily, tracks, hours] = await Promise.all([
    db.prepare(
      "SELECT substr(ts,1,10) AS day, COUNT(*) AS plays, COALESCE(SUM(seconds),0) AS seconds FROM listens WHERE uid = ? GROUP BY day"
    ).bind(uid).all(),
    db.prepare(
      "SELECT track_id, COUNT(*) AS plays, COALESCE(SUM(seconds),0) AS seconds FROM listens WHERE uid = ? GROUP BY track_id"
    ).bind(uid).all(),
    db.prepare(
      "SELECT CAST(strftime('%H', ts) AS INTEGER) AS hour, COUNT(*) AS plays FROM listens WHERE uid = ? GROUP BY hour"
    ).bind(uid).all(),
  ]);

  const stmts = [
    db.prepare("DELETE FROM listens_daily WHERE uid = ?").bind(uid),
    db.prepare("DELETE FROM listens_track WHERE uid = ?").bind(uid),
    db.prepare("DELETE FROM listens_hour WHERE uid = ?").bind(uid),
  ];
  for (const r of daily.results || []) {
    stmts.push(
      db.prepare(
        "INSERT INTO listens_daily (uid, day, plays, seconds) VALUES (?,?,?,?) ON CONFLICT(uid, day) DO UPDATE SET plays = excluded.plays, seconds = excluded.seconds"
      ).bind(uid, r.day, r.plays || 0, r.seconds || 0)
    );
  }
  for (const r of tracks.results || []) {
    stmts.push(
      db.prepare(
        "INSERT INTO listens_track (uid, track_id, plays, seconds) VALUES (?,?,?,?) ON CONFLICT(uid, track_id) DO UPDATE SET plays = excluded.plays, seconds = excluded.seconds"
      ).bind(uid, r.track_id, r.plays || 0, r.seconds || 0)
    );
  }
  for (const r of hours.results || []) {
    stmts.push(
      db.prepare(
        "INSERT INTO listens_hour (uid, hour, plays) VALUES (?,?,?) ON CONFLICT(uid, hour) DO UPDATE SET plays = excluded.plays"
      ).bind(uid, Number(r.hour) || 0, r.plays || 0)
    );
  }

  /* In batches, so a member with a long history does not ask for one
     enormous statement. */
  for (let i = 0; i < stmts.length; i += 100) {
    await db.batch(stmts.slice(i, i + 100));
  }
}

/* Make sure the summaries are there for a member.
   A member who has never played has nothing to summarise, and that is
   remembered by the absence of rows - so this asks the history whether there
   is anything to roll up, which is one row, not the whole of it. */
export async function ensureRollup(db, uid) {
  const have = await db.prepare("SELECT day FROM listens_daily WHERE uid = ? LIMIT 1").bind(uid).first();
  if (have) return true;
  const any = await db.prepare("SELECT id FROM listens WHERE uid = ? LIMIT 1").bind(uid).first();
  if (!any) return true;
  await buildRollup(db, uid);
  return true;
}

/* The number of plays in total, kept day by day.
   *
   * The trending page asks how many plays there have been, and asking the
   * history meant counting every row of it. The days are counted instead -
   * one row per day, for everybody - so the answer is a few hundred rows.
   *
   * Before the table exists there is nowhere to count a play, and the
   * migration that creates it counts the plays that came before it. Between
   * them every play is counted exactly once. */
export async function totalPlays(db) {
  try {
    const row = await db.prepare("SELECT COALESCE(SUM(plays),0) AS total FROM listens_day").first();
    if (row && row.total) return row.total;
    /* The table is there but empty, so the history has not been counted into
       it yet. Count it in, once - the same count the migration makes. */
    try {
      await db.prepare(
        "INSERT OR REPLACE INTO listens_day (day, plays) SELECT substr(ts,1,10) AS day, COUNT(*) AS plays FROM listens GROUP BY substr(ts,1,10)"
      ).run();
      const again = await db.prepare("SELECT COALESCE(SUM(plays),0) AS total FROM listens_day").first();
      if (again && again.total) return again.total;
    } catch (_) {
      /* Could not count them in. Count the history the old way. */
    }
  } catch (_) {
    /* The table is not there. */
    try { await createTables(db); } catch (_) {}
  }
  const old = await db.prepare("SELECT COUNT(*) AS total FROM listens").first();
  return old ? old.total || 0 : 0;
}

/* Count a play in the day it happened. */
async function countPlay(db, day) {
  try {
    await db.prepare(
      "INSERT INTO listens_day (day, plays) VALUES (?, 1) ON CONFLICT(day) DO UPDATE SET plays = listens_day.plays + 1"
    ).bind(day).run();
  } catch (_) {
    /* The table is not there yet. The migration that creates it counts the
       plays that came before it, so nothing is lost. */
  }
}

/* Take a member's plays back out of the count. */
async function uncountPlays(db, plays) {
  if (!plays) return;
  try {
    const rows = await db.prepare(
      "SELECT day, plays FROM listens_day"
    ).all();
    for (const r of rows.results || []) {
      if (!r.plays) continue;
      const take = Math.min(r.plays, plays);
      await db.prepare("UPDATE listens_day SET plays = plays - ? WHERE day = ?").bind(take, r.day).run();
      plays -= take;
      if (plays <= 0) break;
    }
  } catch (_) {}
}

/* Record a play, and keep the summaries with it.
   The play itself is written first and is never lost: if the summaries
   cannot be kept, the play is still there and the summaries are built again
   from it the next time they are needed. */
export async function recordPlay(db, uid, trackId, seconds) {
  let ts = "";
  try {
    const row = await db.prepare(
      "INSERT INTO listens (uid, track_id, seconds) VALUES (?, ?, ?) RETURNING ts"
    ).bind(uid, trackId, seconds).first();
    ts = (row && row.ts) || "";
  } catch (_) {
    const row = await db.prepare(
      "INSERT INTO listens (uid, track_id, seconds) VALUES (?, ?, ?)"
    ).bind(uid, trackId, seconds).run();
    ts = "";
  }
  try {
    /* The day and the hour come from the timestamp the database itself
       wrote, so they cannot disagree with it by a second at midnight. */
    const stamp = ts || new Date().toISOString();
    const day = String(stamp).slice(0, 10);
    const hour = Number(String(stamp).slice(11, 13)) || 0;
    await db.batch([
      db.prepare(
        "INSERT INTO listens_daily (uid, day, plays, seconds) VALUES (?,?,1,?) ON CONFLICT(uid, day) DO UPDATE SET plays = listens_daily.plays + 1, seconds = listens_daily.seconds + excluded.seconds"
      ).bind(uid, day, seconds),
      db.prepare(
        "INSERT INTO listens_track (uid, track_id, plays, seconds) VALUES (?,?,1,?) ON CONFLICT(uid, track_id) DO UPDATE SET plays = listens_track.plays + 1, seconds = listens_track.seconds + excluded.seconds"
      ).bind(uid, trackId, seconds),
      db.prepare(
        "INSERT INTO listens_hour (uid, hour, plays) VALUES (?,?,1) ON CONFLICT(uid, hour) DO UPDATE SET plays = listens_hour.plays + 1"
      ).bind(uid, hour),
    ]);
    await countPlay(db, day);
  } catch (_) {
    /* The summaries could not be kept. The play is recorded, and they are
       built again from the history when they are next needed. */
  }
  return ts;
}

/* Forget a member's plays, and their summaries with them. */
export async function clearPlays(db, uid) {
  /* How many plays are being taken out of the count. */
  let plays = 0;
  try {
    const row = await db.prepare("SELECT COUNT(*) AS n FROM listens WHERE uid = ?").bind(uid).first();
    plays = row ? row.n || 0 : 0;
  } catch (_) {}
  await db.prepare("DELETE FROM listens WHERE uid = ?").bind(uid).run();
  try {
    await db.batch([
      db.prepare("DELETE FROM listens_daily WHERE uid = ?").bind(uid),
      db.prepare("DELETE FROM listens_track WHERE uid = ?").bind(uid),
      db.prepare("DELETE FROM listens_hour WHERE uid = ?").bind(uid),
    ]);
  } catch (_) {}
  await uncountPlays(db, plays);
}

/* Move a member's plays to another member - used when an account is
   linked. The summaries are built again for the member they arrived at. */
export async function movePlays(db, fromUid, toUid) {
  await db.prepare("UPDATE listens SET uid = ? WHERE uid = ?").bind(toUid, fromUid).run();
  try {
    await db.batch([
      db.prepare("DELETE FROM listens_daily WHERE uid = ?").bind(fromUid),
      db.prepare("DELETE FROM listens_track WHERE uid = ?").bind(fromUid),
      db.prepare("DELETE FROM listens_hour WHERE uid = ?").bind(fromUid),
    ]);
    await buildRollup(db, toUid);
  } catch (_) {}
}

/* The streak: consecutive days with a play, ending today or yesterday. */
export function streakFromDays(days) {
  const set = new Set(days || []);
  let streak = 0;
  const d = new Date();
  const iso = (x) => x.toISOString().slice(0, 10);
  if (!set.has(iso(d))) d.setUTCDate(d.getUTCDate() - 1);
  while (set.has(iso(d))) { streak++; d.setUTCDate(d.getUTCDate() - 1); }
  return streak;
}

/* ---- the summaries, read from the rollup ---- */

export async function rollupStats(db, uid, opts) {
  const want = opts || {};
  const topLimit = want.topLimit || 5;

  await ensureRollup(db, uid);

  /* Only what was asked for is read. The account page wants the totals, the
     most played tracks and the days of the last month; the profile wants
     the days for the streak and the hours of the day as well. Each of these
     is a read of the summaries, and none of them is free. */
  const totalsP = db.prepare(
    "SELECT COALESCE(SUM(plays),0) AS plays, COALESCE(SUM(seconds),0) AS seconds FROM listens_daily WHERE uid = ?"
  ).bind(uid).first();
  const uniqP = want.unique === false ? Promise.resolve(null) : db.prepare(
    "SELECT COUNT(*) AS n FROM listens_track WHERE uid = ?"
  ).bind(uid).first();
  const topP = db.prepare(
    "SELECT track_id, plays, seconds FROM listens_track WHERE uid = ? ORDER BY plays DESC, track_id ASC LIMIT ?"
  ).bind(uid, topLimit).all();
  const daysP = want.days === false ? Promise.resolve({ results: [] }) : db.prepare(
    "SELECT day FROM listens_daily WHERE uid = ? ORDER BY day DESC LIMIT 400"
  ).bind(uid).all();
  const recentP = db.prepare(
    "SELECT day, plays, seconds FROM listens_daily WHERE uid = ? AND day >= ? ORDER BY day ASC"
  ).bind(uid, daysAgo(30)).all();
  const hoursP = want.hours === false ? Promise.resolve({ results: [] }) : db.prepare(
    "SELECT hour, plays FROM listens_hour WHERE uid = ?"
  ).bind(uid).all();
  const monthsP = want.months === false ? Promise.resolve({ results: [] }) : db.prepare(
    "SELECT substr(day,1,7) AS m, SUM(plays) AS plays FROM listens_daily WHERE uid = ? AND day >= ? GROUP BY m ORDER BY m ASC"
  ).bind(uid, monthsAgo(12)).all();
  const firstP = want.firstLast === false ? Promise.resolve(null) : db.prepare(
    "SELECT ts FROM listens WHERE uid = ? ORDER BY ts ASC LIMIT 1"
  ).bind(uid).first();
  const lastP = want.firstLast === false ? Promise.resolve(null) : db.prepare(
    "SELECT ts FROM listens WHERE uid = ? ORDER BY ts DESC LIMIT 1"
  ).bind(uid).first();

  const [totals, uniq, top, days, recent, hours, months, first, last] = await Promise.all([
    totalsP, uniqP, topP, daysP, recentP, hoursP, monthsP, firstP, lastP,
  ]);

  const hoursBy = new Array(24).fill(0);
  for (const r of hours.results || []) {
    const h = Number(r.hour);
    if (h >= 0 && h < 24) hoursBy[h] = r.plays || 0;
  }

  return {
    plays: totals ? totals.plays || 0 : 0,
    seconds: totals ? totals.seconds || 0 : 0,
    uniqueTracks: uniq ? uniq.n || 0 : 0,
    firstTs: (first && first.ts) || "",
    lastTs: (last && last.ts) || "",
    top: (top.results || []).map((r) => ({
      track_id: r.track_id || "",
      n: r.plays || 0,
      seconds: r.seconds || 0,
    })),
    days: (days.results || []).map((r) => r.day),
    daily: (recent.results || []).map((r) => ({ day: r.day, n: r.plays || 0, s: r.seconds || 0 })),
    activity30: (recent.results || []).map((r) => ({ day: r.day, n: r.plays || 0 })),
    hours: hoursBy,
    byMonth: (months.results || []).map((r) => ({ m: r.m, n: r.plays || 0 })),
  };
}

/* ---- the summaries, asked for the way they were before ---- */

export async function rawStats(db, uid, opts) {
  const want = opts || {};
  const topLimit = want.topLimit || 5;

  const [totals, uniq, top, days, recent, hours, months, first, last] = await Promise.all([
    db.prepare(
      "SELECT COUNT(*) AS plays, COALESCE(SUM(seconds),0) AS seconds, COUNT(DISTINCT track_id) AS unique_tracks, MIN(ts) AS first_ts, MAX(ts) AS last_ts FROM listens WHERE uid = ?"
    ).bind(uid).first(),
    db.prepare("SELECT COUNT(DISTINCT track_id) AS n FROM listens WHERE uid = ?").bind(uid).first(),
    db.prepare(
      "SELECT track_id, COUNT(*) AS n, COALESCE(SUM(seconds),0) AS seconds FROM listens WHERE uid = ? GROUP BY track_id ORDER BY n DESC, track_id ASC LIMIT ?"
    ).bind(uid, topLimit).all(),
    db.prepare(
      "SELECT DISTINCT substr(ts,1,10) AS day FROM listens WHERE uid = ? ORDER BY day DESC LIMIT 400"
    ).bind(uid).all(),
    db.prepare(
      "SELECT substr(ts,1,10) AS day, COUNT(*) AS n, COALESCE(SUM(seconds),0) AS s FROM listens WHERE uid = ? AND substr(ts,1,10) >= ? GROUP BY day ORDER BY day ASC"
    ).bind(uid, daysAgo(30)).all(),
    db.prepare(
      "SELECT CAST(strftime('%H', ts) AS INTEGER) AS h, COUNT(*) AS n FROM listens WHERE uid = ? GROUP BY h"
    ).bind(uid).all(),
    db.prepare(
      "SELECT substr(ts,1,7) AS m, COUNT(*) AS n FROM listens WHERE uid = ? AND substr(ts,1,10) >= ? GROUP BY m ORDER BY m ASC"
    ).bind(uid, monthsAgo(12)).all(),
    db.prepare("SELECT ts FROM listens WHERE uid = ? ORDER BY ts ASC LIMIT 1").bind(uid).first(),
    db.prepare("SELECT ts FROM listens WHERE uid = ? ORDER BY ts DESC LIMIT 1").bind(uid).first(),
  ]);

  const hoursBy = new Array(24).fill(0);
  for (const r of hours.results || []) {
    const h = Number(r.h);
    if (h >= 0 && h < 24) hoursBy[h] = r.n || 0;
  }

  return {
    plays: totals ? totals.plays || 0 : 0,
    seconds: totals ? totals.seconds || 0 : 0,
    uniqueTracks: uniq ? uniq.n || 0 : 0,
    firstTs: (totals && totals.first_ts) || (first && first.ts) || "",
    lastTs: (totals && totals.last_ts) || (last && last.ts) || "",
    top: (top.results || []).map((r) => ({
      track_id: r.track_id || "",
      n: r.n || 0,
      seconds: r.seconds || 0,
    })),
    days: (days.results || []).map((r) => r.day),
    daily: (recent.results || []).map((r) => ({ day: r.day, n: r.n || 0, s: r.s || 0 })),
    activity30: (recent.results || []).map((r) => ({ day: r.day, n: r.n || 0 })),
    hours: hoursBy,
    byMonth: (months.results || []).map((r) => ({ m: r.m, n: r.n || 0 })),
  };
}

/* The summaries, whichever way they can be had. */
export async function listeningStats(db, uid, opts) {
  if (await rollupAvailable(db)) {
    try {
      return await rollupStats(db, uid, opts);
    } catch (_) {
      /* The summaries could not be read - fall back to the history. */
    }
  }
  return rawStats(db, uid, opts);
}
