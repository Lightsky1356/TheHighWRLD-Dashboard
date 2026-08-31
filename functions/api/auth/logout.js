import { json, authJson, destroySession, clearSessionCookie } from "../../_lib/auth.js";

export async function onRequestPost(context) {
  try {
    await destroySession(context.env.wanted_vault, context.request);
    return authJson({ ok: true }, clearSessionCookie());
  } catch (err) {
    return json({ error: String(err && err.message || err) }, 500);
  }
}
