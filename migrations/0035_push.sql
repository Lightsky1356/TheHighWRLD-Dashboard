-- 0035_push.sql
-- Web Push subscriptions for background notifications.
--
-- Adds exactly one table. Everything else this feature needs already exists:
-- users/sessions (auth), user_privacy.notifications_enabled (opt-out),
-- user_blocks (block suppression), and community_notifications (the in-app feed).
--
-- One row per SUBSCRIPTION, not per user, because a single account can be signed
-- in on several devices (phone, tablet, desktop). Each device has its own
-- endpoint key pair, so they must be stored and revoked independently. Deleting
-- a row here is what "remove this device" means.
--
-- endpoint is UNIQUE because the push service issues one endpoint per browser
-- installation. The same endpoint re-subscribing (a re-granted permission, or a
-- reinstall) must update the existing row rather than accumulate duplicates, so
-- the upsert keys on endpoint rather than on uid.
--
-- failure_count / last_failure_at exist so a device that is permanently gone
-- (uninstalled, revoked permission) can be pruned after repeated delivery
-- failures instead of being retried forever.

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT NOT NULL DEFAULT '',
  failure_count INTEGER NOT NULL DEFAULT 0,
  last_success_at TEXT,
  last_failure_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- One row per endpoint: makes the subscribe upsert idempotent and gives the
-- send path an O(1) lookup when pruning a dead subscription.
CREATE UNIQUE INDEX IF NOT EXISTS idx_push_sub_endpoint
  ON push_subscriptions(endpoint);

-- Fan-out path: "every device belonging to this user".
CREATE INDEX IF NOT EXISTS idx_push_sub_uid
  ON push_subscriptions(uid);

-- Housekeeping sweep: prune endpoints that keep failing.
CREATE INDEX IF NOT EXISTS idx_push_sub_failures
  ON push_subscriptions(failure_count, last_failure_at);