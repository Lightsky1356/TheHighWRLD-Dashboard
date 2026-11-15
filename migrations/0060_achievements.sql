-- 0060_achievements.sql
-- A member's achievements: the definitions themselves, and which they have
-- earned. The definitions are data, not code, on purpose: a new achievement
-- is a row, and the evaluator reads it the way the leaderboard reads xp.
--
-- Earned state uses progress so partial bars render without a second pass,
-- and unlock_at is ISO-8601 so the profile can show "Unlocked Nov 3, 2026".
-- uid + achievement_id is the primary key so re-earning is idempotent.

CREATE TABLE IF NOT EXISTS achievement_defs (
  id              TEXT PRIMARY KEY,
  category        TEXT NOT NULL,     -- listening | streaks | eras | collector | community | specials | games
  name            TEXT NOT NULL,
  description     TEXT NOT NULL,
  icon            TEXT NOT NULL,     -- FA icon name
  xp              INTEGER NOT NULL DEFAULT 0,
  rarity          TEXT NOT NULL DEFAULT 'common',
  threshold       INTEGER NOT NULL DEFAULT 0,   -- the number the metric has to reach
  metric          TEXT NOT NULL,     -- the metric key the evaluator understands
  arg             TEXT NOT NULL DEFAULT '',     -- optional: era id / track id / etc.
  sort_order      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_achievement_defs_cat ON achievement_defs(category, sort_order);

CREATE TABLE IF NOT EXISTS user_achievements (
  uid             TEXT NOT NULL,
  achievement_id  TEXT NOT NULL,
  progress        INTEGER NOT NULL DEFAULT 0,
  unlocked_at     TEXT,
  PRIMARY KEY (uid, achievement_id)
);
CREATE INDEX IF NOT EXISTS idx_user_achievements_unlocked
  ON user_achievements(uid, unlocked_at);
