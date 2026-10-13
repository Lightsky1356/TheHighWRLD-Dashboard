// End-to-end test of the notification opt-out fix.
//
// The bug: user_privacy.notifications_enabled was only honoured by ONE of the
// thirteen community_notifications writers, so a user who turned notifications
// off still received follows, replies, mentions, playlist favourites, drop
// alerts and moderation notices.
//
// This drives a real endpoint (POST /api/follows) as two signed-in users and
// asserts that an opted-out recipient gets nothing, while a recipient who has
// notifications on still does. Run against the local dev server.
//
// Requires two sessions to exist in local D1 - see seed-notif-test.md notes in
// the companion PowerShell block.

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

async function notificationsFor(uid) {
  const res = await fetch(BASE + "/api/notifications", {
    headers: { Cookie: `thw_session=${uid === ON.uid ? ON.token : OFF.token}` },
  });
  const j = await res.json();
  return (j.notifications || []).filter((n) => n.type === "follow");
}

async function main() {
  // Sanity: both recipients must be signed in.
  for (const who of [ON, OFF]) {
    const r = await call(who.token, "/api/social/settings");
    check(`${who.uid} session valid`, r.status === 200, `status=${r.status}`);
  }

  const beforeOn = (await notificationsFor(ON.uid)).length;
  const beforeOff = (await notificationsFor(OFF.uid)).length;

  // Actor follows the opted-IN user.
  let r = await call(ACTOR.token, "/api/follows", "POST", { action: "follow", uid: ON.uid });
  check("follow to opted-in recipient accepted", r.status === 200, `status=${r.status}`);
  r = await call(ACTOR.token, "/api/follows", "POST", { action: "unfollow", uid: ON.uid });
  await call(ACTOR.token, "/api/follows", "POST", { action: "follow", uid: ON.uid });

  const afterOn = (await notificationsFor(ON.uid)).length;
  check("opted-IN recipient DOES get a follow notification", afterOn > beforeOn, `${beforeOn} -> ${afterOn}`);

  // Actor follows the opted-OUT user. This is the case that was broken.
  r = await call(ACTOR.token, "/api/follows", "POST", { action: "follow", uid: OFF.uid });
  check("follow to opted-out recipient still accepted", r.status === 200, `status=${r.status}`);

  const afterOff = (await notificationsFor(OFF.uid)).length;
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