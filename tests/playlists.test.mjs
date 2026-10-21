// The playlists on the account and the profile.
//
// WHY THIS SUITE EXISTS
// The tracks of every playlist used to be asked for one playlist at a time,
// so a member with a dozen playlists ran a dozen queries every time their
// account was read - and the account is read on every load and again after
// every save. They are now asked for once, in one go.
//
// A change like that can lose a playlist's tracks without anything looking
// wrong, so this makes a playlist with tracks on it and checks that both
// the account and the profile still list it, with its tracks and its count.
//
// Run against the local dev server, as the other server suites do.

const BASE = "http://127.0.0.1:8788";
const MEMBER = { uid: "notifon1", token: "notifontoken1" };

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

/* A playlist with two tracks on it. */
const name = "Playlist Test " + Date.now();
const created = await call(MEMBER.token, "/api/playlists", "POST", { action: "create", name, desc: "for the test" });
check("the playlist is made", created.status === 200 && created.json?.ok === true,
  `status ${created.status} ${JSON.stringify(created.json || {}).slice(0, 100)}`);

const pid = created.json?.playlist?.id ?? created.json?.id;
if (!pid) {
  console.log(out.join("\n"));
  console.log("\nno playlist was made, so there is nothing to check");
  process.exit(1);
}

for (const title of ["Track One", "Track Two"]) {
  const r = await call(MEMBER.token, "/api/playlists", "POST", { action: "add", id: pid, title });
  check(`the track "${title}" is added`, r.status === 200 && r.json?.ok !== false, `status ${r.status}`);
}

/* The account lists it, with its tracks and its count. */
const account = await call(MEMBER.token, "/api/account?user=" + encodeURIComponent(MEMBER.uid));
check("the account reads", account.status === 200 && account.json?.ok === true, `status ${account.status}`);
const accList = account.json?.playlists || [];
const accPl = accList.find((p) => Number(p.id) === Number(pid));
check("the account lists the playlist", !!accPl, accList.map((p) => p.id).join(", "));
check("the account gives it its tracks", accPl && Array.isArray(accPl.tracks) && accPl.tracks.length === 2,
  accPl ? String((accPl.tracks || []).length) : "no playlist");
check("the account counts them", accPl && Number(accPl.count) === 2, accPl ? String(accPl.count) : "no playlist");

/* And the profile does. */
const profile = await call(MEMBER.token, "/api/profile?user=" + encodeURIComponent(MEMBER.uid));
check("the profile reads", profile.status === 200 && profile.json?.ok === true, `status ${profile.status}`);
const proList = profile.json?.playlists || [];
const proPl = proList.find((p) => Number(p.id) === Number(pid));
check("the profile lists the playlist", !!proPl, proList.map((p) => p.id).join(", "));
check("the profile gives it its tracks", proPl && Array.isArray(proPl.tracks) && proPl.tracks.length === 2,
  proPl ? String((proPl.tracks || []).length) : "no playlist");
check("the profile counts them", proPl && Number(proPl.count) === 2, proPl ? String(proPl.count) : "no playlist");

/* The tracks are the right ones. */
const titles = ((accPl && accPl.tracks) || []).map((t) => t.title).sort();
check("the tracks are the right ones",
  titles.length === 2 && titles[0] === "Track One" && titles[1] === "Track Two",
  titles.join(", "));

/* The playlist is removed again, so the next run starts from the same
   place. */
const removed = await call(MEMBER.token, "/api/playlists", "POST", { action: "delete", id: pid });
check("the playlist is removed again", removed.status === 200 || removed.status === 404, `status ${removed.status}`);

console.log(out.join("\n"));
const failed = out.filter((l) => l.startsWith("FAIL")).length;
console.log(`\n${out.length - failed} passed, ${failed} failed`);
await new Promise((r) => setTimeout(r, 300));
process.exit(failed ? 1 : 0);
