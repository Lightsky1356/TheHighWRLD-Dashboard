-- 0007_account_real.sql
-- Real-time account dashboard tables

CREATE TABLE IF NOT EXISTS user_profiles (
  site_uid TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  bio TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'Online',
  avatar TEXT NOT NULL DEFAULT '',
  banner TEXT NOT NULL DEFAULT '',
  theme TEXT NOT NULL DEFAULT 'default',
  language TEXT NOT NULL DEFAULT 'en',
  tfa_secret TEXT NOT NULL DEFAULT '',
  tfa_enabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL DEFAULT 'anon',
  type TEXT NOT NULL DEFAULT '',
  label TEXT NOT NULL DEFAULT '',
  detail TEXT NOT NULL DEFAULT '',
  track_id TEXT NOT NULL DEFAULT '',
  reply_id INTEGER,
  ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_activity_uid_ts ON activity(uid, ts DESC);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL DEFAULT 'anon',
  type TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL DEFAULT '',
  track_id TEXT NOT NULL DEFAULT '',
  reply_id INTEGER,
  actor TEXT NOT NULL DEFAULT '',
  read INTEGER NOT NULL DEFAULT 0,
  ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_notif_uid ON notifications(uid);

CREATE TABLE IF NOT EXISTS favorites (
  uid TEXT NOT NULL,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY(uid, title)
);

CREATE TABLE IF NOT EXISTS bookmarks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL DEFAULT 'anon',
  kind TEXT NOT NULL DEFAULT 'song',
  label TEXT NOT NULL DEFAULT '',
  sub TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_bookmarks_uid ON bookmarks(uid);

CREATE TABLE IF NOT EXISTS downloads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL DEFAULT 'anon',
  title TEXT NOT NULL DEFAULT '',
  size TEXT NOT NULL DEFAULT '',
  ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_downloads_uid ON downloads(uid);

CREATE TABLE IF NOT EXISTS logins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL DEFAULT 'anon',
  ip TEXT NOT NULL DEFAULT '',
  ua TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT '',
  method TEXT NOT NULL DEFAULT 'session',
  ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_logins_uid ON logins(uid);

CREATE TABLE IF NOT EXISTS listens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL DEFAULT 'anon',
  track_id TEXT NOT NULL DEFAULT '',
  seconds INTEGER NOT NULL DEFAULT 0,
  ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_listens_uid ON listens(uid);
CREATE INDEX IF NOT EXISTS idx_listens_uid_ts ON listens(uid, ts);

-- bio column for Discord "about me"
ALTER TABLE discord_links ADD COLUMN bio TEXT NOT NULL DEFAULT '';
