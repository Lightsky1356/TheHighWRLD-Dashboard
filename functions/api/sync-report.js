// Reports from the track-sync pipeline (what its runs actually DID).
//
// POST  The GitHub workflow's last step posts one row per run, authenticated
//       with a shared SYNC_REPORT_TOKEN secret (set once in GitHub Actions and
//       in the Pages worker environment - the value must match on both sides).
//       Unlike /api/autosync this is NOT owner-passcode gated, because the
//       runner has no passcode; the separate token exists so an arbitrary
//       site visitor cannot invent runs.
// GET   Public - the Vault Sync tab reads the most recent runs to answer
//       "did anything new land / when did the pipeline last run" without
//       anyone opening Action logs on the private repo.
//
// Requires migrations/0054_sync_reports.sql. Until it is applied both sides
// answer with a clear "not ready" instead of throwing.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Sync-Token",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestGet(context) {
  try {
    const db = context.env.wanted_vault;
    let runs = [];
    try {
      const res = await db
        .prepare(
          "SELECT run_id, event, outcome, note, added, missing_meta, missing_cover, backfilled, dry_run, ref, reported_at " +
            "FROM sync_reports ORDER BY reported_at DESC LIMIT 5"
        )
        .all();
      runs = (res && res.results) || [];
    } catch (_) {
      /* table not migrated yet */
      return json({ ok: true, runs: [], ready: false });
    }
    return json({ ok: true, runs: runs, ready: true });
  } catch (e) {
    return json({ ok: false, error: String((e && e.message) || e) }, 500);
  }
}

export async function onRequestPost(context) {
  try {
    const secret = String(context.env.SYNC_REPORT_TOKEN || "");
    if (!secret) {
      return json({ ok: false, error: "reporting not configured - SYNC_REPORT_TOKEN is not set on the worker" }, 403);
    }
    const header = context.request.headers.get("X-Sync-Token") || "";
    const body = await context.request.json().catch(() => ({}));
    if (header !== secret || String(body.code || "") !== secret) {
      return json({ ok: false, error: "forbidden" }, 403);
    }

    const runId = String(body.run_id || "").slice(0, 64);
    if (!runId) return json({ ok: false, error: "missing run_id" }, 400);

    const row = {
      run_id: runId,
      event: String(body.event || "").slice(0, 32),
      outcome: String(body.outcome || "").slice(0, 16),
      note: String(body.note || "").slice(0, 500),
      added: Number(body.added) || 0,
      missing_meta: Number(body.missing_meta) || 0,
      missing_cover: Number(body.missing_cover) || 0,
      backfilled: Number(body.backfilled) || 0,
      dry_run: body.dry_run ? 1 : 0,
      ref: String(body.ref || "").slice(0, 64),
    };

    const db = context.env.wanted_vault;
    try {
      await db
        .prepare(
          "INSERT INTO sync_reports (run_id, event, outcome, note, added, missing_meta, missing_cover, backfilled, dry_run, ref, reported_at) " +
            "VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, strftime('%Y-%m-%dT%H:%M:%fZ','now')) " +
            "ON CONFLICT(run_id) DO UPDATE SET event = excluded.event, outcome = excluded.outcome, note = excluded.note, " +
            "added = excluded.added, missing_meta = excluded.missing_meta, missing_cover = excluded.missing_cover, " +
            "backfilled = excluded.backfilled, dry_run = excluded.dry_run, ref = excluded.ref, " +
            "reported_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')"
        )
        .bind(row.run_id, row.event, row.outcome, row.note, row.added, row.missing_meta, row.missing_cover, row.backfilled, row.dry_run, row.ref)
        .run();
      /* keep the table a ledger, not a landfill: drop everything older than
         the newest 100 runs */
      await db
        .prepare(
          "DELETE FROM sync_reports WHERE run_id NOT IN " +
            "(SELECT run_id FROM sync_reports ORDER BY reported_at DESC LIMIT 100)"
        )
        .run();
    } catch (_) {
      return json({ ok: false, error: "reporting table not created yet - apply migrations/0054_sync_reports.sql" }, 503);
    }
    return json({ ok: true });
  } catch (e) {
    return json({ ok: false, error: String((e && e.message) || e) }, 500);
  }
}
