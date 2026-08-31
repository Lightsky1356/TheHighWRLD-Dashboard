-- 0008_playlists_profiles.sql
-- Server-synced playlists + profile links (sync across devices)

CREATE TABLE IF NOT EXISTS playlists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL DEFAULT 'anon',
  name TEXT NOT NULL DEFAULT 'New Playlist',
  desc TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_playlists_uid ON playlists(uid);

CREATE TABLE IF NOT EXISTS playlist_tracks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  playlist_id INTEGER NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  added_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_playlist_tracks_pid ON playlist_tracks(playlist_id);

CREATE TABLE IF NOT EXISTS profile_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL DEFAULT 'anon',
  label TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_profile_links_uid ON profile_links(uid);
