-- 0012_community_replies_enhanced.sql
-- Enhanced community replies with proper indexes for realtime

-- Add missing indexes to existing replies table
CREATE INDEX IF NOT EXISTS idx_replies_track_created ON replies(track_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_replies_user_created ON replies(user_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_replies_edited ON replies(edited_at) WHERE edited_at IS NOT NULL;

-- Table for tracking typing status (ephemeral, per-session)
CREATE TABLE IF NOT EXISTS typing_status (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  user_name TEXT NOT NULL,
  track_id TEXT,
  status TEXT NOT NULL DEFAULT 'typing',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_typing_session ON typing_status(session_id);
CREATE INDEX IF NOT EXISTS idx_typing_user ON typing_status(user_name);

-- Table for tracking reaction counts per reply
CREATE TABLE IF NOT EXISTS reply_reactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reply_id INTEGER NOT NULL,
  emoji TEXT NOT NULL,
  user_name TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_reply_replies ON reply_reactions(reply_id);
CREATE INDEX IF NOT EXISTS idx_reply_user ON reply_reactions(user_name);

-- View for getting replies with vote counts and reaction counts for realtime
CREATE OR REPLACE VIEW replies_with_counts AS
SELECT 
  r.id,
  r.track_id,
  r.user_name,
  r.body,
  r.created_at,
  r.edited_at,
  COALESCE(rv.total, 0) as vote_total,
  COALESCE(rv.voters, 0) as vote_count,
  COALESCE(rr.react_total, 0) as reaction_total
FROM replies r
LEFT JOIN reply_vote_counts rv ON r.id = rv.reply_id
LEFT JOIN (
  SELECT reply_id, COUNT(*) as react_total 
  FROM reply_reactions GROUP BY reply_id
) rr ON r.id = rr.reply_id
ORDER BY r.created_at ASC;