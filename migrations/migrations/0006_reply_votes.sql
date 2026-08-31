CREATE TABLE IF NOT EXISTS reply_votes (
  site_uid TEXT NOT NULL,
  reply_id INTEGER NOT NULL,
  value INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (site_uid, reply_id)
);
