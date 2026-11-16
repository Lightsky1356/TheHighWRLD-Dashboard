-- Track the song a notification is about, the same column the legacy
-- notifications table carried. Community notifications go through
-- createNotification(), which already filters content by the recipient's
-- message_previews setting and gates on the per-category bubbles - routing
-- Wanted Vault replies through it is what makes previews work there.

ALTER TABLE community_notifications ADD COLUMN track_id TEXT NOT NULL DEFAULT '';
