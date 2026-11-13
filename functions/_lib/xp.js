/* ==========================================================================
   XP / levels / the leaderboard

   One table, three numbers per member: total xp, weekly xp, and the level
   derived from total xp. Weeks are "YYYY-WW" (ISO week); a week rollover
   is written by whichever award notices it, so nobody has to run a cron.

   XP is only ever awarded by the server — the client posts nothing but the
   action that earns it, and the amount is decided here.

   Table creation is IF NOT EXISTS on every entry path, like the listens
   rollups — the code ships before any migration has to be run.
   ========================================================================== */

/* Level curve: level = floor(sqrt(xp / 50)) + 1.
   xp for level n: 50 * (n-1)^2  (level 2 = 50, 5 = 800, 10 = 4050, 20 = 18050) */
export function levelFor(xp) {
  return Math.max(1, Math.floor(Math.sqrt(Math.max(0, Number(xp) || 0) / 50)) + 1);
}

/* Progress from xp into the current level, 0..1, for the progress bar. */
export function levelProgress(xp) {
  xp = Math.max(0, Number(xp) || 0);
  var lvl = levelFor(xp);
  var base = 50 * (lvl - 1) * (lvl - 1);
  var next = 50 * lvl * lvl;
  return Math.min(1, (xp - base) / Math.max(1, next - base));
}

export async function ensureXpTable(db) {
  try {
    await db.prepare(
      `CREATE TABLE IF NOT EXISTS xp (
        user_id    TEXT PRIMARY KEY,
        xp         INTEGER NOT NULL DEFAULT 0,
        level      INTEGER NOT NULL DEFAULT 1,
        week       TEXT NOT NULL DEFAULT '',
        week_xp    INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      )`
    ).run();
    await db.prepare("CREATE INDEX IF NOT EXISTS idx_xp_xp ON xp(xp DESC)").run();
    await db.prepare("CREATE INDEX IF NOT EXISTS idx_xp_week_xp ON xp(week, week_xp DESC)").run();
    return true;
  } catch (e) {
    return false;
  }
}

function isoWeekKey() {
  /* ISO week-ish: YYYY-WW; good enough for a leaderboard window and stable
     across time zones that share a DST year. */
  var d = new Date();
  var target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  var day = target.getUTCDay() || 7;             /* Mon=1 .. Sun=7 */
  target.setUTCDate(target.getUTCDate() + 4 - day); /* nearest Thursday */
  var yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  var week = Math.ceil((((target - yearStart) / 86400000) + 1) / 7);
  return target.getUTCFullYear() + "-" + String(week).padStart(2, "0");
}

/* Award xp to a member. Returns the new totals, or null when nobody signed in.
   amount must be a positive integer from a trusted server call site. */
export async function awardXp(db, uid, amount) {
  if (!uid || !amount || amount <= 0) return null;
  try {
    await ensureXpTable(db);
    var week = isoWeekKey();

    await db.prepare("INSERT OR IGNORE INTO xp (user_id) VALUES (?)").bind(uid).run();

    /* Roll the week forward atomically: if the stored week differs, zero it. */
    await db.prepare(
      "UPDATE xp SET xp = xp + ?, " +
      "week_xp = CASE WHEN week = ? THEN week_xp + ? ELSE ? END, " +
      "week = ?, " +
      "updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') " +
      "WHERE user_id = ?"
    ).bind(amount, week, amount, amount, week, uid).run();

    var row = await db.prepare("SELECT xp, week_xp, level FROM xp WHERE user_id = ?").bind(uid).first();
    if (!row) return null;

    var lvl = levelFor(row.xp);
    if (lvl !== row.level) {
      await db.prepare("UPDATE xp SET level = ? WHERE user_id = ?").bind(lvl, uid).run();
    }
    return { xp: row.xp, week_xp: row.week_xp, level: lvl };
  } catch (e) {
    return null;
  }
}

/* Read one member's standing. */
export async function memberStanding(db, uid) {
  try {
    await ensureXpTable(db);
    var week = isoWeekKey();
    var row = await db.prepare("SELECT xp, level, week_xp, week FROM xp WHERE user_id = ?").bind(uid).first();
    /* Roll the week lazily on read so a ghost week doesn't linger. */
    if (row && row.week !== week) {
      await db.prepare("UPDATE xp SET week = ?, week_xp = 0 WHERE user_id = ?").bind(week, uid).run();
      row = { xp: row.xp, level: row.level, week_xp: 0, week: week };
    }
    return row || { xp: 0, level: 1, week_xp: 0, week: week };
  } catch (e) {
    return { xp: 0, level: 1, week_xp: 0, week: "" };
  }
}

/* The board: top members for a scope. Denormalizes display bits from users/discord_links/user_profiles in one join-free pass - cheap, narrow, predictable. */
export async function leaderboard(db, scope, limit) {
  var lim = Math.min(100, Math.max(1, Number(limit) || 50));
  try {
    await ensureXpTable(db);
    var week = isoWeekKey();
    var rows = scope === "week"
      ? await db.prepare(
          "SELECT user_id, xp, level, week_xp AS score FROM xp WHERE week = ? AND week_xp > 0 ORDER BY week_xp DESC, xp DESC LIMIT ?"
        ).bind(week, lim).all()
      : await db.prepare(
          "SELECT user_id, xp, level, xp AS score FROM xp WHERE xp > 0 ORDER BY xp DESC LIMIT ?"
        ).bind(lim).all();

    var list = (rows && rows.results) ? rows.results : [];
    if (!list.length) return { members: [], total: 0, scope: scope };

    /* One lookup for display bits per member. */
    var members = [];
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      var prof = null, link = null, userRow = null;
      try {
        userRow = await db.prepare("SELECT name, avatar, provider FROM users WHERE uid = ?").bind(r.user_id).first();
      } catch (e) {}
      try {
        prof = await db.prepare("SELECT name, avatar FROM user_profiles WHERE site_uid = ?").bind(r.user_id).first();
      } catch (e) {}
      try {
        link = await db.prepare("SELECT display_name, avatar FROM discord_links WHERE site_uid = ?").bind(r.user_id).first();
      } catch (e) {}
      var name =
        (prof && prof.name) ||
        (link && link.display_name) ||
        (userRow && userRow.name) ||
        "Member";
      var avatar =
        (prof && prof.avatar) ||
        (link && link.avatar) ||
        (userRow && userRow.avatar) ||
        "";
      members.push({
        uid: r.user_id,
        name: String(name).slice(0, 64),
        avatar: String(avatar).slice(0, 512),
        xp: r.xp,
        score: r.score,
        level: r.level || levelFor(r.xp),
      });
    }
    return { members: members, scope: scope, total: members.length };
  } catch (e) {
    return { members: [], scope: scope, total: 0, error: String((e && e.message) || e) };
  }
}

/* Total members with any xp recorded — for "N members ranked". */
export async function memberCount(db) {
  try {
    await ensureXpTable(db);
    var row = await db.prepare("SELECT COUNT(*) AS n FROM xp WHERE xp > 0").first();
    return (row && row.n) || 0;
  } catch (e) {
    return 0;
  }
}
