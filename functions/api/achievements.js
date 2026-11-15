// GET /api/achievements - the member's achievements with progress.

import { getSessionUser } from "../_lib/auth.js";
import { getAchievementsFor } from "../_lib/achievements.js";

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" } });
}

export async function onRequestGet(context) {
  try {
    const db = context.env.wanted_vault;
    const user = await getSessionUser(db, context.request);
    if (!user) return new Response(JSON.stringify({ ok: false, error: "not signed in" }), { status: 401, headers: { "Content-Type": "application/json" } });
    const achievements = await getAchievementsFor(db, user.uid);
    const unlocked = achievements.filter((a) => a.unlocked).length;
    return new Response(JSON.stringify({ ok: true, achievements, unlocked, total: achievements.length }), {
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String((err && err.message) || err) }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
}
