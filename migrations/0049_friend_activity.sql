-- 0049_friend_activity.sql
-- The friend activity feed: what your friends are up to.
--
-- WHY THIS EXISTS
-- The profile has always shown a member's own recent activity. There was
-- nowhere to see what the people you know are up to - what they are
-- listening to, which playlists they have shared, what they have done in
-- the community - as one stream.
--
-- So this is that stream: one row per thing somebody did that their friends
-- are allowed to see.
--
-- WHAT IS IN A ROW
-- The member who did it, what they did, the smallest amount of detail
-- needed to draw a card, when it happened, and - for a listening event -
-- when it stops being true.
--
-- WHY THE LISTENING EVENT EXPIRES
-- "Is listening to X" is a fact about now, not about history. A row that
-- said it without an end would go stale and be wrong: the member would be
-- shown as listening to something they stopped an hour ago. So a listening
-- row carries the moment it stops being true, and the feed only shows it
-- while it is true.
--
-- THE SETTINGS ARE SEPARATE
-- Three settings, one for each kind of thing, so somebody can share their
-- listening without sharing their playlists.
--
-- There are only two states: 'nobody' (off) and 'friends'. There is no
-- "everybody" - the feed is a feed of what your friends are up to, so
-- being visible to the world is not something it can do, and offering it
-- would be a promise the feed could not keep.
--
-- They all default to 'nobody'. Nothing is published until the person
-- says so - a new account is private until it decides otherwise.
--
-- THE FEED IS NOT A NOTIFICATION
-- A notification is a message to one person. This is a stream of what
-- people did, and it is read by whoever looks at it - so it is a separate
-- table with its own rules, and a row here never sends anybody anything.

CREATE TABLE IF NOT EXISTS friend_activity (
  id TEXT PRIMARY KEY,
  uid TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT 'listening',
  -- The smallest amount of detail needed to draw the card. Whatever is here
  -- is what other people can see, so it holds no URLs, no file paths and
  -- nothing private.
  track_id TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  artist TEXT NOT NULL DEFAULT '',
  artwork TEXT NOT NULL DEFAULT '',
  label TEXT NOT NULL DEFAULT '',
  detail TEXT NOT NULL DEFAULT '',
  link TEXT NOT NULL DEFAULT '',
  -- For a listening event: the moment it stops being true.
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- The feed reads one member's rows newest first, and the writer updates a
-- member's listening row by its stable id.
CREATE INDEX IF NOT EXISTS idx_friend_activity_uid
  ON friend_activity(uid, created_at DESC);

-- The feed reads the rows of the people being looked at, newest first,
-- with a cursor. This is the index that makes it a range scan.
CREATE INDEX IF NOT EXISTS idx_friend_activity_created
  ON friend_activity(created_at DESC);

-- The three settings: what may be shared, and with whom.
ALTER TABLE user_social_settings ADD COLUMN activity_listening TEXT NOT NULL DEFAULT 'nobody'
  CHECK (activity_listening IN ('nobody', 'friends'));
ALTER TABLE user_social_settings ADD COLUMN activity_playlists TEXT NOT NULL DEFAULT 'nobody'
  CHECK (activity_playlists IN ('nobody', 'friends'));
ALTER TABLE user_social_settings ADD COLUMN activity_community TEXT NOT NULL DEFAULT 'nobody'
  CHECK (activity_community IN ('nobody', 'friends'));
