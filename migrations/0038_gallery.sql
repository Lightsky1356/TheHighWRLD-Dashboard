-- 0038_gallery.sql
-- The fan-art gallery's table.
--
-- WHY THIS EXISTS LATE
-- gallery_items was created directly against the production D1 and never had a
-- migration, so `wrangler d1 migrations apply` against a fresh database would
-- not create it and the gallery would fail with "no such table". The test
-- seeder had been creating it locally as a stopgap, which meant the tests
-- exercised a table production did not have.
--
-- The shape below was originally reconstructed from the queries in
-- functions/api/gallery.js rather than dumped from production, so the column list
-- was believed complete and the types were inferred.
--
-- VERIFIED 2026-10-18 against production with pragma_table_info: all eleven
-- columns are present, in this order, with these types and defaults. The guess
-- was right, which is worth recording - it is the reason this file can now be
-- treated as the definition rather than a guess. Nothing in the app depends on a
-- type beyond what those queries already assume.
--
-- NOTE: `spoiler` is deliberately NOT in this CREATE TABLE even though the
-- column exists. It is added by 0039 instead, so that the ALTER is the single
-- thing that adds it on every path - a fresh database gets the table here and
-- then the column, and the existing production table already has the table and
-- then gets the column. Including it in both would make 0039 fail with
-- "duplicate column name" on a fresh database, because SQLite has no
-- ADD COLUMN IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS gallery_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL DEFAULT '',
  user_name TEXT NOT NULL DEFAULT '',
  avatar TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  caption TEXT NOT NULL DEFAULT '',
  mime TEXT NOT NULL DEFAULT '',
  size INTEGER NOT NULL DEFAULT 0,
  data BLOB,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_gallery_status ON gallery_items (status);
CREATE INDEX IF NOT EXISTS idx_gallery_uid_created ON gallery_items (uid, created_at);
