// Cryptographic self-test for the Web Push sender (functions/_lib/webpush.js).
//
// Why this exists: the highest-risk part of a hand-rolled push sender is the
// RFC 8291 key schedule. A mistake there does not throw - it produces a
// well-formed body that a push service rejects with an opaque 400, so it is
// invisible until you hold a real phone. This decrypts the payload back with the
// SUBSCRIBER's private key and checks the plaintext, which validates the whole
// schedule locally with no device and no push service.
//
// It also checks the VAPID JWT is a well-formed ES256 JWS, and that the
// ciphertext does not contain the message text.
//
// Run:  node tests/crypto-selftest.mjs        (from the project root)
// Exits non-zero if any check fails.

import { webcrypto } from "node:crypto";
import { encryptPayload, vapidToken, vapidPublicKeyB64, vapidAudience } from "../functions/_lib/webpush.js";

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const enc = new TextEncoder();
const failures = [];

function check(name, pass, detail) {
  console.log(`   ${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  -> " + detail : ""}`);
  if (!pass) failures.push(name);
}

// ---------- VAPID key, in the exact format an operator stores ----------
// Byte-identical to `openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256`
// output; generated with Web Crypto so the test needs no external tooling.
const vapid = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", vapid.privateKey));
const pem =
  "-----BEGIN PRIVATE KEY-----\n" +
  Buffer.from(pkcs8).toString("base64").replace(/(.{64})/g, "$1\n").replace(/\n$/, "") +
  "\n-----END PRIVATE KEY-----\n";

console.log("1. VAPID public key derivation");
const publicKeyB64 = await vapidPublicKeyB64(pem);
check("public key is 65 bytes (87 base64url chars)", publicKeyB64.length === 87, publicKeyB64.length + " chars");
check("uncompressed point starts with 0x04", Buffer.from(publicKeyB64, "base64url")[0] === 0x04);

console.log("\n2. aes128gcm body layout (RFC 8291 + RFC 8188)");
const sub = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
const subPub = new Uint8Array(await crypto.subtle.exportKey("raw", sub.publicKey));
const authSecret = crypto.getRandomValues(new Uint8Array(16));
const b64 = (u8) => Buffer.from(u8).toString("base64url");

const payload = {
  title: "TheHighWRLD",
  body: "Someone sent you a message",
  tag: "thw-dm_message-42",
  url: "social:conversation",
};
// encryptPayload takes an already-serialised string, exactly as sendPush calls
// it. Passing the object directly would encrypt String(obj) = "[object Object]".
const body = await encryptPayload(JSON.stringify(payload), b64(subPub), b64(authSecret));

check("idlen byte is 65", body[20] === 65, "idlen=" + body[20]);
const rs = new DataView(body.buffer, body.byteOffset + 16, 4).getUint32(0, false);
check("record size is 4096", rs === 4096, String(rs));
check("body long enough to hold ciphertext", body.length > 102, body.length + " bytes");

console.log("\n3. round-trip decryption with the subscriber's key");
const salt = body.slice(0, 16);
const idlen = body[20];
const asPublic = body.slice(21, 21 + idlen);
const ciphertext = body.slice(21 + idlen);

const peerKey = await crypto.subtle.importKey("raw", asPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: peerKey }, sub.privateKey, 256));

const mac = async (keyBytes, data, len) => {
  const k = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array((await crypto.subtle.sign("HMAC", k, data)).slice(0, len));
};
const join = (...a) => Buffer.concat(a.map(Buffer.from));

const prkInput = join(shared, asPublic);
const prk = await mac(authSecret, prkInput, 32);
const prkKey = await mac(prk, join(enc.encode("WebPush: info\0"), subPub, asPublic), 32);
const cek = await mac(prkKey, join(enc.encode("Content-Encoding: auth\0"), salt), 16);
const nonce = await mac(prkKey, join(enc.encode("Content-Encoding: nonce\0"), salt), 12);

const aesKey = await crypto.subtle.importKey("raw", cek, { name: "AES-GCM" }, false, ["decrypt"]);
let plaintext = "";
let decryptOk = true;
try {
  plaintext = new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, aesKey, ciphertext));
} catch (e) {
  decryptOk = false;
}
check("payload decrypts with subscriber key", decryptOk);
check("decrypted value is a string", typeof plaintext === "string", typeof plaintext);
if (decryptOk && typeof plaintext === "string") {
  const parsed = JSON.parse(plaintext);
  check("title round-trips", parsed.title === payload.title, parsed.title);
  check("body round-trips", parsed.body === payload.body, parsed.body);
  check("tag round-trips", parsed.tag === payload.tag, parsed.tag);
  check("destination round-trips", parsed.url === payload.url, parsed.url);
}

console.log("\n4. ciphertext does not leak content");
check("message text absent from ciphertext", !Buffer.from(body).includes(Buffer.from(payload.body)));
check("title absent from ciphertext", !Buffer.from(body).includes(Buffer.from(payload.title)));

console.log("\n5. VAPID JWT (ES256)");
/* The audience comes from the endpoint, not from a literal typed in here.
   The old test passed "https://fcm.googleapis.com/" by hand and only checked
   that the token echoed it, so it agreed with the code rather than with the
   spec - and the code was building the audience with a trailing slash, which
   is not a valid audience for a push service. */
check(
  "the audience is the service origin with no trailing slash",
  vapidAudience("https://fcm.googleapis.com/fcm/send/abc123") === "https://fcm.googleapis.com",
  vapidAudience("https://fcm.googleapis.com/fcm/send/abc123"),
);
check(
  "an apple endpoint gives the apple origin with no trailing slash",
  vapidAudience("https://web.push.apple.com/QNosuNFqC2ph7gU0cAILsQK5d") === "https://web.push.apple.com",
  vapidAudience("https://web.push.apple.com/QNosuNFqC2ph7gU0cAILsQK5d"),
);
const token = await vapidToken(vapid.privateKey, vapidAudience("https://fcm.googleapis.com/fcm/send/abc123"), "mailto:admin@example.com");
const [h, p, s] = token.split(".");
const header = JSON.parse(Buffer.from(h, "base64url").toString());
const claims = JSON.parse(Buffer.from(p, "base64url").toString());
check("three JWT segments", token.split(".").length === 3);
check("alg is ES256", header.alg === "ES256", JSON.stringify(header));
check("aud is the push service origin", claims.aud === "https://fcm.googleapis.com", claims.aud);
check("sub is a mailto", /^mailto:/.test(claims.sub), claims.sub);
check("exp is in the future", claims.exp * 1000 > Date.now(), new Date(claims.exp * 1000).toISOString());
check("signature is 64 bytes (raw r||s)", Buffer.from(s, "base64url").length === 64, Buffer.from(s, "base64url").length + " bytes");

console.log("\n6. malformed input is rejected, not silently accepted");
const badInputs = [
  ["p256dh wrong length", "AA", b64(authSecret)],
  ["p256dh not a curve point", Buffer.alloc(65).toString("base64url"), b64(authSecret)],
  ["empty p256dh", "", b64(authSecret)],
];
for (const [name, pk, ak] of badInputs) {
  let rejected = false;
  try { await encryptPayload(JSON.stringify({ a: 1 }), pk, ak); } catch (_) { rejected = true; }
  check("rejects " + name, rejected);
}

console.log("\n" + (failures.length ? `${failures.length} CHECK(S) FAILED: ${failures.join(", ")}` : "ALL CHECKS PASSED"));
process.exit(failures.length ? 1 : 0);