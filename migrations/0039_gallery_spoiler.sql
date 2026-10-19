-- 0039_gallery_spoiler.sql
-- Let an uploader mark art as a spoiler.
--
-- Stored as an INTEGER flag rather than a boolean because that is what SQLite
-- has and what every other flag in this schema already uses (`verified` on
-- users, `notifications_enabled` on user_privacy).
--
-- DEFAULT 0 matters: every row that already exists reads as "not a spoiler",
-- so no existing upload changes how it renders the moment this runs.
--
-- Plain ALTER, matching the house style in 0004_reply_to and 0010_verified.
-- Those rely on migrations running once, in order, against a database where
-- every earlier table already exists - and 0038 now guarantees that for this
-- one, which is what makes an unguarded ALTER safe here.

ALTER TABLE gallery_items ADD COLUMN spoiler INTEGER NOT NULL DEFAULT 0;
