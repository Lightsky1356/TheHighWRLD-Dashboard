import { json, getSessionUser } from "../../_lib/auth.js";

export async function onRequestGet(context) {
  try {
    const user = await getSessionUser(context.env.wanted_vault, context.request);
    if (!user) return json({ user: null }, 200);
    return json({ user });
  } catch (err) {
    return json({ error: String(err && err.message || err) }, 500);
  }
}
