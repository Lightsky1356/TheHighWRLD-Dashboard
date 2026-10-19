-- 0045_missing_community_indexes.sql
-- Adds the indexes that migrations 0012, 0015 and 0016 declared but which are
-- absent from production.
--
-- WHY THIS EXISTS
-- Every migration from 0001 to 0043 is recorded as applied in production's
-- d1_migrations table, and `wrangler d1 migrations list --remote` correctly
-- reports "No migrations to apply!". That bookkeeping is accurate and it is also
-- exactly the problem: a migration marked applied will never run again, so an
-- index that was never created - or that failed partway through a batch - stays
-- missing permanently, with nothing left to notice or repair it. This file is
-- that repair.
--
-- HOW THE LIST WAS BUILT
-- Every CREATE INDEX in 0012/0015/0016 was parsed and checked by name against
-- production's sqlite_master. 9 were absent. Of those, 3 turned out to be
-- redundant and are deliberately NOT recreated here - see the bottom of this
-- file. The remaining 5 are below.
--
-- EVERY INDEX HERE IS PURELY ADDITIVE
-- No table is touched and no row is read or rewritten, so row counts and
-- content are unchanged by this migration.

-- -----------------------------------------------------------------------
-- replies: declared in 0012, absent.
-- -----------------------------------------------------------------------
-- The two leading columns match how the community reply list is actually
-- queried: a page of replies for one track, newest first.
CREATE INDEX IF NOT EXISTS idx_replies_track_created
  ON replies(track_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_replies_user_created
  ON replies(user_name, created_at DESC);

-- Declared in 0012, absent. Reproduced verbatim, including the partial-index
-- predicate - a plain index here would have made production and a freshly
-- migrated local database differ in shape for the same name.
CREATE INDEX IF NOT EXISTS idx_replies_edited
  ON replies(edited_at) WHERE edited_at IS NOT NULL;

-- -----------------------------------------------------------------------
-- notifications.reply_id: declared in 0015, absent.
-- -----------------------------------------------------------------------
-- The existing idx_notifications_uid_ts covers the per-user badge query, but
-- nothing covers looking up notifications by the reply they point at.
CREATE INDEX IF NOT EXISTS idx_notifications_reply
  ON notifications(reply_id);

-- -----------------------------------------------------------------------
-- reply_reactions uniqueness: declared in 0016, absent.
-- -----------------------------------------------------------------------
-- This is the constraint that stops one person recording the same emoji on the
-- same reply twice. Without it, double-tapping an emoji inserts a second row
-- and the visible reaction count is inflated.
--
-- It was previously left out of scope because adding a UNIQUE index fails
-- outright if duplicates already exist, which would make this a data decision
-- rather than a schema one. That concern is now resolved by measurement: the
-- table holds 0 rows in production, so there is nothing to conflict and the
-- index is safe to add. (It is also the reason the fix is worth making now
-- rather than later - the table is empty, so the constraint can be put in place
-- before any data exists to violate it.)
--
-- Column names are user_name, not author_uid: reply_reactions predates the
-- community tables and is keyed on the display name.
CREATE UNIQUE INDEX IF NOT EXISTS idx_reply_react_unique
  ON reply_reactions(reply_id, user_name, emoji);

-- -----------------------------------------------------------------------
-- DELIBERATELY NOT RECREATED
-- -----------------------------------------------------------------------
-- These three were declared by the migrations but are absent by name only.
-- Production already indexes the same columns under different names, so
-- recreating them would add write overhead and D1 storage for no query benefit:
--
--   idx_reply_replies         reply_reactions(reply_id)
--   idx_reply_reactions_target reply_reactions(reply_id)
--       -> both already covered by idx_reply_reactions_reply
--
--   idx_reply_user            reply_reactions(user_name)
--       -> already covered by idx_reply_reactions_user
--
-- An index whose leading column already matches is usable by the planner for
-- these queries, so the aliases add nothing.
