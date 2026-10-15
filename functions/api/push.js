// /api/push - Web Push subscription management.
//
//   GET    /api/push            -> { ok, publicKey, supported, devices: [...] }
//   POST   /api/push            -> subscribe   { endpoint, keys:{p256dh,auth} }
//   DELETE /api/push            -> unsubscribe { endpoint }
//   POST   /api/push?action=purge -> drop every device for the signed-in user
//
// Every route requires a valid session (functions/_lib/auth.js). Subscriptions
// are per-account AND per-device: a row is keyed by endpoint, so one account can
// hold several devices and removing one leaves the others alone.
//
// The endpoint and key material come from the browser and are therefore
// untrusted input. They are validated for shape here; the sender additionally
// pins the push-service host allowlist before it will issue a request.

import { getSessionUser, json as rawJson } from "../_lib/auth.js";
import { banRejection } from "../_lib/bans.js";
import { vapidPublicKey } from "../_lib/webpush.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data, status = 200) {
  const headers = { "Content-Type": "application/json", ...CORS };
  return new Response(JSON.stringify(data), { status, headers });
}

/* A browser endpoint is a long opaque URL; cap it so a hostile client cannot use
   this table as free storage. 2048 is comfortably above every real push
   endpoint (Mozilla ~120, FCM ~180 characters). */
const MAX_ENDPOINT = 2048;
const MAX_KEY = 128;

/* base64url with the standard alphabet and padding stripped. Push services only
   ever issue this alphabet, so anything else is a malformed request. */
function isB64Url(s, maxLen) {
  if (typeof s !== "string") return false;
  if (!s.length || s.length > maxLen) return false;
  return /^[A-Za-z0-9_-]+={0,2}$/.test(s);
}

function validEndpointShape(s) {
  if (typeof s !== "string" || !s.length || s.length > MAX_ENDPOINT) return false;
  try {
    const u = new URL(s);
    return u.protocol === "https:" && u.hostname.length > 0;
  } catch (_) {
    return false;
  }
}

function readDeviceName(request) {
  // Client sends a short label so the user can tell their devices apart.
  // Sanitised hard: it is rendered back into the panel.
  let raw = request.headers.get("X-THW-Device") || "";
  raw = raw.replace(/[^\w \-.()]/g, "").trim().slice(0, 40);
  return raw;
}

export async function onRequest(context) {
  const { request } = context;
  const method = request.method;

  if (method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  const db = context.env.wanted_vault;
  if (!db) return json({ ok: false, error: "database_unavailable" }, 503);

  let me;
  try {
    me = await getSessionUser(db, request);
  } catch (_) {
    return json({ ok: false, error: "session_lookup_failed" }, 401);
  }
  // 401 rather than a softer code: without a session there is no account to
  // attach a subscription to, and silently succeeding would look like it worked.
  if (!me || !me.uid) return json({ ok: false, error: "sign_in_required" }, 401);

  if (method !== "GET") {
    const rejected = await banRejection(db, me.uid);
    if (rejected) return rejected.response;
  }

  try {
    /* ---------------- GET: state + public key ---------------- */
    if (method === "GET") {
      const rows = await db
        .prepare(
          "SELECT id, endpoint, user_agent, created_at, failure_count FROM push_subscriptions " +
          "WHERE uid = ? ORDER BY created_at DESC LIMIT 25"
        )
        .bind(me.uid)
        .all();

      const devices = ((rows && rows.results) || []).map((r) => ({
        // Only a prefix of the endpoint is returned. The full value is a
        // credential for that device's push channel and has no business being
        // echoed into a page; it is only ever needed server-side.
        id: r.id,
        endpointPreview: String(r.endpoint || "").slice(0, 48) + "…",
        userAgent: r.user_agent || "",
        createdAt: r.created_at,
        failureCount: Number(r.failure_count || 0),
      }));

      return json({
        ok: true,
        publicKey: await vapidPublicKey(context.env),
        deviceCount: devices.length,
        devices,
      });
    }

    /* ---------------- DELETE: remove one device ---------------- */
    if (method === "DELETE") {
      let body = {};
      try { body = await request.json(); } catch (_) {}
      const endpoint = body.endpoint;

      if (endpoint === "all") {
        const res = await db.prepare("DELETE FROM push_subscriptions WHERE uid = ?").bind(me.uid).run();
        return json({ ok: true, removed: Number((res.meta && res.meta.changes) || 0) });
      }
      if (!validEndpointShape(endpoint)) return json({ ok: false, error: "invalid_endpoint" }, 400);

      // Scoped to the caller's uid so one account can never remove another's
      // subscription even if it somehow learns the endpoint.
      const res = await db
        .prepare("DELETE FROM push_subscriptions WHERE uid = ? AND endpoint = ?")
        .bind(me.uid, endpoint)
        .run();
      return json({ ok: true, removed: Number((res.meta && res.meta.changes) || 0) });
    }

    /* ---------------- POST ---------------- */
    if (method === "POST") {
      let body = {};
      try { body = await request.json(); } catch (_) {
        return json({ ok: false, error: "invalid_json" }, 400);
      }

      // Bulk removal via POST, for clients that avoid DELETE with a body.
      if (body.action === "unsubscribeAll" || body.action === "purge") {
        const res = await db.prepare("DELETE FROM push_subscriptions WHERE uid = ?").bind(me.uid).run();
        return json({ ok: true, removed: Number((res.meta && res.meta.changes) || 0) });
      }

      const endpoint = body.endpoint;
      const keys = body.keys || {};

      if (!validEndpointShape(endpoint)) return json({ ok: false, error: "invalid_endpoint" }, 400);
      if (!isB64Url(keys.p256dh, MAX_KEY)) return json({ ok: false, error: "invalid_p256dh" }, 400);
      if (!isB64Url(keys.auth, MAX_KEY)) return json({ ok: false, error: "invalid_auth" }, 400);

      // Prefer the client-supplied label. The User-Agent alone cannot separate an
      // iPad from a Mac - iPadOS reports a desktop Macintosh UA - and only the page
      // can see navigator.platform and maxTouchPoints. Falls back to the raw UA so
      // an older client that sends no header is still recorded faithfully.
      const label = readDeviceName(request);
      const ua = label || String(request.headers.get("User-Agent") || "").slice(0, 180);

      // Upsert on endpoint: re-granting permission or reinstalling must update
      // the existing row rather than pile up duplicates for one device.
      await db
        .prepare(
          "INSERT INTO push_subscriptions (uid, endpoint, p256dh, auth, user_agent) " +
          "VALUES (?, ?, ?, ?, ?) " +
          "ON CONFLICT(endpoint) DO UPDATE SET " +
          "uid = excluded.uid, p256dh = excluded.p256dh, auth = excluded.auth, " +
          "user_agent = excluded.user_agent, failure_count = 0, last_failure_at = NULL"
        )
        .bind(me.uid, endpoint, keys.p256dh, keys.auth, label || ua)
        .run();

      return json({ ok: true, subscribed: true });
    }

    return json({ ok: false, error: "method_not_allowed" }, 405);
  } catch (err) {
    // Never echo the error text: it can contain endpoint/key material.
    return json({ ok: false, error: "push_request_failed" }, 500);
  }
}