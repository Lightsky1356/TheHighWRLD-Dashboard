// /api/push-test - fire a test notification at the caller's own devices.
//
//   POST /api/push-test -> { ok, sent, failed, pruned }
//
// This exists because verifying Web Push otherwise needs someone with wrangler
// access to run a push by hand and then wait for a device to confirm it. That
// loop is slow, and it hides the only question that matters: not whether the push
// service accepted the payload, but whether the phone's service worker ever
// received it. On iOS a payload can be accepted with HTTP 201 and then dropped
// before the worker is involved, and nothing on the server can tell those apart.
//
// The response reports what the push service said, deliberately, and nothing
// more. Whether the device actually rendered it is reported by the client's
// service-worker trace, which is the only place that can be observed from.
//
// Requires a session, and can only ever target the caller's own subscriptions:
// there is no request field naming a device, so a caller cannot aim a push at
// anyone else's phone.

import { getSessionUser } from "../_lib/auth.js";
import { banRejection } from "../_lib/bans.js";
import { sendPushToUser } from "../_lib/webpush.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data, status = 200) {
  const headers = { "Content-Type": "application/json", ...CORS };
  return new Response(JSON.stringify(data), { status, headers });
}

/* Best-effort per-isolate cooldown. This is not a real rate limit: isolates are
   short-lived and there is one per datacentre, so a determined caller can simply
   land on another. It exists to stop an accidental double-tap, not to stop
   abuse. Anyone who gets past it is a signed-in user sending pushes to their own
   devices, which is the only thing this endpoint can do anyway. */
const LAST_SENT = new Map();
const COOLDOWN_MS = 10_000;

/* Opens this app's own lobby. A test notification that dumps the user onto a
   half-loaded view is worse than one that does nothing when tapped. */
const TEST_URL = "/?push_test=1";

export async function onRequest(context) {
  const { request } = context;

  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (request.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const db = context.env.wanted_vault;
  if (!db) return json({ ok: false, error: "database_unavailable" }, 503);

  let me;
  try {
    me = await getSessionUser(db, request);
  } catch (_) {
    return json({ ok: false, error: "session_lookup_failed" }, 401);
  }
  // Same reasoning as the subscription routes: with no account there is nothing
  // to send to, and reporting success would be a lie the client acts on.
  if (!me || !me.uid) return json({ ok: false, error: "sign_in_required" }, 401);

  const rejected = await banRejection(db, me.uid);
  if (rejected) return rejected.response;

  const now = Date.now();
  const last = LAST_SENT.get(me.uid) || 0;
  if (now - last < COOLDOWN_MS) {
    return json({
      ok: true,
      sent: 0,
      skipped: true,
      retryAfterMs: COOLDOWN_MS - (now - last),
    });
  }
  LAST_SENT.set(me.uid, now);

  const result = await sendPushToUser(context.env, db, me.uid, {
    title: "TheHighWRLD",
    body: "Test notification. If you can read this, push is working.",
    tag: "thw-test",
    type: "test",
    url: TEST_URL,
  });

  /* sent counts HTTP 2xx from the push service. It does NOT mean the device
     showed anything - that is exactly the gap this endpoint makes visible rather
     than hides, so the field name says what it measured. */
  return json({
    ok: true,
    sent: result.sent,
    failed: result.failed,
    pruned: result.pruned,
    /* What the push service actually said. "sent" counts the service accepting
     * the payload, which is not the same as a device showing it, and when a
     * device does not show anything this is the only thing that narrows it
     * down. */
    serviceStatus: result.lastStatus || 0,
    serviceReply: result.lastReply || "",
  });
}