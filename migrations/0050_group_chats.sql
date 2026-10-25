-- Group conversations.
--
-- A one-to-one chat is untouched: it still answers on uid_a/uid_b, that pair
-- is still unique and still ordered. A group is a row of its own kind - the
-- people in it were always going to live in dm_conversation_members, which was
-- already many-to-many, and the row carries the name the group was given.
--
-- uid_a/uid_b are NOT NULL, and SQLite cannot drop a constraint with ALTER
-- TABLE. A group fills them with a pair derived from its own id: ordered, able
-- to collide with nothing - not another group, and not any real pair of people
-- - and read by nothing. For a group the members table is the only answer.

ALTER TABLE dm_conversations ADD COLUMN kind TEXT NOT NULL DEFAULT 'dm';
ALTER TABLE dm_conversations ADD COLUMN title TEXT NOT NULL DEFAULT '';
ALTER TABLE dm_conversations ADD COLUMN created_by TEXT NOT NULL DEFAULT '';

-- The conversation list asks for the most recent conversations first.
CREATE INDEX IF NOT EXISTS idx_dm_conversations_last_message
  ON dm_conversations(last_message_at DESC);
