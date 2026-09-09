-- 0024_hot_indexes.sql
-- Cover the remaining hot lookup columns so auth/vote/account flows
-- use indexed seeks instead of full-table scans.
CREATE INDEX IF NOT EXISTS idx_discord_links_discord ON discord_links(discord_id);
CREATE INDEX IF NOT EXISTS idx_votes_user ON votes(user_id);
