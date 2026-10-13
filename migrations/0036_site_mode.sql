-- Site appearance mode (light / dark / glass), layered on top of the 32 themes.
--
-- This is a separate column rather than a second theme value on the existing
-- `theme` column: the mode is orthogonal to the theme, and folding it into the
-- same string would mean every existing row needed re-parsing to stay correct.
--
-- Default 'dark' because dark is the absence of a mode override, so existing
-- accounts keep exactly the appearance they have today with no write.
ALTER TABLE user_profiles ADD COLUMN site_mode TEXT NOT NULL DEFAULT 'dark';
