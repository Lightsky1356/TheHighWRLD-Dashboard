-- 0022_track_votes_value.sql
-- Allow downvotes on wanted track votes (1 = up, -1 = down).
-- Existing rows default to 1 so current counts are preserved.
ALTER TABLE votes ADD COLUMN value INTEGER NOT NULL DEFAULT 1;
