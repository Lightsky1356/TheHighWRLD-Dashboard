-- Profile v2 edit-form persistence.
--
-- Three columns, three features the edit-profile form needs and nothing else
-- does:
--   user_privacy.show_profile   - the "Public profile" switch. Default 1 so
--                                 every existing member stays exactly as
--                                 visible as they are today. 0 hides the
--                                 whole profile from everyone but its owner.
--   user_profiles.fav_song      - the "Favourite song" pick. A title from the
--                                 vault, stored as given.
--   user_profiles.banner_choice - the banner radio in the form: "auto" (top
--                                 era, the default) or "classic" (999 art).
--
-- Like every other migration here this is additive and idempotent in effect:
-- existing rows get the defaults and keep working.
ALTER TABLE user_privacy ADD COLUMN show_profile INTEGER NOT NULL DEFAULT 1;
ALTER TABLE user_profiles ADD COLUMN fav_song TEXT NOT NULL DEFAULT '';
ALTER TABLE user_profiles ADD COLUMN banner_choice TEXT NOT NULL DEFAULT 'auto';
