-- A track shared into a chat.
--
-- The message is still a message: it has a sender, a time, replies and
-- reactions like every other. These two columns only say which track it
-- carries, so both ends can draw the same card from the title - which is
-- what the rest of the site already uses as a track's identity, from the
-- player to the listens table. Empty means a plain message, which is what
-- every message written before this migration is.
ALTER TABLE dm_messages ADD COLUMN track_title TEXT NOT NULL DEFAULT '';
ALTER TABLE dm_messages ADD COLUMN track_artist TEXT NOT NULL DEFAULT '';
