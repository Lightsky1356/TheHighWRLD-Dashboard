// End-to-end test of the notification opt-out fix.
//
// The bug: user_privacy.notifications_enabled was only honoured by ONE of the
// thirteen community_notifications writers, so a user who turned notifications
// off still received follows, replies, mentions, playlist favourites, drop
// alerts and moderation notices.
//
// This drives real endpoints as two signed-in users and asserts that an opted-out
// recipient gets nothing, while a recipient who has notifications on still does.
//
// Run against the local dev server. `npm test` applies migrations and seeds these
// three accounts first - see tests/seed.mjs. Before that existed the suite could
// only ever report "session invalid", and because the runner used to skip
// anything it could not run, that went unnoticed.

const BASE = "http://127.0.0.1:8788";

const ACTOR = { uid: "notifactor1", token: "notifactor1token" };
const ON = { uid: "notifon1", token: "notifontoken1" };
const OFF = { uid: "notifoff1", token: "notifofftoken1" };

async function call(token, path, method = "GET", body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { Cookie: `thw_session=${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch (_) {}
  return { status: res.status, json };
}

const out = [];
function check(name, pass, detail) {
  out.push(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  -> " + detail : ""}`);
}

/* The newest follow-notification id for one of the two recipients.

   This used to be a COUNT, and a count cannot work here. GET /api/notifications
   returns at most 40 rows (LIMIT 40 in functions/api/notifications.js), so once
   a recipient's window is full, a new notification pushes the oldest one out and
   the count stays flat. The suite then printed "40 -> 40" and concluded the
   opted-in recipient had not been notified - which was the test unable to see a
   row, not the row being absent.

   The newest id is monotonic and unaffected by the window, so "did a new
   notification arrive" becomes a strict comparison that cannot saturate. */
async function latestFollowId(who) {
  const res = await fetch(BASE + "/api/notifications", {
    headers: { Cookie: `thw_session=${who.token}` },
  });
  const j = await res.json();
  const rows = (j.notifications || []).filter((n) => n.type === "follow");
  return rows.reduce((max, n) => Math.max(max, Number(n.id) || 0), 0);
}

async function main() {
  // Sanity: both recipients must be signed in. If this fails, run
  // `node tests/seed.mjs` - the suite needs three accounts that do not exist in a
  // fresh local D1.
  for (const who of [ON, OFF]) {
    const r = await call(who.token, "/api/social/settings");
    check(`${who.uid} session valid`, r.status === 200, `status=${r.status}`);
  }

  const beforeOn = await latestFollowId(ON);
  const beforeOff = await latestFollowId(OFF);

  // Start from a clean relationship so `created` is meaningful.
  await call(ACTOR.token, "/api/follows", "POST", { action: "unfollow", uid: ON.uid });

  // Actor follows the opted-IN user.
  let r = await call(ACTOR.token, "/api/follows", "POST", { action: "follow", uid: ON.uid });
  check("follow to opted-in recipient accepted", r.status === 200, `status=${r.status}`);
  check(
    "a new follow reports created:true",
    r.json && r.json.created === true,
    JSON.stringify(r.json)
  );

  const afterOn = await latestFollowId(ON);
  check(
    "opted-IN recipient DOES get a follow notification",
    afterOn > beforeOn,
    `${beforeOn} -> ${afterOn}`
  );

  /* Following someone who already follows back must be a no-op for their inbox.
     POST /api/follows used INSERT OR IGNORE for the follow row but created the
     notification unconditionally, so a double-tap filled the target's list with
     duplicate "started following you" entries - the follow did not change, only
     their notifications did. */
  r = await call(ACTOR.token, "/api/follows", "POST", { action: "follow", uid: ON.uid });
  check(
    "re-following an existing follow reports created:false",
    r.json && r.json.created === false,
    JSON.stringify(r.json)
  );
  const afterRepeat = await latestFollowId(ON);
  check(
    "re-following does NOT duplicate the notification",
    afterRepeat === afterOn,
    `${afterOn} -> ${afterRepeat}`
  );

  // Actor follows the opted-OUT user. This is the case that was broken.
  r = await call(ACTOR.token, "/api/follows", "POST", { action: "follow", uid: OFF.uid });
  check("follow to opted-out recipient still accepted", r.status === 200, `status=${r.status}`);

  const afterOff = await latestFollowId(OFF);
  check(
    "opted-OUT recipient gets NO follow notification",
    afterOff === beforeOff,
    `${beforeOff} -> ${afterOff}`
  );

  // The follow itself must still exist - opt-out is about notifications only.
  const rel = await call(ACTOR.token, `/api/follows?uid=${OFF.uid}`);
  // The endpoint reports this as am_following, not following.
  check(
    "the follow relationship itself was still recorded",
    rel.json && rel.json.am_following === true,
    JSON.stringify(rel.json)
  );

  console.log(out.join("\n"));
  const failed = out.filter((l) => l.startsWith("FAIL")).length;
  console.log(`\n${out.length - failed}/${out.length} passed, ${failed} failed`);
  // Set exitCode rather than calling process.exit(): forcing an exit while
  // sockets are open trips a libuv assertion on Windows, which makes a passing
  // run look like a crash.
  process.exitCode = failed ? 1 : 0;
}

main().catch((e) => {
  console.log("TEST ERROR:", e && e.message);
  process.exitCode = 1;
});