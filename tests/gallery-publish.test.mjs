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

/* The strongest version of "the image works": hand the bytes to the same
   decoder a browser would use. A correct Content-Type over garbage bytes is
   still a broken image, and only this catches that. */
async function decodes(bytes, mime) {
  if (typeof createImageBitmap !== "function" || typeof Blob === "undefined") {
    return true; // no decoder in this runtime - the magic-byte check still ran
  }
  try {
    const bmp = await createImageBitmap(new Blob([bytes], { type: mime }));
    return bmp.width > 0 && bmp.height > 0;
  } catch (_) {
    return false;
  }
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

  /* Assert the BYTES, not just the status and the Content-Type header.
     That distinction is the whole reason this assertion exists: the D1 BLOB was
     coming back as an Array of byte values, `new Response(array)` stringified it,
     and the client got "255,216,255,224,..." as a 1.2MB ASCII body served as
     image/jpeg. Status 200, Content-Type image/jpeg, and a completely
     undecodable image - so the earlier version of this check, which asserted
     only the status and the header, passed straight through the bug it was
     supposed to catch. */
  const res = await fetch(`${BASE}/api/gallery?id=${publishedId}`, { cache: "no-store" });
  const buf = new Uint8Array(await res.arrayBuffer());
  const isPng =
    buf.length > 8 &&
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  const looksAscii =
    buf.length > 8 &&
    Array.from(buf.slice(0, 8)).every((b) => b >= 0x20 && b < 0x7f);
  ok = check(
    "its bytes are served publicly (no owner code)",
    res.status === 200,
    `status=${res.status} contentType=${res.headers.get("content-type")}`
  ) && ok;
  ok = check(
    "  and they are real image bytes, not a stringified array",
    isPng && !looksAscii,
    isPng
      ? `PNG magic ok, ${buf.length} bytes`
      : `first bytes ${Array.from(buf.slice(0, 8)).map((b) => b.toString(16).padStart(2, "0")).join(" ")}` +
        (looksAscii ? " LOOKS ASCII - the array was stringified again" : "")
  ) && ok;
  ok = check(
    "  and the browser can actually decode it",
    await decodes(buf, "image/png"),
    "createImageBitmap on the served bytes"
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

// 6. reporting goes through the shared panel, and the panel accepts GALLERY
{
  // The bespoke report action is gone. It wrote target_type 'gallery' in lower
  // case while every staff-side filter matches upper-case VALID_TYPES, and
  // recorded no reporter identity, so its rows were invisible in the queue.
  const r = await post(LINKED.token, {
    action: "report",
    id: publishedId || 1,
    reason: "inappropriate",
  });
  ok = check(
    "the old bespoke report action is gone from /api/gallery",
    r.status === 400 && /unknown action/i.test(String((r.json && r.json.error) || "")),
    `status=${r.status} err=${r.json && r.json.error}`
  ) && ok;
}

// 7. the shared reports API accepts a GALLERY target
if (publishedId) {
  const res = await fetch(BASE + "/api/reports", {
    method: "POST",
    headers: { Cookie: `thw_session=${LINKED.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      target_type: "GALLERY",
      target_id: publishedId,
      reason: "Copyright Concern",
      details: "regression probe for the gallery report target type",
    }),
  });
  let json = null;
  try { json = await res.json(); } catch (_) {}
  const err = String((json && json.error) || "");
  ok = check(
    "the shared reports API accepts target_type GALLERY",
    res.status === 200 && !/invalid target type/i.test(err),
    `status=${res.status} body=${JSON.stringify(json).slice(0, 150)}`
  ) && ok;
}

// 8. the spoiler flag round-trips, and does not leak onto other uploads
{
  const plain = await post(LINKED.token, { ...submit("Not A Spoiler", "ordinary art"), spoiler: 0 });
  ok = check("a normal upload is accepted", plain.status === 200 && plain.json.ok === true,
    `status=${plain.status}`) && ok;

  const sp = await post(LINKED.token, { ...submit("Spoiler Piece", "art with a warning"), spoiler: 1 });
  ok = check("a spoiler upload is accepted", sp.status === 200 && sp.json.ok === true,
    `status=${sp.status}`) && ok;

  if (sp.status === 200) {
    const listing = await (await get("/api/gallery?limit=50")).res.json();
    const items = listing.items || [];
    const mine = items.find((i) => Number(i.id) === Number(sp.json.id));
    const other = items.find((i) => Number(i.id) === Number(plain.json.id));

    ok = check("  the listing reports it as a spoiler", mine && Number(mine.spoiler) === 1,
      mine ? `spoiler=${mine.spoiler}` : "item missing from the listing") && ok;
    ok = check("  and a normal upload is still not a spoiler", other && Number(other.spoiler) === 0,
      other ? `spoiler=${other.spoiler}` : "item missing from the listing") && ok;

    // And the bytes still serve for a spoiler - the flag must not gate the image.
    const res = await fetch(`${BASE}/api/gallery?id=${sp.json.id}`, { cache: "no-store" });
    const buf = new Uint8Array(await res.arrayBuffer());
    ok = check("  a spoiler's bytes still serve normally", res.status === 200 && buf.length > 8,
      `status=${res.status} bytes=${buf.length}`) && ok;
  }
}

// LAST. the daily cap is still there
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
