-- 0044_search_logs.sql
-- Recovers the search_logs table into the migration history.
--
-- WHY THIS EXISTS
-- search_logs exists in production D1 and has done since 2026-09-20 (65 rows,
-- newest 2026-10-16). It was created outside the migration series, so no
-- migration ever declared it. That is not harmless: a fresh local D1 - which is
-- what the test suite builds from migrations alone - has no such table, so
-- functions/api/search.js fails its INSERT and /api/stats.js fails all three of
-- its queries. The errors were swallowed, so the endpoint still returned 200
-- and the breakage was invisible.
--
-- THE SCHEMA IS NOT GUESSED
-- Recovered verbatim from production:
--   SELECT sql FROM sqlite_master WHERE name='search_logs';
-- Which returned exactly the CREATE TABLE below, plus two indexes. The column
-- types, the DEFAULTs and the strftime format string are copied, not authored,
-- so a rebuilt database matches the live one row-for-row.
--
-- SAFETY
-- IF NOT EXISTS throughout. On production this is a no-op - the table is already
-- there with the same shape, and the indexes are already named identically. On
-- a fresh database it creates what is missing. It cannot drop, alter or rewrite
-- any existing row.

CREATE TABLE IF NOT EXISTS search_logs (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  q        TEXT    NOT NULL DEFAULT '',
  uid      TEXT    NOT NULL DEFAULT 'anon',
  results  INTEGER NOT NULL DEFAULT 0,
  ts       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Both recovered from production. q serves the "most searched" group-by in
-- /api/stats.js; ts serves its 30-day window filters.
CREATE INDEX IF NOT EXISTS idx_search_logs_q  ON search_logs(q);
CREATE INDEX IF NOT EXISTS idx_search_logs_ts ON search_logs(ts);
