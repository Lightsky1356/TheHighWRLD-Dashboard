-- 0018_online_presence.sql
-- Real-time online presence for TheHighWRLD Dashboard.
--
-- Design:
--  * Ephemeral live presence (who is online RIGHT NOW) lives in the
--    CommunityHub Durable Object via WebSocket heartbeats. It is NEVER read
--    or written here on every heartbeat.
--  * This table is a low-frequency DURABLE record for authenticated users,
--    written ONLY when their live status transitions (online->seen/offline),
--    so a "last active" can be shown even after the DO restarts. Guests are
--    deliberately never persisted (privacy).
--
-- Fully additive and idempotent.

CREATE TABLE IF NOT EXISTS presence_state (
  uid TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'offline',           -- 'online' | 'offline'
  last_seen TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_presence_last_seen ON presence_state(last_seen);
