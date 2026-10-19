-- 0028_playlist_favorites.sql
-- Playlist favorites system for saving public playlists
--
-- CORRECTED 2026-10-18 to match production.
--
-- This file originally declared
--     id INTEGER PRIMARY KEY AUTOINCREMENT, ... UNIQUE(uid, playlist_id)
-- but production's table has no `id` at all and keys on the pair:
--     uid TEXT NOT NULL, playlist_id INTEGER NOT NULL, PRIMARY KEY (uid, playlist_id)
--
-- Nothing reads or writes `id` - functions/api/playlists.js only ever uses
-- (uid, playlist_id), in six statements - so both shapes work and the unused
-- column was pure noise. The pair is a PRIMARY KEY rather than a separate UNIQUE
-- because that is what production has; the two are equivalent for every query
-- the app makes, including the INSERT OR IGNORE that relies on the collision.
--
-- The shape below is read out of production with pragma_table_info rather than
-- assumed, so a fresh database gets the same table the live one has.
--
-- The migration was never recorded as applied in production even though the
-- table is there, which is why `migrations apply` was failing on it.

CREATE TABLE IF NOT EXISTS playlist_favorites (
  uid         TEXT    NOT NULL,
  playlist_id INTEGER NOT NULL,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (uid, playlist_id)
);
CREATE INDEX IF NOT EXISTS idx_playlist_favorites_uid ON playlist_favorites(uid);
CREATE INDEX IF NOT EXISTS idx_playlist_favorites_playlist ON playlist_favorites(playlist_id);
CREATE INDEX IF NOT EXISTS idx_playlist_favorites_created ON playlist_favorites(created_at DESC);
