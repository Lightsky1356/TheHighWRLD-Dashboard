// Shared auth helpers for the login/register system (functions/_lib is not routable).
const SESSION_COOKIE = "thw_session";
const SESSION_DAYS = 30;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function authJson(data, cookie, status = 200) {
  const headers = { "Content-Type": "application/json" };
  if (cookie) headers["Set-Cookie"] = cookie;
  return new Response(JSON.stringify(data), { status, headers });
}

function nowIso() {
  return new Date().toISOString();
}

function hex(bytes) {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

function hexToBytes(h) {
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function randomHex(n) {
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  return hex(bytes);
}

function newUid() {
  return "u" + Date.now().toString(36) + randomHex(6).slice(0, 8);
}

/* ---------- Password hashing (PBKDF2-SHA256) ---------- */
const PBKDF2_ITER = 100000;
const PBKDF2_LEN = 32;

async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(String(password)), { name: "PBKDF2" }, false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt.buffer, iterations: PBKDF2_ITER },
    key,
    PBKDF2_LEN * 8
  );
  return "pbkdf2$" + PBKDF2_ITER + "$" + hex(salt) + "$" + hex(new Uint8Array(bits));
}

async function verifyPassword(password, stored) {
  try {
    const parts = String(stored || "").split("$");
    if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
    const iter = Number(parts[1]);
    const salt = hexToBytes(parts[2]);
    const expected = parts[3];
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(String(password)), { name: "PBKDF2" }, false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", hash: "SHA-256", salt: salt.buffer, iterations: iter },
      key,
      PBKDF2_LEN * 8
    );
    return hex(new Uint8Array(bits)) === expected;
  } catch (e) {
    return false;
  }
}

/* ---------- Sessions ---------- */
function getCookie(request, name) {
  const cookie = String(request.headers.get("Cookie") || "");
  const m = new RegExp("(?:^|;\\s*)" + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "=([^;]*)").exec(cookie);
  return m ? decodeURIComponent(m[1]) : "";
}

function setSessionCookie(token) {
  const parts = [
    SESSION_COOKIE + "=" + encodeURIComponent(token),
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
  ];
  parts.push("Secure");
  parts.push("Max-Age=" + SESSION_DAYS * 86400);
  return parts.join("; ");
}

function clearSessionCookie() {
  return SESSION_COOKIE + "=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0";
}

async function createSession(db, uid, request) {
  const token = randomHex(32);
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  const ip = (request.headers.get("CF-Connecting-IP") || "").slice(0, 45);
  const ua = String(request.headers.get("User-Agent") || "").slice(0, 300);
  await db.prepare("DELETE FROM sessions WHERE uid = ?").bind(uid).run();
  await db.prepare("INSERT INTO sessions (token, uid, ip, ua, expires_at) VALUES (?, ?, ?, ?, ?)").bind(token, uid, ip, ua, expires).run();
  await db.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(nowIso()).run();
  return token;
}

async function getSessionUser(db, request) {
  const token = getCookie(request, SESSION_COOKIE);
  if (!token) return null;
  const row = await db.prepare(
    "SELECT s.uid, s.expires_at, u.email, u.name, u.avatar, u.provider FROM sessions s JOIN users u ON u.uid = s.uid WHERE s.token = ?"
  ).bind(token).first();
  if (!row) return null;
  if (row.expires_at && row.expires_at < nowIso()) {
    await db.prepare("DELETE FROM sessions WHERE token = ?").bind(token).run();
    return null;
  }
  return { uid: row.uid, email: row.email || "", name: row.name || "", avatar: row.avatar || "", provider: row.provider || "" };
}

async function destroySession(db, request) {
  const token = getCookie(request, SESSION_COOKIE);
  if (token) await db.prepare("DELETE FROM sessions WHERE token = ?").bind(token).run();
}

/* ---------- hCaptcha ---------- */
async function verifyHcaptcha(env, token) {
  const secret = env.HCAPTCHA_SECRET || "";
  if (!secret) return true; // not configured -> accept (dev mode)
  if (!token) return false;
  try {
    const form = new URLSearchParams();
    form.set("secret", secret);
    form.set("response", token);
    const resp = await fetch("https://hcaptcha.com/siteverify", { method: "POST", body: form });
    const data = await resp.json();
    return !!(data && data.success);
  } catch (e) {
    return false;
  }
}

function emailOk(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(email || "")) && String(email).length <= 160;
}

function uidOk(uid) {
  return /^[A-Za-z0-9_-]{4,64}$/.test(String(uid || ""));
}

export { json, authJson, nowIso, randomHex, newUid, hashPassword, verifyPassword, getCookie, setSessionCookie, clearSessionCookie, createSession, getSessionUser, destroySession, verifyHcaptcha, emailOk, uidOk, SESSION_COOKIE };
