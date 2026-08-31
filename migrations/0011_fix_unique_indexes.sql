-- 0011_fix_unique_indexes.sql
-- Full UNIQUE indexes on users.email_lower / google_id / discord_id break
-- email/password registration: every new user inserts discord_id = '' and
-- google_id = '', which can only exist once per unique index. Replace with
-- partial unique indexes that only enforce uniqueness for non-empty values.
DROP INDEX IF EXISTS idx_users_email_lower;
DROP INDEX IF EXISTS idx_users_google_id;
DROP INDEX IF EXISTS idx_users_discord_id;

CREATE UNIQUE INDEX idx_users_email_lower ON users(email_lower) WHERE email_lower != '';
CREATE UNIQUE INDEX idx_users_google_id ON users(google_id) WHERE google_id != '';
CREATE UNIQUE INDEX idx_users_discord_id ON users(discord_id) WHERE discord_id != '';
