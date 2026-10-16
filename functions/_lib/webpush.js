// Web Push sender for Cloudflare Workers.
//
// Implements the two pieces needed to talk to a push service (FCM / Mozilla /
// Windows WNS) without adding an npm dependency:
//
//   1. VAPID (RFC 8292) - signs each request with an ES256 JWT proving the
//      sender owns the application server key pair.
//   2. aes128gcm (RFC 8291 + RFC 8188) - encrypts the payload with a one-time
//      ECDH key so the push service only ever sees ciphertext.
//
// Built on Web Crypto, which Workers provides natively. The repo deliberately
// has zero npm dependencies and no root package.json, so pulling in `web-push`
// would change the build; this keeps the deployment shape untouched.
//
// WHY THIS EXISTS AT ALL: message bodies must never travel in a push payload.
// Push endpoints are push-service infrastructure and a notification is visible
// on a lock screen, so every call site is expected to pass a generic summary.

const enc = new TextEncoder();

/* ---------- base64url / utf8 ---------- */

function b64url(bytes) {
  let bin = "";
  const b = new Uint8Array(bytes);
  for (let i = 0; i < b.length; i++) bin += String.fromCharCode(b[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(str) {
  const pad = str.length % 4 === 0 ? "" : "=".repeat(4 - (str.length % 4));
  const bin = atob(String(str).replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/* ---------- VAPID key handling ----------
 *
 * The secret is a PKCS#8 PEM, e.g.
 *   openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256
 *
 * PKCS#8 is used deliberately. Web Crypto cannot import a bare EC private
 * scalar with importKey("raw", ...) - EC private keys must arrive as JWK or
 * PKCS#8, and both of those also carry the public coordinates. Storing only the
 * scalar would make the matching public key impossible to derive, so one secret
 * would not be enough. Importing the PKCS#8 yields a key that can still be
 * exported back as a JWK, so the public point is derived from it and never has
 * to be stored separately.
 */
function vapidPrivateKey(secret) {
  const raw = String(secret || "").trim();
  if (!raw) throw new Error("vapid_private_key_missing");

  if (raw.includes("BEGIN")) {
    const body = raw.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
    let der;
    try {
      der = fromB64url(body.replace(/\+/g, "-").replace(/\//g, "_"));
    } catch (_) {
      throw new Error("vapid_private_key_unreadable");
    }
    return crypto.subtle.importKey(
      "pkcs8",
      der,
      { name: "ECDSA", namedCurve: "P-256" },
      /* extractable: true is required, not incidental. vapidPublicKeyB64() has
         to export this key back as a JWK to read its x/y and build the public
         point, and a non-extractable CryptoKey throws InvalidAccessException
         on export. The key only ever lives in this invocation's memory. */
      true,
      ["sign"]
    );
  }

  // A JWK is accepted too, for operators who prefer to paste JSON. It must carry
  // d, x and y - the public halves cannot be derived from d alone.
  if (raw.charAt(0) === "{") {
    let jwk;
    try { jwk = JSON.parse(raw); } catch (_) { throw new Error("vapid_private_key_unreadable"); }
    if (!jwk.d || !jwk.x || !jwk.y) throw new Error("vapid_private_key_incomplete_jwk");
    return crypto.subtle.importKey(
      "jwk",
      { kty: "EC", crv: "P-256", d: jwk.d, x: jwk.x, y: jwk.y, ext: true },
      { name: "ECDSA", namedCurve: "P-256" },
      true, // see the pkcs8 branch: must be exportable to derive the public key
      ["sign"]
    );
  }

  throw new Error("vapid_private_key_format_unrecognised");
}

/* ---------- VAPID JWT ---------- */

// ES256 JWT. Web Crypto returns ECDSA signatures as the raw r||s pair
// (IEEE P1363), which is exactly the encoding JWS requires for ES256 - so no
// DER-to-raw conversion is needed.
async function vapidToken(privateKey, audience, subject, ttlSeconds) {
  const header = b64url(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const exp = Math.floor(Date.now() / 1000) + (ttlSeconds || 12 * 60 * 60);
  const payload = b64url(enc.encode(JSON.stringify({ aud: audience, exp, sub: subject })));
  const signingInput = header + "." + payload;
  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    privateKey,
    enc.encode(signingInput)
  );
  return signingInput + "." + b64url(sig);
}

// Derives the uncompressed public point (0x04 || X || Y). This is what the
// browser needs for applicationServerKey and what the Authorization header must
// carry as "k=".
async function vapidPublicKeyB64(secret) {
  const pk = await vapidPrivateKey(secret);
  const jwk = await crypto.subtle.exportKey("jwk", pk);
  const x = fromB64url(jwk.x);
  const y = fromB64url(jwk.y);
  const point = new Uint8Array(65);
  point[0] = 0x04;
  point.set(x, 1);
  point.set(y, 33);
  return b64url(point);
}

/* ---------- aes128gcm payload encryption (RFC 8291) ---------- */

/* Single HMAC-SHA256 primitive, so the key/data order can never be ambiguous
   again. An earlier version modelled HKDF-Extract and HKDF-Expand separately
   and named the parameters (salt, ikm) in a way that invited them to be passed
   the wrong way round - the result was a well-formed but undecryptable payload.
   Every step below now reads as HMAC(key, data), which is what the RFC says. */
async function hmacDerive(keyBytes, data, length) {
  const key = await crypto.subtle.importKey(
    "raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, data));
  return length ? mac.slice(0, length) : mac;
}

async function encryptPayload(plaintext, p256dhB64, authB64) {
  const uaPublic = fromB64url(p256dhB64);
  const authSecret = fromB64url(authB64);
  if (uaPublic.length !== 65 || uaPublic[0] !== 0x04) throw new Error("bad p256dh");

  const salt = crypto.getRandomValues(new Uint8Array(16));

  // Ephemeral ECDH key pair; only the public half is transmitted.
  const asKeys = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", asKeys.publicKey));

  const uaPublicKey = await crypto.subtle.importKey(
    "raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []
  );
  const sharedSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: uaPublicKey }, asKeys.privateKey, 256)
  );

  // PRK = HMAC(auth_secret, shared_secret || as_public)
  const prkInput = new Uint8Array(sharedSecret.length + asPublic.length);
  prkInput.set(sharedSecret, 0);
  prkInput.set(asPublic, sharedSecret.length);
  const prk = await hmacDerive(authSecret, prkInput);

  // PRK_key = HMAC(PRK, "WebPush: info" || 0x00 || ua_public || as_public)
  const infoLabel = enc.encode("WebPush: info\u0000");
  const info = new Uint8Array(infoLabel.length + uaPublic.length + asPublic.length);
  info.set(infoLabel, 0);
  info.set(uaPublic, infoLabel.length);
  info.set(asPublic, infoLabel.length + uaPublic.length);
  const prkKey = await hmacDerive(prk, info, 32);

  // CEK and NONCE are both HMAC(PRK_key, ...), salted with the same salt.
  const cek = await hmacDerive(prkKey, concat(enc.encode("Content-Encoding: auth\u0000"), salt), 16);
  const nonce = await hmacDerive(prkKey, concat(enc.encode("Content-Encoding: nonce\u0000"), salt), 12);

  const aesKey = await crypto.subtle.importKey("raw", cek, { name: "AES-GCM" }, false, ["encrypt"]);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, enc.encode(plaintext))
  );

  // Body layout: salt(16) | rs(4) | idlen(1) | keyid(65) | ciphertext
  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096, false);
  const idlen = new Uint8Array([asPublic.length]);

  return concat(salt, rs, idlen, asPublic, ciphertext);
}

function concat(...parts) {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

/* ---------- send ---------- */

// Push services accept an untrusted endpoint from the browser as-is, but we
// still pin the scheme to https:// so a poisoned subscription row cannot be used
// to make the Worker issue requests to arbitrary internal hosts.
function isValidEndpoint(endpoint) {
  try {
    const u = new URL(endpoint);
    return u.protocol === "https:" && /(^|\.)(push\.|fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|wns\.windows\.com|notify\.windows\.com)/i.test(u.hostname);
  } catch (_) {
    return false;
  }
}

/**
 * Send one push message.
 * Returns { ok, status, gone } - `gone` means the subscription is dead and the
 * caller should delete the row. Never throws for a delivery failure; a network
 * or HTTP error is reported so the caller can count it and prune.
 */
export async function sendPush(env, subscription, payload) {
  const endpoint = subscription.endpoint;
  if (!isValidEndpoint(endpoint)) return { ok: false, status: 0, gone: true, error: "bad_endpoint" };

  const privateKeySecret = env.VAPID_PRIVATE_KEY;
  if (!privateKeySecret) return { ok: false, status: 0, gone: false, error: "vapid_not_configured" };

  try {
    const privateKey = await vapidPrivateKey(privateKeySecret);
    const publicB64 = await vapidPublicKeyB64(privateKeySecret);
    const subject = env.VAPID_SUBJECT || "mailto:admin@thehighwrlddashboard.pages.dev";

    const audience = new URL(endpoint).origin + "/";
    const token = await vapidToken(privateKey, audience, subject);

    const body = await encryptPayload(JSON.stringify(payload), subscription.p256dh, subscription.auth);

    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        // Apple maps Urgency onto apns-priority. "normal" becomes 5, which APNs
        // treats as deferrable under power considerations - the payload is queued
        // for later rather than delivered promptly. Paired with a one-day TTL that
        // is indistinguishable from "accepted and silently dropped": every send
        // returns 2xx, nothing appears, and for a day there is no way to tell
        // "queued" from "lost". That is the exact shape of this bug.
        //
        // A friend request or a message wants to arrive now, not eventually, so
        // this asks for immediate delivery and keeps the payload an hour rather
        // than a day.
        TTL: "3600",
        Urgency: "high",
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        "Content-Length": String(body.length),
        Authorization: "vapid t=" + token + ", k=" + publicB64,
      },
      body,
    });

    if (res.ok) return { ok: true, status: res.status, gone: false };

    // 404/410 mean the subscription is permanently invalid and must be removed.
    const gone = res.status === 404 || res.status === 410;
    return { ok: false, status: res.status, gone, error: "push_http_" + res.status };
  } catch (err) {
    /* VAPID configuration problems must be diagnosable by the operator, and
       their identifiers are fixed strings written by this file - they can never
       contain key or endpoint material. Everything else is collapsed to a
       single opaque code so nothing sensitive can reach logs or a response. */
    const reason = String((err && err.message) || "");
    const safe = /^vapid_private_key_/.test(reason) ? reason : "push_exception";
    return { ok: false, status: 0, gone: false, error: safe };
  }
}

/** Fan out to every live subscription for a user, pruning dead ones. */
export async function sendPushToUser(env, db, uid, payload) {
  let rows;
  try {
    rows = await db
      .prepare("SELECT id, endpoint, p256dh, auth, failure_count FROM push_subscriptions WHERE uid = ?")
      .bind(uid)
      .all();
  } catch (_) {
    return { sent: 0, failed: 0, pruned: 0 };
  }
  const subs = (rows && rows.results) || [];
  if (!subs.length) return { sent: 0, failed: 0, pruned: 0 };

  let sent = 0, failed = 0, pruned = 0;

  // Bounded concurrency: a user with many devices must not open an unbounded
  // number of simultaneous outbound requests from a single Worker invocation.
  const CONCURRENCY = 4;
  let cursor = 0;
  async function worker() {
    while (cursor < subs.length) {
      const sub = subs[cursor++];
      const r = await sendPush(env, sub, payload);
      if (r.gone) {
        pruned++;
        await db.prepare("DELETE FROM push_subscriptions WHERE id = ?").bind(sub.id).run();
      } else if (r.ok) {
        sent++;
        await db
          .prepare("UPDATE push_subscriptions SET failure_count = 0, last_success_at = ? WHERE id = ?")
          .bind(new Date().toISOString(), sub.id)
          .run();
      } else {
        failed++;
        const next = Number(sub.failure_count || 0) + 1;
        await db
          .prepare("UPDATE push_subscriptions SET failure_count = ?, last_failure_at = ? WHERE id = ?")
          .bind(next, new Date().toISOString(), sub.id)
          .run();
        // Give up after repeated failures so a revoked permission is not retried
        // forever on every message.
        if (next >= 5) {
          await db.prepare("DELETE FROM push_subscriptions WHERE id = ?").bind(sub.id).run();
          pruned++;
        }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, subs.length) }, worker));

  return { sent, failed, pruned };
}

/** Public VAPID key for the browser. Safe to expose - it is a public key. */
export async function vapidPublicKey(env) {
  if (!env.VAPID_PRIVATE_KEY) return "";
  try {
    return await vapidPublicKeyB64(env.VAPID_PRIVATE_KEY);
  } catch (_) {
    return "";
  }
}

/* Exported for crypto-selftest.mjs.
 *
 * These are pure functions that take every input as an argument and hold no
 * state, so exporting them grants no access to any secret. It is worth doing
 * rather than duplicating the algorithm in a test harness: a copy would pass
 * while the real code stayed broken, which is exactly what happened twice while
 * this was being written (a non-importable bare EC private key, and an HKDF
 * extract with its key and data reversed). Both were caught only because the
 * test drove the real functions. */
export { encryptPayload, vapidToken, vapidPublicKeyB64, vapidPrivateKey };