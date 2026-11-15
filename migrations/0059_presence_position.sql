-- 0059_presence_position.sql
-- The "Listening now" card on a profile gains the live edge of a real player:
-- where in the song the listener is, the length of the song, and whether it
-- is playing or paused. When the client publishes an update the viewer's
-- progress bar interpolates from that anchor until the next heartbeat - the
-- same seek event the owner can jump to, surfaced honestly.
--
-- Additive and idempotent: no data is rewritten. Existing clients ignore the
-- new columns, and the friends feed keeps working unchanged because nothing
-- in it reads them.

ALTER TABLE friend_activity ADD COLUMN position_ms INTEGER NOT NULL DEFAULT 0;
ALTER TABLE friend_activity ADD COLUMN duration_ms INTEGER NOT NULL DEFAULT 0;
ALTER TABLE friend_activity ADD COLUMN playing INTEGER NOT NULL DEFAULT 1;
ALTER TABLE friend_activity ADD COLUMN position_at TEXT;
