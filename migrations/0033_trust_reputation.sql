-- 0033: trust & reputation (Phase 6C).
--
-- PRIVACY: reputation is derived ONLY from first-party moderation history
-- (account age, own activity, strikes, bans, upheld/dismissed reports, appeal
-- outcomes, pending automod flags). No IP addresses, user agents, device
-- identifiers, canvas/WebGL fingerprinting or cross-site tracking are stored.
--
-- user_reputation is a short-lived cache of that computation; the underlying
-- signals always live in their original tables, so nothing is duplicated.
CREATE TABLE IF NOT EXISTS user_reputation (
  uid TEXT PRIMARY KEY,
  score INTEGER NOT NULL DEFAULT 50,
  tier TEXT NOT NULL DEFAULT 'standard',
  signals TEXT NOT NULL DEFAULT '{}',
  computed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_reputation_tier ON user_reputation(tier);
CREATE INDEX IF NOT EXISTS idx_reputation_computed ON user_reputation(computed_at);
-- Fixed-window counters for adaptive rate limits. key = "<scope>|<uid>|<bucket>".
-- Rows are pure counters: deleting one only resets a window, never user data.
CREATE TABLE IF NOT EXISTS moderation_rate_counters (
  key TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  uid TEXT NOT NULL,
  bucket TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  window_start TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rate_uid ON moderation_rate_counters(uid, scope);
CREATE INDEX IF NOT EXISTS idx_rate_window ON moderation_rate_counters(window_start);
