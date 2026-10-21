-- 0048_listens_trending_index.sql
-- Makes the trending page read the window it asks for, and keeps the total
-- number of plays where it can be read in a moment.
--
-- WHY THIS EXISTS
-- The trending page asked two questions of the listens table, and both of
-- them read the whole of it:
--
--   1. "Which tracks were played most in the last seven days?" - the filter
--      was on the timestamp alone, and the only indexes on the table lead
--      with the member, so the index could not be used and every play ever
--      recorded was read to throw most of them away.
--   2. "How many plays have there been?" - a count of the whole table.
--
-- A member with twenty thousand plays is forty thousand rows for one page
-- view, and the free tier counts rows read rather than queries.
--
-- THE INDEX
-- An index that leads with the timestamp, and carries the two columns the
-- question is asked in, turns the first question into a range scan over the
-- seven days that were asked for - and a covering one, so the rows
-- themselves are never touched. The database is asked to explain itself
-- before and after: the plan goes from "SCAN listens" to
-- "SEARCH listens USING COVERING INDEX idx_listens_ts_track (ts>?)".
--
-- THE TOTAL
-- The number of plays is kept, day by day, in a table with one row per day
-- - so the whole history is a few hundred rows, and the question is
-- answered by reading them.
--
-- The table is filled from the history that is already there, and every play
-- after that is counted as it happens. The code that counts the plays is
-- already live before this migration runs, so the two cannot disagree
-- about the same play: before the table exists there is nowhere to count
-- a play, and afterwards every play is counted exactly once.
--
-- ONE TABLE IS READ, AND NOTHING IS CHANGED
-- The listens table itself is not touched: no row is read from it for
-- anything except the count below, and no row is rewritten or removed.

CREATE INDEX IF NOT EXISTS idx_listens_ts_track
  ON listens(ts, track_id, uid);

CREATE TABLE IF NOT EXISTS listens_day (
  day   TEXT    NOT NULL PRIMARY KEY,
  plays INTEGER NOT NULL DEFAULT 0
);

INSERT OR REPLACE INTO listens_day (day, plays)
  SELECT substr(ts,1,10) AS day, COUNT(*) AS plays
  FROM listens
  GROUP BY substr(ts,1,10);
