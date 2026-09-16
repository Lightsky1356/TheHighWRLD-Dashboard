import { json, CORS, getActor, resolveTarget, rateLimit } from "../../../_lib/relationships.js";

// POST /api/users/:id/mute  — mute a user (content stays visible, activity suppressed).
// DELETE /api/users/:id/mute — remove that mute relationship only.
export async function onRequest(context) {
  try {
    const db = context.env.wanted_vault;
    const parts = new URL(context.request.url).pathname.split("/").filter(Boolean);
    const id = decodeURIComponent(parts[parts.length - 2] || "");
    const method = context.request.method;

    const actorUid = await getActor(db, context.request);
    if (!actorUid) return json({ error: "sign_in_required", message: "Please connect your account first." }, 401);

    const target = await resolveTarget(db, id);
    if (!target) return json({ error: "not found" }, 404);
    if (target.uid === actorUid) {
      return json({ error: "cannot_perform_on_self", message: "You cannot perform this action on yourself." }, 400);
    }

    if (method === "POST") {
      const exists = await db.prepare(
        "SELECT 1 FROM user_mutes WHERE muter_user_id = ? AND muted_user_id = ? LIMIT 1"
      ).bind(actorUid, target.uid).first();
      if (exists) return json({ error: "already_muted", message: "You're already muting this user." }, 409);
      if (!(await rateLimit(db, actorUid, "mute"))) {
        return json({ error: "slow down - too many actions recently" }, 429);
      }
      try {
        await db.prepare(
          "INSERT INTO user_mutes (muter_user_id, muted_user_id, muted_discord_id) VALUES (?, ?, ?)"
        ).bind(actorUid, target.uid, target.discordId).run();
      } catch (e) {
        if (String((e && e.message) || e).toLowerCase().indexOf("unique") >= 0) {
          return json({ error: "already_muted", message: "You're already muting this user." }, 409);
        }
        throw e;
      }
      return json({ ok: true, muted: true, uid: target.uid });
    }

    if (method === "DELETE") {
      const exists = await db.prepare(
        "SELECT 1 FROM user_mutes WHERE muter_user_id = ? AND muted_user_id = ? LIMIT 1"
      ).bind(actorUid, target.uid).first();
      if (!exists) return json({ error: "not_muted", message: "This user is not muted." }, 409);
      if (!(await rateLimit(db, actorUid, "unmute"))) {
        return json({ error: "slow down - too many actions recently" }, 429);
      }
      await db.prepare(
        "DELETE FROM user_mutes WHERE muter_user_id = ? AND muted_user_id = ?"
      ).bind(actorUid, target.uid).run();
      return json({ ok: true, muted: false, uid: target.uid });
    }

    const headers = { "Content-Type": "application/json", ...CORS };
    return new Response(JSON.stringify({ error: "method not allowed" }), { status: 405, headers });
  } catch (err) {
    return json({ error: String((err && err.message) || err) }, 500);
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}