/* Batch 22 - the Auto Sync chain, tested.
 *
 * The Auto Sync switch and the run reports are the two ends of the
 * pipeline the owner controls from the dashboard: the switch tells the
 * scheduled GitHub run whether it may write tracks, and the report tells
 * the dashboard what the last run actually did. Both are easy to break
 * quietly - a renamed column, a changed header, a flag read that always
 * comes back true - and neither was covered.
 *
 * This suite covers:
 *   - the switch reads its state, and the owner's passcode is what turns
 *     it (and nothing else does),
 *   - a report without the token is refused, and one with it is kept and
 *     comes back in the history.
 */
const BASE = "http://127.0.0.1:8788";
const PASSCODE = "test-owner-passcode";
const REPORT_TOKEN = "test-sync-token";

const out = [];
function check(name, pass, detail) {
  out.push(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  -> " + detail : ""}`);
}

async function call(path, method = "GET", body, headers) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json", ...(headers || {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) {}
  return { status: res.status, json, text };
}

/* ---------- The switch ---------- */
const start = await call("/api/autosync");
check("the switch can be read", start.status === 200 && start.json?.ok === true,
  `status ${start.status}`);
check("the switch reports a state", typeof start.json?.enabled === "boolean",
  `enabled ${start.json?.enabled}`);

/* A wrong passcode must not turn it. */
const wrong = await call("/api/autosync", "POST", { code: "not-the-passcode" });
check("a wrong passcode is refused", wrong.status === 403, `status ${wrong.status}`);

/* The right one turns it off, and it is really off afterwards. */
const off = await call("/api/autosync", "POST", { code: PASSCODE, enabled: false });
check("the owner's passcode turns the switch", off.status === 200 && off.json?.enabled === false,
  `status ${off.status} enabled ${off.json?.enabled}`);

const readOff = await call("/api/autosync");
check("the switch reads back as off", readOff.json?.enabled === false,
  `enabled ${readOff.json?.enabled}`);

/* And back on again, so the pipeline is left as it was found. */
const on = await call("/api/autosync", "POST", { code: PASSCODE, enabled: true });
check("the switch can be turned back on", on.status === 200 && on.json?.enabled === true,
  `status ${on.status} enabled ${on.json?.enabled}`);

const readOn = await call("/api/autosync");
check("the switch reads back as on", readOn.json?.enabled === true,
  `enabled ${readOn.json?.enabled}`);

/* ---------- The reports ---------- */
const noToken = await call("/api/sync-report", "POST", { outcome: "ok", added: 1 });
check("a report without the token is refused", noToken.status === 403, `status ${noToken.status}`);

const wrongToken = await call("/api/sync-report", "POST", { outcome: "ok" },
  { "X-Sync-Token": "not-the-token" });
check("a report with the wrong token is refused", wrongToken.status === 403, `status ${wrongToken.status}`);

/* The secret can also arrive in the body, for a caller that cannot set a
   header. Either one on its own is enough. */
const bodyToken = await call("/api/sync-report", "POST",
  { run_id: "bodytok" + String(Date.now()).slice(-8), outcome: "ok", code: REPORT_TOKEN });
check("a report with the secret in the body is accepted", bodyToken.status === 200 && bodyToken.json?.ok === true,
  `status ${bodyToken.status}`);

const runId = "testrun" + String(Date.now()).slice(-8);
const posted = await call("/api/sync-report", "POST",
  { run_id: runId, event: "schedule", outcome: "ok", note: "2 new song(s) processed", added: 2 },
  { "X-Sync-Token": REPORT_TOKEN });
check("a report with the token is accepted", posted.status === 200 && posted.json?.ok === true,
  `status ${posted.status}`);

const history = await call("/api/sync-report");
const runs = history.json?.runs || [];
const mine = runs.find((r) => r.run_id === runId);
check("the report comes back in the history", !!mine, mine ? `added ${mine.added}` : "not found");
check("the report keeps what it was told", mine && mine.added === 2 && mine.note === "2 new song(s) processed",
  mine ? `added ${mine.added} note "${mine.note}"` : "no report");
check("the history is newest first", runs.length < 2 || runs[0].reported_at >= runs[1].reported_at,
  runs.length > 1 ? runs[0].reported_at + " then " + runs[1].reported_at : "one run");
check("the history says it is ready", history.json?.ready === true, `ready ${history.json?.ready}`);

console.log(out.join("\n"));
const failed = out.filter((l) => l.startsWith("FAIL")).length;
console.log(`\n${out.length - failed} passed, ${failed} failed`);
await new Promise((r) => setTimeout(r, 300));
process.exit(failed ? 1 : 0);
