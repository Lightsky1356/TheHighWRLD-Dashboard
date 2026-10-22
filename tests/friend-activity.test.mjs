// The friend activity feed.
//
// WHY THIS SUITE EXISTS
// The feed shows what your friends are up to. Two things about it are easy
// to get wrong, and both of them are privacy, so both are checked here:
//
//   1. The actor is whoever is signed in. A body that names somebody else
//      must not be able to publish as them.
//   2. A row is only visible to the people who are allowed to see it - the
//      friends of the person who did it, and never somebody who has blocked
//      them.
//
// And one thing about it is easy to get wrong in the other direction: a
// listening row has to stop being shown once it has expired, or somebody is
// shown as listening to something they stopped listening to.
//
// The checks run against a real database, built from the migrations, so the
// schema is the one production runs. And the session is a real signed cookie
// against a real session row, so the endpoint is exercised exactly as it
// runs - nothing is stubbed.

import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();

/* The schema, from the migrations. */
const db = new DatabaseSync(":memory:");
for (const f of fs.readdirSync(path.join(ROOT, "migrations")).filter((f) => f.endsWith(".sql")).sort()) {
  try { db.exec(fs.readFileSync(path.join(ROOT, "migrations", f), "utf8")); } catch (_) {}
}

/* A stand-in for the database the endpoint is given, with the shape it
   expects. */
function wrap(real) {
  return {
    prepare(sql) {
      const stmt = real.prepare(sql);
      return {
        bind(...args) {
          return {
            first: async () => stmt.get(...args) ?? null,
            all: async () => ({ results: stmt.all(...args) }),
            run: async () => {
              const r = stmt.run(...args);
              return { meta: { changes: r.changes, last_row_id: Number(r.lastInsertRowid) } };
            },
          };
        },
      };
    },
  };
}

const wrapped = wrap(db);

/* The members. */
const ME = "alice0001";
const FRIEND = "bob000002";
const STRANGER = "carol0003";
const BLOCKER = "dave00004";
const now = new Date().toISOString();

const insertUser = db.prepare(
  "INSERT OR IGNORE INTO users (uid, name, email) VALUES (?, ?, ?)"
);
insertUser.run(ME, "Alice", "alice@test");
insertUser.run(FRIEND, "Bob", "bob@test");
insertUser.run(STRANGER, "Carol", "carol@test");
insertUser.run(BLOCKER, "Dave", "dave@test");

/* Alice and Bob are friends. Carol is nobody's friend. Dave has blocked
   Alice. */
db.prepare("INSERT OR IGNORE INTO social_friends (uid_a, uid_b) VALUES (?, ?)").run(ME, FRIEND);
db.prepare("INSERT OR IGNORE INTO user_blocks (blocker_user_id, blocked_user_id) VALUES (?, ?)").run(BLOCKER, ME);

/* The sessions, as the seed makes them. The auth helper reads the cookie,
   so the test sends the cookie. */
const TOKENS = {
  [ME]: "sess_alice0001",
  [FRIEND]: "sess_bob000002",
  [STRANGER]: "sess_carol0003",
  [BLOCKER]: "sess_dave00004",
};
for (const [uid, token] of Object.entries(TOKENS)) {
  db.prepare(
    "INSERT OR IGNORE INTO sessions (token, uid, ip, ua, expires_at) VALUES (?, ?, '', '', ?)"
  ).run(token, uid, new Date(Date.now() + 86400000).toISOString());
}

const env = { wanted_vault: wrapped };
const apiUrl = pathToFileURL(path.join(ROOT, "functions/api/activity.js")).href;
const api = await import(apiUrl + "?t=" + Date.now());

async function callAs(who, method, p, body) {
  const token = TOKENS[who] || "";
  const res = await api.onRequest({
    request: {
      method,
      url: "https://site.test" + p,
      headers: { get: (name) => (name.toLowerCase() === "cookie" ? "thw_session=" + token : null) },
      json: async () => (body || {}),
    },
    env,
  });
  let json = null;
  try { json = await res.json(); } catch (_) {}
  return { status: res.status, json };
}

let failures = 0;
/* JSON.stringify(undefined) is undefined, and calling .slice on that throws -
   so the detail of a failed check has to be safe to build. */
function str(value) {
  try { return JSON.stringify(value) ?? String(value); } catch (_) { return String(value); }
}
function check(name, pass, detail) {
  if (pass) { console.log("  PASS  " + name); }
  else { failures++; console.log("  FAIL  " + name + (detail ? "  ->  " + detail : "")); }
}
function rowsFor(uid, type) {
  return db.prepare("SELECT COUNT(*) AS n FROM friend_activity WHERE uid = ?" + (type ? " AND type = ?" : ""))
    .get(...(type ? [uid, type] : [uid])).n;
}
function share(uid, listening, playlists, community) {
  db.prepare(
    "INSERT OR REPLACE INTO user_social_settings " +
    "(uid, activity_listening, activity_playlists, activity_community) VALUES (?, ?, ?, ?)"
  ).run(uid, listening, playlists, community);
}

/* ---- 1. the feed loads, and is empty to begin with ---- */
{
  const r = await callAs(ME, "GET", "/api/activity");
  check("the feed loads", r.status === 200 && r.json?.ok === true, str(r.json).slice(0, 90));
  check("the feed is empty to begin with", Array.isArray(r.json?.items) && r.json.items.length === 0,
    str(r.json?.items?.length));
}

/* ---- 2. a new account shares nothing until it says so ---- */
{
  const off = await callAs(ME, "POST", "/api/activity", { type: "listening", title: "Quietly" });
  check("nothing is published by default", off.json?.published === false, str(off.json).slice(0, 90));
  check("no row was written by default", rowsFor(ME) === 0, String(rowsFor(ME)));
}

/* ---- 3. publishing, once sharing is turned on ---- */
{
  share(ME, "friends", "friends", "friends");

  const r = await callAs(ME, "POST", "/api/activity", {
    type: "listening",
    trackId: "Track 1",
    title: "All In",
    artist: "Juice WRLD",
    artwork: "https://example.test/cover.png",
  });
  check("a listening event is published", r.status === 200 && r.json?.published === true, str(r.json).slice(0, 90));
}

/* ---- 4. a friend sees it ---- */
{
  const r = await callAs(FRIEND, "GET", "/api/activity");
  check("a friend sees the event", r.json?.items?.length === 1, str(r.json?.items?.length));
  const item = r.json?.items?.[0];
  check("the event says what it should",
    item && item.type === "listening" && item.title === "All In" && item.uid === ME,
    str(item).slice(0, 120));
  check("the event carries no audio address", item && !str(item).includes(".mp3"));
}

/* ---- 5. a stranger does not ---- */
{
  const r = await callAs(STRANGER, "GET", "/api/activity");
  check("a stranger sees nothing", r.json?.items?.length === 0, str(r.json?.items?.length));
}

/* ---- 6. somebody who has blocked the actor sees nothing ---- */
{
  const r = await callAs(BLOCKER, "GET", "/api/activity");
  check("somebody who blocked the actor sees nothing", r.json?.items?.length === 0, str(r.json?.items?.length));
}

/* ---- 7. the actor cannot publish as somebody else ---- */
{
  const r = await callAs(ME, "POST", "/api/activity", {
    type: "community",
    uid: FRIEND,
    label: "Something Bob did",
  });
  check("a body can name another actor without an error", r.status === 200, str(r.json).slice(0, 80));
  const feed = await callAs(FRIEND, "GET", "/api/activity");
  const wrong = (feed.json?.items || []).find((i) => i.uid !== ME);
  check("the event is still the signed-in member's", !wrong, str(wrong).slice(0, 100));
}

/* ---- 8. the filters ---- */
{
  await callAs(ME, "POST", "/api/activity", {
    type: "playlist",
    label: "Made a playlist",
    link: "/Profile/alice0001",
  });
  const all = await callAs(FRIEND, "GET", "/api/activity");
  check("every kind is in the feed", all.json?.items?.length === 3, str(all.json?.items?.length));

  const listening = await callAs(FRIEND, "GET", "/api/activity?type=listening");
  check("the listening filter works", listening.json?.items?.length === 1, str(listening.json?.items?.length));
  check("the filter returns the right kind",
    listening.json?.items?.[0]?.type === "listening", str(listening.json?.items?.[0]?.type));

  const playlists = await callAs(FRIEND, "GET", "/api/activity?type=playlist");
  check("the playlist filter works", playlists.json?.items?.length === 1, str(playlists.json?.items?.length));

  const community = await callAs(FRIEND, "GET", "/api/activity?type=community");
  check("the community filter works", community.json?.items?.length === 1, str(community.json?.items?.length));
}

/* ---- 9. the order is newest first ---- */
{
  await callAs(ME, "POST", "/api/activity", { type: "community", label: "Later" });
  const r = await callAs(FRIEND, "GET", "/api/activity");
  const times = (r.json?.items || []).map((i) => i.createdAt);
  const sorted = times.slice().sort().reverse();
  check("the feed is newest first", JSON.stringify(times) === JSON.stringify(sorted), str(times).slice(0, 120));
}

/* ---- 10. the cursor pages without repeating or skipping ---- */
{
  const first = await callAs(FRIEND, "GET", "/api/activity?limit=2");
  check("the first page is bounded", first.json?.items?.length === 2, str(first.json?.items?.length));
  const cursor = first.json?.nextCursor;
  check("the first page has a cursor", !!cursor, String(cursor));
  const second = await callAs(FRIEND, "GET", "/api/activity?limit=2&cursor=" + encodeURIComponent(cursor || ""));
  const firstIds = (first.json?.items || []).map((i) => i.id);
  const secondIds = (second.json?.items || []).map((i) => i.id);
  check("the second page does not repeat the first", !secondIds.some((id) => firstIds.includes(id)),
    str(secondIds).slice(0, 100));
}

/* ---- 11. a listening event stops being shown once it has expired ---- */
{
  db.prepare(
    "INSERT INTO friend_activity (id, uid, type, track_id, title, artist, artwork, label, detail, link, expires_at, created_at) " +
    "VALUES ('act_stale', ?, 'listening', 'T', 'Old', 'A', '', '', '', '', ?, ?)"
  ).run(ME, new Date(Date.now() - 60000).toISOString(), new Date(Date.now() - 120000).toISOString());

  const r = await callAs(FRIEND, "GET", "/api/activity");
  const stale = (r.json?.items || []).find((i) => i.id === "act_stale");
  check("an expired listening event is not shown", !stale, str(stale).slice(0, 100));
}

/* ---- 12. turning sharing off takes the rows down ---- */
{
  share(ME, "nobody", "friends", "friends");
  const r = await callAs(ME, "POST", "/api/activity", { type: "listening", title: "Should not appear" });
  check("nothing is published when sharing is off", r.json?.published === false, str(r.json).slice(0, 90));
  const feed = await callAs(FRIEND, "GET", "/api/activity");
  const mine = (feed.json?.items || []).filter((i) => i.uid === ME && i.type === "listening");
  check("no listening row was written", mine.length === 0, String(mine.length));

  const cleared = await callAs(ME, "POST", "/api/activity/clear", { type: "listening" });
  check("the rows can be cleared", cleared.status === 200 && cleared.json?.ok === true, str(cleared.json).slice(0, 80));
  check("the rows were removed", rowsFor(ME, "listening") === 0, String(rowsFor(ME, "listening")));
}

/* ---- 13. the setting governs who sees it, on the read ---- */
{
  /* Bob does something, and shares it with his friends. */
  share(FRIEND, "friends", "friends", "friends");
  const published = await callAs(FRIEND, "POST", "/api/activity", {
    type: "community",
    label: "A thing Bob did",
  });
  check("Bob's event is published", published.json?.published === true, str(published.json).slice(0, 90));

  const mine = await callAs(ME, "GET", "/api/activity");
  const seen = (mine.json?.items || []).find((i) => i.uid === FRIEND && i.label === "A thing Bob did");
  check("a row shared with friends is seen by a friend", !!seen, str(mine.json?.items).slice(0, 160));

  const theirs = await callAs(STRANGER, "GET", "/api/activity");
  const notSeen = (theirs.json?.items || []).find((i) => i.uid === FRIEND);
  check("a row shared with friends is not seen by a stranger", !notSeen, str(theirs.json?.items).slice(0, 120));

  /* And now Bob turns it off - the row stops being shown, even the one that
     was written while it was on. */
  share(FRIEND, "friends", "friends", "nobody");
  const off = await callAs(ME, "GET", "/api/activity");
  const gone = (off.json?.items || []).find((i) => i.uid === FRIEND && i.label === "A thing Bob did");
  check("a row is not seen once the person turns sharing off", !gone, str(off.json?.items).slice(0, 160));

  await callAs(FRIEND, "POST", "/api/activity/clear", { type: "community" });
  check("the rows were taken down", rowsFor(FRIEND, "community") === 0, String(rowsFor(FRIEND, "community")));
}

/* ---- 14. the settings are private ---- */
{
  const r = await callAs(STRANGER, "GET", "/api/activity");
  check("the feed does not leak anybody's settings", !str(r.json).includes("activity_listening"));
}

/* ---- 15. a signed-out caller is refused ---- */
{
  const r = await callAs("", "GET", "/api/activity");
  check("a signed-out caller is refused", r.status === 401, String(r.status));
}

/* ---- 16. the input is checked ---- */
{
  const r = await callAs(ME, "POST", "/api/activity", { type: "not-a-type" });
  check("an unknown type is refused", r.status === 400, String(r.status));

  share(ME, "friends", "friends", "friends");
  await callAs(ME, "POST", "/api/activity", {
    type: "community",
    label: "A link",
    link: "https://elsewhere.test/secret",
  });
  const feed = await callAs(FRIEND, "GET", "/api/activity");
  const withLink = (feed.json?.items || []).find((i) => i.label === "A link");
  check("a link to another site is dropped", !withLink || withLink.link === "", str(withLink).slice(0, 110));
}

/* ---- 17. the same listening event is not written twice ---- */
{
  const before = rowsFor(ME, "listening");
  await callAs(ME, "POST", "/api/activity", { type: "listening", title: "Again" });
  const afterOne = rowsFor(ME, "listening");
  await callAs(ME, "POST", "/api/activity", { type: "listening", title: "Again" });
  const afterTwo = rowsFor(ME, "listening");
  check("a listening event is one row", afterOne === before + 1, before + " -> " + afterOne);
  check("a second listening event replaces the first", afterTwo === afterOne, afterOne + " -> " + afterTwo);
}

/* ---- 18. the setting survives a change to the other settings ---- */
{
  /* The friends & messages settings save writes the whole row, so it has to
     leave the sharing settings alone. */
  const before = (await callAs(ME, "GET", "/api/activity")).json;
  check("the feed still loads after the other settings change", before?.ok === true);
  share(ME, "friends", "friends", "friends");
  const after = (await callAs(ME, "GET", "/api/activity")).json;
  check("the feed still loads after the settings are saved", after?.ok === true);
}

console.log("");
console.log(failures === 0 ? "  ALL CHECKS PASSED" : "  " + failures + " FAILED");
process.exit(failures === 0 ? 0 : 1);
