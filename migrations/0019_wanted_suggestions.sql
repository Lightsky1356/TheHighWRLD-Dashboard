-- 0019_wanted_suggestions.sql
-- Wanted Vault posts + Suggestions system with voting.

-- ============================================================
-- WANTED POSTS
-- ============================================================
CREATE TABLE IF NOT EXISTS wanted_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  alt_name TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  era TEXT NOT NULL DEFAULT '',
  author_uid TEXT NOT NULL DEFAULT '',
  author_name TEXT NOT NULL DEFAULT 'Anonymous',
  status TEXT NOT NULL DEFAULT 'wanted',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_wanted_posts_status ON wanted_posts(status);
CREATE INDEX IF NOT EXISTS idx_wanted_posts_created ON wanted_posts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wanted_posts_author ON wanted_posts(author_uid);

-- ============================================================
-- SUGGESTIONS (replace old minimal table)
-- ============================================================
CREATE TABLE IF NOT EXISTS suggestions_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'other',
  author_uid TEXT NOT NULL DEFAULT '',
  author_name TEXT NOT NULL DEFAULT 'Anonymous',
  status TEXT NOT NULL DEFAULT 'new',
  vote_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_sugg_v2_status ON suggestions_v2(status);
CREATE INDEX IF NOT EXISTS idx_sugg_v2_category ON suggestions_v2(category);
CREATE INDEX IF NOT EXISTS idx_sugg_v2_created ON suggestions_v2(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sugg_v2_votes ON suggestions_v2(vote_count DESC);
CREATE INDEX IF NOT EXISTS idx_sugg_v2_author ON suggestions_v2(author_uid);

-- ============================================================
-- SUGGESTION VOTES
-- ============================================================
CREATE TABLE IF NOT EXISTS suggestion_votes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  suggestion_id INTEGER NOT NULL,
  user_id TEXT NOT NULL DEFAULT '',
  value INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(suggestion_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_sugg_votes_sid ON suggestion_votes(suggestion_id);
CREATE INDEX IF NOT EXISTS idx_sugg_votes_uid ON suggestion_votes(user_id);
