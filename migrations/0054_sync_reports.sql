-- 0054_sync_reports.sql
-- What the track-sync pipeline DID on each run.
--
-- WHY THIS EXISTS
-- The Auto Sync switch (0053) says whether the pipeline may run, but the owner
-- had no way to see what it actually did while they were away: the only record
-- lived in GitHub Action logs, on a private repo the dashboard cannot read.
-- When the workflow finishes it now posts one row here (functions/api/
-- sync-report.js), and the Vault Sync tab reads it back, so "did anything new
-- land / when did it last run" is answered from the site itself.
--
-- Additive: one new table. Everything already deployed keeps working without
-- it - the endpoint answers "not configured" and the tab shows no run yet.
CREATE TABLE IF NOT EXISTS sync_reports (
  run_id        TEXT PRIMARY KEY,          -- github run id, dedupes retries
  event         TEXT NOT NULL DEFAULT '',  -- schedule | workflow_dispatch
  outcome       TEXT NOT NULL DEFAULT '',  -- ok | error | skipped
  note          TEXT NOT NULL DEFAULT '',  -- human line straight from the runner
  added         INTEGER NOT NULL DEFAULT 0,
  missing_meta  INTEGER NOT NULL DEFAULT 0,
  missing_cover INTEGER NOT NULL DEFAULT 0,
  backfilled    INTEGER NOT NULL DEFAULT 0,
  dry_run       INTEGER NOT NULL DEFAULT 0,
  ref           TEXT NOT NULL DEFAULT '',
  reported_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
