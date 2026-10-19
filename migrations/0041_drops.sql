-- 0041_drops.sql
-- The `drops` and `event_rsvps` tables, which have always existed in production
-- and in no migration.
--
-- WHY THIS EXISTS LATE
-- Same gap as gallery_items and suggestions: created directly against production,
-- never migrated. So `wrangler d1 migrations apply` against a fresh database did
-- not create them and /api/drops returned 500 - "no such table: drops" - before
-- it could serve anything. Production worked, so the failure only ever showed up
-- locally.
--
-- Both shapes below are read out of production with pragma_table_info rather
-- than written from memory, so a fresh database ends up identical to the live
-- one. Recovered 2026-10-18.
--
-- CREATE TABLE IF NOT EXISTS because production already has both tables and this
-- migration has to be a no-op there, which is what makes it safe to record the
-- migration as applied without running it against production.
--
-- No indexes are declared because production has none on either table. The
-- queries against them are bounded (a drop listing is LIMIT 25, and the RSVP
-- lookups are keyed on drop_id), so the access patterns do not need one. Recorded
-- here as a deliberate absence rather than left unmentioned: if either table
-- grows, this is the place to notice.

-- A scheduled release: a track dropping at a known time, with an optional window.
CREATE TABLE IF NOT EXISTS drops (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  title          TEXT NOT NULL DEFAULT '',
  description    TEXT NOT NULL DEFAULT '',
  track_title    TEXT NOT NULL DEFAULT '',
  starts_at      TEXT NOT NULL DEFAULT '',
  ends_at        TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  -- Set once the "it is live" notification has gone out, so the alert is not
  -- re-sent on every poll of the listing.
  notified_live  INTEGER NOT NULL DEFAULT 0
);

-- Who is going to a drop. Composite key on (drop_id, uid) because the same person
-- RSVPing to two different drops is two rows, not one - so neither column can be
-- the primary key on its own.
--
-- The key is also what makes the app's INSERT OR IGNORE idempotent: a repeat RSVP
-- collides with the existing row and is dropped, rather than raising. Both columns
-- are NOT NULL, matching production, so a NULL cannot sneak past the key - SQLite
-- treats NULLs as distinct in a PRIMARY KEY on a rowid table and would happily
-- store it.
CREATE TABLE IF NOT EXISTS event_rsvps (
  drop_id    INTEGER NOT NULL,
  uid        TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (drop_id, uid)
);
