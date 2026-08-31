-- 0010_verified.sql
-- Add verified flag to users for email verification state
ALTER TABLE users ADD COLUMN verified INTEGER NOT NULL DEFAULT 0;
