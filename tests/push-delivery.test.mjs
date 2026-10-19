// The device push path.
//
// A notification has three delivery routes, and only one of them reaches
// someone who has the app closed:
//
//   1. the community_notifications row - a badge, seen on next open
//   2. the hub broadcast - a WebSocket, and a WebSocket only exists while a
//      tab is open
//   3. the device push - the push service wakes the service worker
//
// Route 3 was fully built - the service worker handler, the VAPID sender, the
// subscription API, the opt-in UI - but nothing called it except
// /api/push-test. A reply to a closed app was invisible until the user
// happened to open it.
//
// What is asserted here:
//
//   - a notification actually REACHES the push path, and the attempt is
//     visible without reading the database
//   - the push toggle suppresses it
//   - the payload carries the KIND of event and nothing else. A payload that
//     leaked a post title or a reply body would be shown on a lock screen,
//     which is not the same audience as the app.
//
// EVERYTHING GOES THROUGH THE API
// An earlier version of this suite seeded rows with `wrangler d1 execute
// --local` while the dev server was running, and the write reset the server's
// connection to the local database - the next fetch came back with ECONNRESET,
// every time, at the same point. So the subscription and the preference are
// both set through the API that the app itself uses, and the attempt is
// observed through GET /api/push, which reports a failureCount per device.
//
// A failed send is what the signal is, and it is the honest one: the fake
// endpoint cannot succeed, so every attempt is recorded as a failure and the
// counter moves. That proves the push path was reached and attempted. It does
// NOT prove a device displayed anything - that needs a real push service and a
// real device, which is what /api/push-test is for.

import { pushPayloadFor } from "../functions/_lib/notifications.js";

const BASE = "http://127.0.0.1:8788";
const RECIPIENT = { uid: "notifon1", token: "notifontoken1" };
const ACTOR = { uid: "notifactor1", token: "notifactor1token" };

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
  let json = null;
  try { json = await res.json(); } catch (_) {}
  return { status: res.status, json };
}

/* A syntactically valid endpoint that points nowhere. validEndpointShape only
   checks that it is https with a hostname, so this is accepted, and the send
   then fails - which is the signal. */
const FAKE_ENDPOINT = "https://fcm.googleapis.com/fcm/send/thw-test-endpoint-that-does-not-exist";
const FAKE_KEYS = {
  p256dh: "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U",
  auth: "8eDyX_uNl0qV9wHK7CFml-9o1YfYir6Y5Rn9Y0",
};

async function subscribe() {
  // Clear anything left over, then subscribe through the API.
  await call(RECIPIENT.token, "/api/push", "POST", { action: "unsubscribeAll" });
  const r = await call(RECIPIENT.token, "/api/push", "POST", {
    endpoint: FAKE_ENDPOINT,
    keys: FAKE_KEYS,
  });
  return r;
}

async function setPushPref(on) {
  return call(RECIPIENT.token, "/api/notification-settings", "POST", { push: on ? 1 : 0 });
}

async function deviceState() {
  const r = await call(RECIPIENT.token, "/api/push");
  const devices = r.json?.devices || [];
  return {
    count: devices.length,
    failures: devices.length ? Number(devices[0].failureCount || 0) : 0,
  };
}

/* The push is dispatched with ctx.waitUntil where the runtime provides it, so
   it can still be in flight when the triggering request returns. Reading the
   state straight away is a race. */
const settle = () => new Promise((r) => setTimeout(r, 1200));

/* The push path was reached if EITHER the attempt was recorded as a failure OR
   the dead subscription was pruned. Locally there is no VAPID key, so the send
   fails before it leaves and the failure counter moves. With a key, the request
   really goes to the push service, which answers 404 for an endpoint that does
   not exist - and a 404 prunes the subscription, so there is no counter left to
   read. Both mean the same thing: the push path was reached. */
function reached(before, after) {
  return after.failures > before.failures || after.count < before.count;
}

/** Make a notification happen: a follow notifies the recipient. */
async function notifyRecipient() {
  await call(ACTOR.token, "/api/follows", "POST", { action: "unfollow", uid: RECIPIENT.uid });
  return call(ACTOR.token, "/api/follows", "POST", { action: "follow", uid: RECIPIENT.uid });
}

// ---- the payload must not carry content -------------------------------------
{
  const p = pushPayloadFor({ type: "reply", message: "SECRET POST TITLE", actorName: "SECRET ACTOR" }, 7);
  const blob = JSON.stringify(p);
  check("the payload does not carry the message body", !blob.includes("SECRET POST TITLE"), blob);
  check("the payload does not carry the actor name", !blob.includes("SECRET ACTOR"), blob);
  check("the payload names the kind of event", p.title === "New reply" && /replied/.test(p.body), JSON.stringify(p));
  check("the payload has a tag", typeof p.tag === "string" && p.tag.length > 0, p.tag);
  check("the reply payload routes to the community page", p.url === "community", p.url);

  const s = pushPayloadFor(
    { type: "dm_message", pushTitle: "TheHighWRLD", pushBody: "Alice sent you a message", pushTag: (id) => "thw-dm-" + id },
    42,
  );
  check("a caller's wording is honoured", s.title === "TheHighWRLD" && s.body === "Alice sent you a message", JSON.stringify(s));
  check("a caller's tag function receives the row id", s.tag === "thw-dm-42", s.tag);
  check("a caller's tag is per notification, not per kind", s.tag !== pushPayloadFor({ type: "dm_message" }, 43).tag, s.tag);
}

// ---- a notification reaches the push path ------------------------------------
{
  const sub = await subscribe();
  check("the device subscribed through the API", sub.status === 200 && sub.json?.subscribed, `status=${sub.status}`);

  await setPushPref(1);
  const before = await deviceState();

  const n = await notifyRecipient();
  check("the notification was created", n.status === 200, `status=${n.status}`);

  await settle();
  const after = await deviceState();
  check(
    "the push path was reached - a send was attempted",
    reached(before, after),
    `devices ${before.count}->${after.count}, failureCount ${before.failures}->${after.failures}`,
  );
}

// ---- the push toggle suppresses it ------------------------------------------
{
  await subscribe();
  await setPushPref(0);
  const before = await deviceState();

  await notifyRecipient();
  await settle();

  const after = await deviceState();
  check("no push was attempted with the push toggle off", !reached(before, after), `devices ${before.count}->${after.count}, failureCount ${before.failures}->${after.failures}`);

  const bell = await call(RECIPIENT.token, "/api/notifications");
  check("the in-app notification is still created with push off", (bell.json?.unread ?? 0) > 0, `unread=${bell.json?.unread}`);
}

// ---- no subscription must not break anything ---------------------------------
{
  await call(RECIPIENT.token, "/api/push", "POST", { action: "unsubscribeAll" });
  await setPushPref(1);
  const n = await notifyRecipient();
  check("a notification with no subscribed device still succeeds", n.status === 200, `status=${n.status}`);
}

// ---- tidy up ----------------------------------------------------------------
{
  await call(RECIPIENT.token, "/api/push", "POST", { action: "unsubscribeAll" });
  await setPushPref(1);
}

console.log(out.join("\n"));
const failed = out.filter((l) => l.startsWith("FAIL")).length;
console.log(`\n${out.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
