-- 0046_presence_last_seen_index.sql
-- Indexes online_visitors by when it was last seen, so clearing the stale
-- rows is a range scan rather than a scan of the whole table.
--
-- WHY THIS EXISTS
-- The presence heartbeat runs every thirty seconds, per client, for as long as
-- a tab is open, and each one cleared the rows older than ninety seconds and
-- counted what was left. Both are scans of online_visitors, and visitors -
-- especially signed-out ones, who arrive with a fresh random id every visit -
-- make that table churn.
--
-- The account ran out of D1's free tier daily row read limit and stopped
-- serving: every endpoint that reads the database answered with an error, and
-- the limit only resets at midnight UTC. This index, and the change that stops
-- the prune running on every heartbeat, are the repair for the cost; the
-- index makes the part that still runs cheap.
--
-- ONLY AN INDEX IS ADDED
-- No table is touched and no row is read or rewritten, so row counts and
-- content are unchanged by this migration.

CREATE INDEX IF NOT EXISTS idx_online_visitors_last_seen
  ON online_visitors(last_seen);
