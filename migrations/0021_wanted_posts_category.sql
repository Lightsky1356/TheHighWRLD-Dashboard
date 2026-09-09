ALTER TABLE wanted_posts ADD COLUMN category TEXT NOT NULL DEFAULT 'nom';
CREATE INDEX IF NOT EXISTS idx_wanted_posts_category ON wanted_posts(category);
