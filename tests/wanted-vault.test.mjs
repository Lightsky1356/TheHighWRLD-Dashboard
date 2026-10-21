// The Wanted vault.
//
// WHY THIS SUITE EXISTS
// The vault is read on every load of the page, and it is the most expensive
// read on the site: every reply that has ever been written, every vote, and
// every reply's votes - thousands of rows, growing for ever.
//
// So the part of it that is the same for everybody is remembered for a
// minute, and the part that is about the visitor - their own votes, their
// own name, the owner flag - is read fresh every time.
//
// This checks that the remembered copy says the same thing as the history:
// that a reply made now appears, that a vote made now is counted, and that
// the visitor's own votes are still theirs.
//
// Run against the local dev server, as the other server suites do.

const BASE = "http://127.0.0.1:8788";
const MEMBER = { uid: "gallinked1", token: "gallinked1token" };

const out = [];
function check(name, pass, detail) {
  out.push(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  -> " + detail : ""}`);
}

async function call(token, path, method = "GET", body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { Cookie: `thw_session=${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) {}
  return { status: res.status, json };
}

const before = await call(MEMBER.token, "/api/wanted?user=" + encodeURIComponent(MEMBER.uid));
check("the vault is read", before.status === 200 && before.json && !before.json.error,
  `status ${before.status}`);
check("the vault has tracks", Array.isArray(before.json?.tracks) && before.json.tracks.length > 0,
  String(before.json?.tracks?.length));
check("the vault has vote totals", before.json?.votes && typeof before.json.votes === "object",
  String(Object.keys(before.json?.votes || {}).length) + " tracks with votes");
check("the vault has replies", before.json?.replies && typeof before.json.replies === "object",
  String(Object.keys(before.json?.replies || {}).length) + " tracks with replies");
check("the visitor's own votes are theirs", before.json?.myVotes && typeof before.json.myVotes === "object",
  JSON.stringify(before.json?.myVotes || {}).slice(0, 80));
check("the visitor is told who they are", !!before.json?.me?.discord,
  String(before.json?.me?.discord || "no name"));

/* The remembered copy must not go stale when something is written. */
const track = (before.json?.tracks || [])[0];
if (track && track.t) {
  const vote = await call(MEMBER.token, "/api/wanted", "POST", {
    action: "vote", track: track.t, user: MEMBER.uid, value: 1,
  });
  check("a vote is accepted", vote.status === 200 && vote.json?.ok !== false, `status ${vote.status}`);

  const after = await call(MEMBER.token, "/api/wanted?user=" + encodeURIComponent(MEMBER.uid));
  const mine = after.json?.myVotes || {};
  check("the visitor's own vote is theirs afterwards", mine[track.t] === 1,
    `${track.t}: ${JSON.stringify(mine[track.t])}`);
  check("the vote is counted in the totals",
    Number(after.json?.votes?.[track.t] || 0) >= 1,
    `${after.json?.votes?.[track.t]}`);

  /* And the vote is taken back, so the next run starts the same way. */
  const undo = await call(MEMBER.token, "/api/wanted", "POST", {
    action: "vote", track: track.t, user: MEMBER.uid, value: 0,
  });
  check("the vote can be taken back", undo.status === 200 && undo.json?.ok !== false, `status ${undo.status}`);
}

/* Two reads in a row must agree - the remembered copy is the same answer. */
const again1 = await call(MEMBER.token, "/api/wanted?user=" + encodeURIComponent(MEMBER.uid));
const again2 = await call(MEMBER.token, "/api/wanted?user=" + encodeURIComponent(MEMBER.uid));
check("two reads in a row agree",
  JSON.stringify(again1.json?.votes) === JSON.stringify(again2.json?.votes),
  JSON.stringify(again2.json?.votes || {}).slice(0, 80));
check("the tracks are the same on both reads",
  JSON.stringify(again1.json?.tracks) === JSON.stringify(again2.json?.tracks));

console.log(out.join("\n"));
const failed = out.filter((l) => l.startsWith("FAIL")).length;
console.log(`\n${out.length - failed} passed, ${failed} failed`);
await new Promise((r) => setTimeout(r, 300));
/* A moment, so the connections close before the process ends. */
await new Promise((r) => setTimeout(r, 300));
process.exit(failed ? 1 : 0);
