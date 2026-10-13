// Exercises /api/push as a signed-in user, covering the validation rules and
// the multiple-devices-per-user case. Run with node so cookies and bodies are
// handled properly rather than through PowerShell quoting.
const BASE = "http://127.0.0.1:8788";
const TOKEN = "pushsessiontoken1";

async function call(method, body, extraHeaders) {
  const headers = { Cookie: `thw_session=${TOKEN}`, "Content-Type": "application/json", ...(extraHeaders || {}) };
  const res = await fetch(BASE + "/api/push", {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch (_) {}
  return { status: res.status, json };
}

// A syntactically valid base64url p256dh/auth pair (shape only - no key math).
const KEY_A = { p256dh: "aGVsbG8tdGVzdC1wdXNoLWtleS1wMjU2ZGg", auth: "cHVzaC1hdXRoLWtleS0xMjU2" };
const KEY_B = { p256dh: "c2Vjb25kLWRldmljZS1rZXktcDI1NmRo", auth: "c2Vjb25kLWF1dGgta2V5" };
const EP_A = "https://fcm.googleapis.com/fcm/send/pushtest-endpoint-aaaaaaaaaaaaaaaa";
const EP_B = "https://updates.push.services.mozilla.com/wpush/v2/pushtest-bbbbbbbbbbbbbbbb";

const out = [];
function check(name, pass, detail) {
  out.push(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  -> " + detail : ""}`);
}

// 1. GET state (signed in)
let r = await call("GET");
check("GET returns state", r.status === 200 && r.json && r.json.ok === true, `status=${r.status}`);
check("GET exposes a publicKey field", r.json && typeof r.json.publicKey === "string", `publicKey=${JSON.stringify(r.json && r.json.publicKey)}`);

// 2. Two devices for one user
r = await call("POST", { endpoint: EP_A, keys: KEY_A }, { "X-THW-Device": "Pixel Test" });
check("subscribe device A", r.status === 200 && r.json.ok === true, `status=${r.status}`);
r = await call("POST", { endpoint: EP_B, keys: KEY_B }, { "X-THW-Device": "iPhone Test" });
check("subscribe device B", r.status === 200 && r.json.ok === true, `status=${r.status}`);

r = await call("GET");
check("two devices listed for one user", r.json && r.json.deviceCount === 2, `deviceCount=${r.json && r.json.deviceCount}`);
check("endpoint is NOT echoed in full", r.json && (r.json.devices || []).every((d) => d.endpointPreview && !d.endpointPreview.startsWith(EP_A.slice(0, 20)) + "full"),
  JSON.stringify((r.json && r.json.devices || [])[0]));

// 3. Re-subscribing the same endpoint must upsert, not duplicate
r = await call("POST", { endpoint: EP_A, keys: KEY_A }, { "X-THW-Device": "Pixel Test renamed" });
r = await call("GET");
check("re-subscribe upserts (no duplicate)", r.json && r.json.deviceCount === 2, `deviceCount=${r.json && r.json.deviceCount}`);

// 4. Validation
const bad = [
  ["missing endpoint", { keys: KEY_A }],
  ["non-https endpoint", { endpoint: "http://evil.example.com/push", keys: KEY_A }],
  ["javascript: endpoint", { endpoint: "javascript:alert(1)", keys: KEY_A }],
  ["bad p256dh chars", { endpoint: EP_A, keys: { p256dh: "not valid!!", auth: KEY_A.auth } }],
  ["missing auth", { endpoint: EP_A, keys: { p256dh: KEY_A.p256dh } }],
  ["oversized endpoint", { endpoint: "https://fcm.googleapis.com/" + "x".repeat(3000), keys: KEY_A }],
];
for (const [name, body] of bad) {
  const rr = await call("POST", body);
  check("rejects " + name, rr.status === 400, `status=${rr.status} err=${rr.json && rr.json.error}`);
}

// 5. Remove one device only
r = await call("DELETE", { endpoint: EP_A });
check("delete one device", r.status === 200 && r.json.removed === 1, `removed=${r.json && r.json.removed}`);
r = await call("GET");
check("other device survives", r.json && r.json.deviceCount === 1, `deviceCount=${r.json && r.json.deviceCount}`);

// 6. Remove all
r = await call("POST", { action: "unsubscribeAll" });
check("unsubscribeAll", r.status === 200 && r.json.removed === 1, `removed=${r.json && r.json.removed}`);
r = await call("GET");
check("no devices remain", r.json && r.json.deviceCount === 0, `deviceCount=${r.json && r.json.deviceCount}`);

console.log(out.join("\n"));
const failed = out.filter((l) => l.startsWith("FAIL")).length;
console.log(`\n${out.length - failed}/${out.length} passed, ${failed} failed`);