-- 0013_realtime_tracking.sql
-- Real-time connection tracking and notification management

-- Session tracking for WebSocket connections (Durable Object aware)
CREATE TABLE IF NOT EXISTS realtime_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL UNIQUE,
  user_uid TEXT,
  track_id TEXT,
  connected_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_heartbeat TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_realtime_sessions_user ON realtime_sessions(user_uid);
CREATE INDEX IF NOT EXISTS idx_realtime_sessions_track ON realtime_sessions(track_id);
CREATE INDEX IF NOT EXISTS idx_realtime_sessions_heartbeat ON realtime_sessions(last_heartbeat);

-- Notifications queue for realtime broadcasting
-- Stores notifications to be sent to connected clients
CREATE TABLE IF NOT EXISTS notification_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL DEFAULT '',
  recipient_uid TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '',  -- JSON payload
  status TEXT NOT NULL DEFAULT 'pending',  -- pending, sent, delivered
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_notif_queue_status ON notification_queue(status);
CREATE INDEX IF NOT EXISTS idx_notif_queue_created ON notification_queue(created_at);

-- Keep-alive/hb tracking
CREATE TABLE IF NOT EXISTS connection_heartbeats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  heartbeat_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_hb_sessions ON connection_heartbeats(session_id);

-- View for active sessions (last heartbeat within 30 seconds)
CREATE OR REPLACE VIEW active_sessions AS
SELECT session_id, user_uid, track_id, connected_at
FROM realtime_sessions
WHERE last_heartbeat > datetime('now', '-30 seconds');