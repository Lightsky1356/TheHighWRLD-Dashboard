CREATE TABLE IF NOT EXISTS discord_links (
  site_uid TEXT PRIMARY KEY,
  discord_id TEXT NOT NULL DEFAULT '',
  display_name TEXT NOT NULL DEFAULT '',
  linked_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS analytics_visits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL DEFAULT 'anon',
  page TEXT NOT NULL DEFAULT '',
  ua TEXT NOT NULL DEFAULT '',
  ip TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT '',
  ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_analytics_ts ON analytics_visits(ts);
CREATE INDEX IF NOT EXISTS idx_analytics_uid ON analytics_visits(uid);
