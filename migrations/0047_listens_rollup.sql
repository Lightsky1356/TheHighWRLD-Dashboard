-- 0047_listens_rollup.sql
-- Keeps the listening statistics instead of asking for them every time.
--
-- WHY THIS EXISTS
-- The listens table holds one row per play. A member's profile needs several
-- summaries of that history: how much they have played, which tracks they
-- play most, the days they played on, the days of the last month, the
-- months of the last year, and the hours of the day they play at.
--
-- Each of those was asked for separately, and each one read the whole
-- history. A profile view therefore read the member's entire listening
-- history four times over, and the free tier counts rows read rather than
-- queries: a member with forty thousand plays cost a hundred and sixty
-- thousand row reads for one profile view, on every visit to their profile.
--
-- So the summaries are kept. Three small tables hold them - one row per day,
-- one per track, one per hour of the day. A member with forty thousand plays
-- has about thirteen hundred rows in them instead of forty thousand.
--
-- THE TABLES ARE FILLED BY THE CODE, NOT BY THIS MIGRATION
-- The summaries are built the first time they are needed, from the history
-- that is already there, and are kept up to date as the plays come in. That
-- way there is no window between the migration and the code during which a
-- play would be counted twice, or not at all.
--
-- Until the tables exist, every endpoint falls back to asking the database
-- exactly as it did before, so this migration can be applied at any time
-- without anything else having to happen first.
--
-- NO TABLE IS TOUCHED AND NO ROW IS READ OR REWRITTEN
-- These are three new tables. Nothing is read from listens and nothing is
-- changed, so row counts and content are unchanged by this migration.

CREATE TABLE IF NOT EXISTS listens_daily (
  uid     TEXT    NOT NULL DEFAULT '',
  day     TEXT    NOT NULL DEFAULT '',
  plays   INTEGER NOT NULL DEFAULT 0,
  seconds INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (uid, day)
);

CREATE TABLE IF NOT EXISTS listens_track (
  uid      TEXT    NOT NULL DEFAULT '',
  track_id TEXT    NOT NULL DEFAULT '',
  plays    INTEGER NOT NULL DEFAULT 0,
  seconds  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (uid, track_id)
);

CREATE TABLE IF NOT EXISTS listens_hour (
  uid   TEXT    NOT NULL DEFAULT '',
  hour  INTEGER NOT NULL DEFAULT 0,
  plays INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (uid, hour)
);

-- The most played tracks are asked for by play count, for one member.
CREATE INDEX IF NOT EXISTS idx_listens_track_plays
  ON listens_track(uid, plays DESC, track_id ASC);
