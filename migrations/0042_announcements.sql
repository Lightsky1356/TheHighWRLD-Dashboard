-- 0042_announcements.sql
-- The `announcements` table, which has always existed in production and in no
-- migration.
--
-- WHY THIS EXISTS LATE
-- Same gap as gallery_items, suggestions and drops: created directly against
-- production, never migrated. So a fresh database did not have it and
-- /api/announcements returned 500 with "no such table: announcements", which
-- took out the notification bell's announcement list and announcement-banner.js
-- with it. Production worked, so the break only ever showed up locally.
--
-- The shape below is read out of production with pragma_table_info rather than
-- written from memory, so a fresh database ends up identical to the live one.
-- Recovered 2026-10-18.
--
-- CREATE TABLE IF NOT EXISTS because production already has this table and this
-- migration has to be a no-op there, which is what makes it safe to record the
-- migration as applied without running it against production.

CREATE TABLE IF NOT EXISTS announcements (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  -- Empty string rather than NULL so a half-filled composer cannot produce a
  -- NULL row; functions/api/announcements.js renders both fields directly.
  title      TEXT NOT NULL DEFAULT '',
  message    TEXT NOT NULL DEFAULT '',
  -- The listing is "newest first", ordered by id rather than created_at, so a
  -- row posted in the same millisecond still has a defined order.
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
