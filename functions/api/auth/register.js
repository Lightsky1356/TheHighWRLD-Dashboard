import { json, authJson, nowIso, newUid, hashPassword, createSession, verifyHcaptcha, emailOk, setSessionCookie } from "../../_lib/auth.js";

export async function onRequestPost(context) {
  const body = await context.request.json().catch(() => null);
  if (!body) return json({ error: "invalid body" }, 400);
  const db = context.env.wanted_vault;

  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  const confirm = String(body.confirm || "");
  if (!emailOk(email)) return json({ error: "Please enter a valid email address." }, 400);
  if (password.length < 8) return json({ error: "Password must be at least 8 characters." }, 400);
  if (password.length > 128) return json({ error: "Password is too long." }, 400);
  if (password !== confirm) return json({ error: "Passwords do not match." }, 400);

  const ok = await verifyHcaptcha(context.env, body.hcaptcha);
  if (!ok) return json({ error: "Captcha verification failed. Please try again." }, 400);

  const existing = await db.prepare("SELECT uid FROM users WHERE email_lower = ?").bind(email).first();
  if (existing) return json({ error: "An account with that email already exists. Try signing in instead." }, 409);

  const uid = newUid();
  const name = String(email.split("@")[0] || "").replace(/[^A-Za-z0-9 _.-]/g, "").slice(0, 24) || "999 Member";
  const password_hash = await hashPassword(password);
  await db.prepare(
    "INSERT INTO users (uid, email, email_lower, name, avatar, password_hash, provider, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).bind(uid, email, email, name, "", password_hash, "email", nowIso(), nowIso()).run();

  await db.prepare(
    "INSERT INTO user_profiles (site_uid, name, created_at) VALUES (?, ?, ?) ON CONFLICT(site_uid) DO NOTHING"
  ).bind(uid, name, nowIso()).run();

  const token = await createSession(db, uid, context.request);
  return authJson({ ok: true, uid, name, email }, setSessionCookie(token));
}
