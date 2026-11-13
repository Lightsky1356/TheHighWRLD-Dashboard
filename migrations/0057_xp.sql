-- 0057_xp.sql
-- XP, levels and weekly XP for the leaderboard.
--
-- Design notes:
--   xp          cumulative total, used for the all-time board
--   week_xp     resets every ISO-ish week; the board shows this week's earners
--   level       derived from xp, kept so the client can render without math
--
-- Levels: level = floor(sqrt(xp / 50)) + 1, so level 2 needs 50, level 5
-- needs 800, level 10 needs 4 050, level 20 needs 18 050. The number in the
-- app that reads like a rank, not a counter.
--
-- Fully additive and idempotent.

CREATE TABLE IF NOT EXISTS xp (
  user_id    TEXT PRIMARY KEY,
  xp         INTEGER NOT NULL DEFAULT 0,
  level      INTEGER NOT NULL DEFAULT 1,
  week       TEXT NOT NULL DEFAULT '',
  week_xp    INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_xp_xp ON xp(xp DESC);
CREATE INDEX IF NOT EXISTS idx_xp_week_xp ON xp(week, week_xp DESC);

-- Every award lives in this one table; the weekly total resets by naming the week.
