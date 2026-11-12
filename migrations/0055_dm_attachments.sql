-- Pictures, files and stickers sent into a chat.
--
-- A message is still a message: it has a sender, a time, replies and
-- reactions like every other. These rows only say what the message carries
-- BESIDE its words, so both ends draw the same thing - the sender and the
-- reader see the same picture, the same file and the same sticker.
--

-- A sticker is a message that is a picture of a feeling. It travels in the
-- message itself, so the person on the other end sees exactly the sticker
-- that was sent. Empty means a plain message, which is what every message
-- written before this migration is.
ALTER TABLE dm_messages ADD COLUMN sticker TEXT NOT NULL DEFAULT '';

-- The bytes live here rather than in a row of their own because there is no
-- bucket to put them in, so D1 is where they go. The gallery keeps its
-- artwork the same way, with the same 800KB cap on a single picture.
--
-- KIND
--   'photo'   a picture, shown inline
--   'file'    a document, offered as a download
--   'sticker' a sticker, shown large
--
-- MESSAGE_ID is NULL until the message is written. An upload and a message
-- are one request, so a row with no message is a message that never got
-- sent - and the sweeper below takes those away rather than leaving them
-- for ever.

CREATE TABLE IF NOT EXISTS dm_attachments (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL DEFAULT '',
  message_id INTEGER,
  uid TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'file',
  name TEXT NOT NULL DEFAULT '',
  mime TEXT NOT NULL DEFAULT '',
  size INTEGER NOT NULL DEFAULT 0,
  width INTEGER NOT NULL DEFAULT 0,
  height INTEGER NOT NULL DEFAULT 0,
  data BLOB,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- The messages of a conversation are read newest first, and the attachments
-- come with them.
CREATE INDEX IF NOT EXISTS idx_dm_attachments_message
  ON dm_attachments(message_id);

-- The sweeper reads the unattached rows by age.
CREATE INDEX IF NOT EXISTS idx_dm_attachments_unattached
  ON dm_attachments(created_at)
  WHERE message_id IS NULL;
