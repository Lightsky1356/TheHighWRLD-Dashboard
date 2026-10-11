-- 0028_playlist_favorites.sql
-- Playlist favorites system for saving public playlists
CREATE TABLE IF NOT EXISTS playlist_favorites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL,
  playlist_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(uid, playlist_id)
);
CREATE INDEX IF NOT EXISTS idx_playlist_favorites_uid ON playlist_favorites(uid);
CREATE INDEX IF NOT EXISTS idx_playlist_favorites_playlist ON playlist_favorites(playlist_id);
CREATE INDEX IF NOT EXISTS idx_playlist_favorites_created ON playlist_favorites(created_at DESC);
