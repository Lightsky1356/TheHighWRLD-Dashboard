-- 0052_member_themes.sql
-- Community Themes: members design their own theme in the color-slot builder.
--
-- Only colors live here, never CSS the member wrote: every slot is validated
-- against a strict hex shape and the stylesheet is generated from the site's
-- own fixed template, so a submission cannot smuggle CSS of its own.
-- The slug carries the u- prefix, which is exactly how the rest of the
-- system tells a member theme from a built-in one.
--
-- hidden is a soft removal: a theme the owner takes down disappears from the
-- gallery and from new pickings, while the members already wearing it keep
-- the CSS until they change - nobody's page breaks out from under them.
CREATE TABLE IF NOT EXISTS member_themes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  colors TEXT NOT NULL DEFAULT '{}',
  css TEXT NOT NULL DEFAULT '',
  hidden INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_member_themes_open ON member_themes (hidden, id DESC);
CREATE INDEX IF NOT EXISTS idx_member_themes_uid ON member_themes (uid, id DESC);
