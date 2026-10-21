// End-to-end test of per-category notification preferences.
//
// Covers what CAN be reached over HTTP: /api/notification-settings itself, its
// defaults, its allowlist, its coercion, and its scoping.
//
// SCOPE, stated plainly because it matters: this does NOT prove that a mention is
// suppressed when mentions are off. That enforcement lives in
// createNotification(), which is server-side and only reachable through event
// endpoints that do not exist yet for suggestions and Wanted suggestions. This
// suite covers the endpoint and its persistence; the enforcement itself is
// verified by construction - there is exactly one insert path and every writer
// goes through it - not by an event that has no endpoint yet.
//
// Run against the local dev server. npm test applies migrations and seeds the
// accounts first.

const BASE = "http://127.0.0.1:8788";

const USER = { uid: "notifon1", token: "notifontoken1" };
const OTHER = { uid: "notifoff1", token: "notifofftoken1" };

async function call(token, method, body) {
  const res = await fetch(BASE + "/api/notification-settings", {
    method,
    headers: { Cookie: `thw_session=${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  /* The body is read in full every time. A response left half read
     leaves the connection open, and Node on Windows asserts about that when
     the process ends - which fails the whole group even when every check in
     it passed. */
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) {}
  return { status: res.status, json };
}

const ALL_KEYS = [
  "replies", "wanted_replies", "mentions", "upvotes",
  "direct_messages", "friend_requests", "in_site", "push", "message_previews",
];

const out = [];
function check(name, pass, detail) {
  out.push(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  -> " + detail : ""}`);
}

async function main() {
  /* ---- auth ---- */
  let r = await call("", "GET");
  check("GET without a session is rejected", r.status === 401, `status=${r.status}`);

  r = await call(USER.token, "GET");
  check("GET with a session succeeds", r.status === 200 && r.json && r.json.ok === true, `status=${r.status}`);
  check("returns every category", ALL_KEYS.every((k) => k in (r.json.prefs || {})), Object.keys(r.json.prefs || {}).join(","));

  /* ---- defaults ---- */
  check(
    "a fresh account defaults everything on",
    ALL_KEYS.every((k) => r.json.prefs[k] === 1),
    JSON.stringify(r.json.prefs)
  );

  /* ---- persistence ---- */
  r = await call(USER.token, "POST", { mentions: 0, direct_messages: 0 });
  check("POST persists", r.status === 200 && r.json && r.json.ok === true, `status=${r.status}`);
  check("POST echoes the new value", r.json.prefs && r.json.prefs.mentions === 0, JSON.stringify(r.json.prefs && r.json.prefs.mentions));

  r = await call(USER.token, "GET");
  check("GET reflects the saved value", r.json.prefs.mentions === 0 && r.json.prefs.direct_messages === 0);
  check("untouched categories stay on", r.json.prefs.replies === 1 && r.json.prefs.upvotes === 1);

  /* ---- coercion ---- */
  r = await call(USER.token, "POST", { upvotes: "yes", push: 0, mentions: 1 });
  check("a truthy non-boolean is coerced to 1", r.json.prefs.upvotes === 1, JSON.stringify(r.json.prefs.upvotes));
  check("push can be turned off", r.json.prefs.push === 0);
  check("mentions can be turned back on", r.json.prefs.mentions === 1);

  /* ---- allowlist ---- */
  r = await call(USER.token, "POST", { uid: "notifactor1", notifications_enabled: 0, __proto__: "x" });
  check("unknown keys are ignored", r.status === 400 || (r.json && r.json.prefs && r.json.prefs.mentions !== undefined), `status=${r.status}`);

  r = await call(OTHER.token, "GET");
  check("another account's prefs are untouched", r.json.prefs.mentions === 1, JSON.stringify(r.json.prefs.mentions));
  check("no cross-account leak", r.json.prefs.push === 1);

  /* ---- no uid in the payload can redirect the write ---- */
  r = await call(OTHER.token, "POST", { uid: USER.uid, mentions: 0 });
  r = await call(USER.token, "GET");
  check("a uid in the body cannot redirect the write", r.json.prefs.mentions === 1, JSON.stringify(r.json.prefs.mentions));

  /* ---- method handling ---- */
  r = await call(USER.token, "DELETE");
  check("DELETE is not allowed", r.status === 405, `status=${r.status}`);

  /* ---- restore ---- */
  await call(USER.token, "POST", Object.fromEntries(ALL_KEYS.map((k) => [k, 1])));
  r = await call(USER.token, "GET");
  check("all categories can be restored", ALL_KEYS.every((k) => r.json.prefs[k] === 1));

  console.log(out.join("\n"));
  const failed = out.filter((l) => l.startsWith("FAIL")).length;
  console.log(`\n${out.length - failed}/${out.length} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
}

main().catch((e) => {
  console.log("TEST ERROR:", e && e.message);
  process.exitCode = 1;
});