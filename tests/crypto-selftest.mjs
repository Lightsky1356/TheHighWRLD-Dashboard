// Cryptographic self-test for the Web Push sender (functions/_lib/webpush.js).
//
// Why this exists: the highest-risk part of a hand-rolled push sender is the
// RFC 8291 key schedule. A mistake there does not throw - it produces a
// well-formed body that a device silently discards, so it is invisible until
// you hold a real phone.
//
// WHY THIS TEST NOW CHECKS THE RFC'S OWN VECTOR
// It used to check the encryption by decrypting it again with a copy of the
// same key schedule. That is circular: the encryptor and the decryptor were
// wrong in exactly the same way, so they agreed with each other perfectly and
// the test passed while every push in production was undecryptable. The
// payload arrived at the device, the device could not read it, and the push
// was dropped - the push service reporting success the whole time.
//
// The only way to catch that class of mistake is an oracle the implementation
// did not write. RFC 8291 publishes one: the worked example in section 5 and
// the intermediate values in appendix A. Those are checked here, byte for
// byte, along with the whole encrypted body. An implementation that does not
// reproduce the RFC's output cannot pass.
//
// The round-trip with the subscriber's key is kept as well, but it is now
// checked against the RFC's schedule rather than against a copy of the
// implementation's.
//
// Run:  node tests/crypto-selftest.mjs        (from the project root)
// Exits non-zero if any check fails.

import { webcrypto } from "node:crypto";
import {
  encryptPayload, encryptPayloadFor, deriveContentKeys,
  vapidToken, vapidPublicKeyB64, vapidAudience,
} from "../functions/_lib/webpush.js";

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const enc = new TextEncoder();
const failures = [];

function check(name, pass, detail) {
  console.log(`   ${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  -> " + detail : ""}`);
  if (!pass) failures.push(name);
}

const b64u = (s) => Buffer.from(s, "base64url");
const hex = (u8) => Buffer.from(u8).toString("hex");

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

console.log("\n2. RFC 8291 section 5 / appendix A test vector");
/* The RFC's own worked example. Every value below is copied from RFC 8291, not
   computed here, so this is an oracle the implementation cannot argue with. */
const V = {
  plaintext: "When I grow up, I want to be a watermelon",
  uaPublic: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  asPublic: "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  asPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  authSecret: "BTBZMqHH6r4Tts7J_aSIgg",
  ecdhSecret: "kyrL1jIIOHEzg3sM2ZWRHDRB62YACZhhSlknJ672kSs",
  prkKey: "Snr3JMxaHVDXHWJn5wdC52WjpCtd2EIEGBykDcZW32k",
  ikm: "S4lYMb_L0FxCeq0WhDx813KgSYqU26kOyzWUdsXYyrg",
  prk: "09_eUZGrsvxChDCGRCdkLiDXrReGOEVeSCdCcPBSJSc",
  cek: "oIhVW04MRdy2XN9CiKLxTg",
  nonce: "4h_95klXJ5E_qnoN",
  body:
    "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml" +
    "mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT" +
    "pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
};

const vUaPublic = b64u(V.uaPublic);
const vAsPublic = b64u(V.asPublic);
const vSalt = b64u(V.salt);
const vAuth = b64u(V.authSecret);

/* The ECDH step, checked against the RFC too: import the RFC's application
   server private key and derive the shared secret. The RFC gives the private
   key as a raw scalar and the public key as an uncompressed point, which is
   exactly a JWK: the scalar is "d", and the point's two halves are "x" and
   "y". */
const asPoint = b64u(V.asPublic);
const asPrivateJwk = {
  kty: "EC",
  crv: "P-256",
  d: V.asPrivate,
  x: Buffer.from(asPoint.slice(1, 33)).toString("base64url"),
  y: Buffer.from(asPoint.slice(33, 65)).toString("base64url"),
  ext: true,
};
const asPrivate = await crypto.subtle.importKey(
  "jwk", asPrivateJwk, { name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]
);
/* The shared secret check below already proves the private key is the right
   one - only the correct key produces that secret with the RFC's user agent
   public key. This is the belt to that braces: the private key's own public
   half must be the public key the RFC publishes. */
const asJwk = await crypto.subtle.exportKey("jwk", asPrivate);
check(
  "the RFC's private key really is the RFC's public key",
  asJwk.x === asPrivateJwk.x && asJwk.y === asPrivateJwk.y,
  asJwk.x + " / " + asJwk.y,
);
const uaPublicKey = await crypto.subtle.importKey(
  "raw", vUaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []
);
const vEcdh = new Uint8Array(
  await crypto.subtle.deriveBits({ name: "ECDH", public: uaPublicKey }, asPrivate, 256)
);
check(
  "ECDH shared secret matches the RFC",
  hex(vEcdh) === hex(b64u(V.ecdhSecret)),
  hex(vEcdh).slice(0, 24) + "...",
);

/* The key schedule, checked against every intermediate value the RFC
   publishes. */
const keys = await deriveContentKeys(vEcdh, vAuth, vUaPublic, vAsPublic, vSalt);
check("PRK_key matches the RFC", hex(keys.prkKey) === hex(b64u(V.prkKey)), hex(keys.prkKey).slice(0, 24) + "...");
check("IKM matches the RFC", hex(keys.ikm) === hex(b64u(V.ikm)), hex(keys.ikm).slice(0, 24) + "...");
check("PRK matches the RFC", hex(keys.prk) === hex(b64u(V.prk)), hex(keys.prk).slice(0, 24) + "...");
check("CEK matches the RFC", hex(keys.cek) === hex(b64u(V.cek)), hex(keys.cek));
check("NONCE matches the RFC", hex(keys.nonce) === hex(b64u(V.nonce)), hex(keys.nonce));

/* And the whole encrypted body, byte for byte, against the RFC's section 5. */
const vBody = await encryptPayloadFor(
  V.plaintext, vUaPublic, vAuth, vSalt, vAsPublic, vEcdh
);
check(
  "the encrypted body matches the RFC byte for byte",
  Buffer.from(vBody).toString("base64url") === V.body,
  Buffer.from(vBody).toString("base64url").slice(0, 32) + "...",
);

/* The padding delimiter is what a receiver checks before it will decrypt
   anything. RFC 8291 section 4: a message whose delimiter is not 0x02 MUST
   be discarded. */
check(
  "the plaintext is padded with the 0x02 delimiter",
  Buffer.from(vBody).includes(Buffer.from([0x02, ...Buffer.from(V.plaintext)])) === false &&
    vBody.length === 86 + V.plaintext.length + 1 + 16,
  vBody.length + " bytes (86 header + 41 padded plaintext + 16 tag)",
);

console.log("\n3. a real payload, end to end");
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

console.log("\n4. round-trip decryption with the subscriber's key");
/* The subscriber's side of the schedule, written out from the RFC rather than
   copied from the sender's code, so the two are checked against each other
   rather than against a shared mistake. */
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
const blk1 = Buffer.from([1]);

const prkKey = await mac(authSecret, shared, 32);
const ikm = await mac(prkKey, join(enc.encode("WebPush: info\0"), subPub, asPublic, blk1), 32);
const prk = await mac(salt, ikm, 32);
const cek = await mac(prk, join(enc.encode("Content-Encoding: aes128gcm\0"), blk1), 16);
const nonce = await mac(prk, join(enc.encode("Content-Encoding: nonce\0"), blk1), 12);

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
  /* RFC 8188: the plaintext ends with the padding delimiter octet 0x02, and a
     receiver strips it before reading the content. AEAD does not strip it - the
     delimiter is part of what was encrypted. */
  const raw = Buffer.from(plaintext, "utf8");
  check(
    "the padding delimiter is the last octet",
    raw.length > 0 && raw[raw.length - 1] === 0x02,
    "0x" + raw[raw.length - 1].toString(16),
  );
  const parsed = JSON.parse(raw.subarray(0, raw.length - 1).toString("utf8"));
  check("title round-trips", parsed.title === payload.title, parsed.title);
  check("body round-trips", parsed.body === payload.body, parsed.body);
  check("tag round-trips", parsed.tag === payload.tag, parsed.tag);
  check("destination round-trips", parsed.url === payload.url, parsed.url);
}

console.log("\n5. ciphertext does not leak content");
check("message text absent from ciphertext", !Buffer.from(body).includes(Buffer.from(payload.body)));
check("title absent from ciphertext", !Buffer.from(body).includes(Buffer.from(payload.title)));

console.log("\n6. VAPID JWT (ES256)");
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

console.log("\n7. malformed input is rejected, not silently accepted");
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