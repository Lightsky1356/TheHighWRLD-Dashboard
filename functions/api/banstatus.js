// GET /api/banstatus — the authenticated user's own active-ban info.
// The uid ALWAYS comes from the session cookie; any uid parameter is ignored.
// Returns public-safe fields only (never moderator notes). 401 when signed out.

import { getSessionUser } from "../_lib/auth.js";
import { banStatus } from "../_lib/bans.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestGet(context) {
  try {
    const db = context.env.wanted_vault;
    const me = await getSessionUser(db, context.request);
    if (!me) return json({ ok: false, error: "not signed in" }, 401);
    const st = await banStatus(db, me.uid);
    if (!st.banned) return json({ ok: true, banned: false });
    return json({
      ok: true,
      banned: true,
      ban: {
        id: st.id,
        reason: st.reason || "No reason given.",
        created_at: st.created_at || "",
        expires_at: st.expires_at || "",
      },
    });
  } catch (err) {
    return json({ ok: false, error: String((err && err.message) || err) }, 500);
  }
}
