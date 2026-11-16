-- Notification preferences for the three new categories the settings page
-- offers as bubble blocks: site announcements, suggestion updates and
-- replies to comments. Same shape as everything else in this table:
-- 1 = may notify, 0 = silenced, no row at all = the server default (on).

ALTER TABLE user_notification_prefs ADD COLUMN announcements INTEGER NOT NULL DEFAULT 1;
ALTER TABLE user_notification_prefs ADD COLUMN suggestions INTEGER NOT NULL DEFAULT 1;
ALTER TABLE user_notification_prefs ADD COLUMN comment_replies INTEGER NOT NULL DEFAULT 1;
