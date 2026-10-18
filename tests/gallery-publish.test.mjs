// End-to-end test of the two gallery changes: the Discord gate on upload, and
// publishing immediately instead of queueing.
//
// These were both originally committed without ever being executed, on the
// grounds that the Pages Functions need a live D1 binding. That turned out to be
// wrong - `npm test` already runs `wrangler pages dev` against a local D1, so
// the Function can be driven exactly as the browser would drive it. This suite
// is that missing verification, kept as a regression test rather than run once
// and forgotten.
//
// What it pins down:
//
//   1. No session            -> 401
//   2. Session, no Discord   -> 403, and nothing is stored
//   3. Session, Discord      -> 200 ok, and the item is public IMMEDIATELY
//   4. The bytes endpoint    -> serves a just-uploaded item with no owner code
//   5. Flagged art           -> still publishes, because the flag is advisory
//   6. The daily cap         -> still enforced, so "publish instantly" did not
//                               quietly become "publish without limit"
//
// Point 4 matters as much as 3. Both the listing and the image-bytes endpoint
// filter on status = 'approved', so a listing hit alone would not prove the item
// is actually servable - it is the bytes path that a real viewer hits.
//
// Run: node tests/gallery-publish.test.mjs   (or via `npm test`)

const BASE = "http://127.0.0.1:8788";

const LINKED = { uid: "gallinked1", token: "gallinked1token" };
const UNLINKED = { uid: "galunlinked1", token: "galunlinked1token" };

/* A real 1x1 PNG. The Function only checks the four-byte signature, but sending
   an actual image keeps the test honest if that check is ever tightened. */
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

async function post(token, body) {
  const res = await fetch(BASE + "/api/gallery", {
    method: "POST",
    headers: {
      ...(token ? { Cookie: `thw_session=${token}` } : {}),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch (_) {}
  return { status: res.status, json };
}

async function get(path) {
  const res = await fetch(BASE + path);
  return { status: res.status, res };
}

const submit = (title, caption) => ({
  action: "submit",
  title,
  caption,
  mime: "image/png",
  data: PNG_B64,
});

const out = [];
function check(name, pass, detail) {
  out.push(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  -> " + detail : ""}`);
  return pass;
}

/* Is this id in the PUBLIC listing, i.e. with no owner code supplied? */
async function publiclyListed(id) {
  const { res } = await get("/api/gallery?limit=50");
  if (!res.ok) return { listed: false, total: -1 };
  const body = await res.json();
  const items = body.items || [];
  return { listed: items.some((i) => Number(i.id) === Number(id)), total: items.length };
}

let ok = true;

// 1. no session
{
  const r = await post(null, submit("No Session", "should not be accepted"));
  ok = check("no session is refused", r.status === 401, `status=${r.status} err=${r.json && r.json.error}`) && ok;
}

// 2. signed in, no linked Discord
{
  const r = await post(UNLINKED.token, submit("Unlinked Upload", "should not be accepted"));
  const msg = String((r.json && r.json.error) || "");
  ok = check(
    "signed in WITHOUT a linked Discord is refused",
    r.status === 403 && /discord/i.test(msg),
    `status=${r.status} err="${msg}"`
  ) && ok;
  ok = check("  and it is not silently accepted", !(r.json && r.json.ok), `ok=${r.json && r.json.ok}`) && ok;
}

// 3. signed in, Discord linked -> published
let publishedId = null;
{
  const r = await post(LINKED.token, submit("Gate Test Piece", "a small test image for the publish check"));
  const good = r.status === 200 && r.json && r.json.ok === true && Number(r.json.id) > 0;
  ok = check("signed in WITH a linked Discord is accepted", good, `status=${r.status} id=${r.json && r.json.id}`) && ok;
  if (good) publishedId = Number(r.json.id);
}

// 4. visible to everyone, immediately, with no owner code
if (publishedId) {
  const { listed, total } = await publiclyListed(publishedId);
  ok = check("it appears in the PUBLIC listing with no owner code", listed, `id=${publishedId} listingSize=${total}`) && ok;

  const bytes = await get(`/api/gallery?id=${publishedId}`);
  ok = check(
    "its bytes are served publicly too (no owner code)",
    bytes.status === 200,
    `status=${bytes.status} contentType=${bytes.res.headers.get("content-type")}`
  ) && ok;
}

// 5. flagged art still publishes - the flag is advisory, not a gate
let flaggedId = null;
{
  const r = await post(LINKED.token, submit("Flagged Piece", "more at https://example.com/promo"));
  const good = r.status === 200 && r.json && r.json.ok === true;
  ok = check("art that trips an automated rule is still accepted", good, `status=${r.status} flagged=${JSON.stringify(r.json && r.json.flagged)}`) && ok;
  if (good) {
    flaggedId = Number(r.json.id);
    const { listed } = await publiclyListed(flaggedId);
    ok = check("  and flagged art is publicly visible, not held back", listed, `id=${flaggedId}`) && ok;
  }
}

// 6. the daily cap is still there
{
  let hit429 = null;
  let tries = 0;
  for (let i = 0; i < 15 && !hit429; i++) {
    tries++;
    const r = await post(LINKED.token, submit(`Cap Probe ${i}`, "filling the daily allowance"));
    if (r.status === 429) hit429 = r.json && r.json.error;
  }
  ok = check(
    "the 10/day cap is still enforced",
    !!hit429,
    hit429 ? `429 after ${tries} more uploads: "${hit429}"` : `no 429 after ${tries} attempts`
  ) && ok;
}

console.log(out.join("\n"));
const failed = out.filter((l) => l.startsWith("FAIL")).length;
console.log(`\n${out.length - failed}/${out.length} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
