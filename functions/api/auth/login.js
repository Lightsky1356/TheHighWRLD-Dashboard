import { json, authJson, nowIso, createSession, verifyHcaptcha, verifyPassword, setSessionCookie } from "../../_lib/auth.js";

export async function onRequestPost(context) {
  const body = await context.request.json().catch(() => null);
  if (!body) return json({ error: "invalid body" }, 400);
  const db = context.env.wanted_vault;

  const ident = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  if (!ident) return json({ error: "Enter your email." }, 400);
  if (!password) return json({ error: "Enter your password." }, 400);

  const ok = await verifyHcaptcha(context.env, body.hcaptcha);
  if (!ok) return json({ error: "Captcha verification failed. Please try again." }, 400);

  const user = await db.prepare("SELECT uid, email, name, avatar, password_hash, provider FROM users WHERE email_lower = ?").bind(ident).first();
  if (!user || !user.password_hash) return json({ error: "No account found with that email and password." }, 401);
  const match = await verifyPassword(password, user.password_hash);
  if (!match) return json({ error: "No account found with that email and password." }, 401);

  await db.prepare("UPDATE users SET updated_at = ? WHERE uid = ?").bind(nowIso(), user.uid).run();
  const token = await createSession(db, user.uid, context.request);
  return authJson({ ok: true, uid: user.uid, name: user.name, email: user.email }, setSessionCookie(token));
}
