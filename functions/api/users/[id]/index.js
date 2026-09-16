import { json, getActor, resolveTarget } from "../../../_lib/relationships.js";

// GET /api/users/:id
//   id === "me"      -> the viewer's own block/mute lists + sign-in state.
//   otherwise        -> relationship status toward that user, from the viewer.
export async function onRequestGet(context) {
  try {
    const db = context.env.wanted_vault;
    const parts = new URL(context.request.url).pathname.split("/").filter(Boolean);
    const id = decodeURIComponent(parts[parts.length - 1] || "");
    const actorUid = await getActor(db, context.request);

    if (id === "me") {
      if (!actorUid) return json({ ok: true, signedIn: false, linked: false, blocked: [], muted: [] });
      const link = await db.prepare(
        "SELECT discord_id FROM discord_links WHERE site_uid = ?"
      ).bind(actorUid).first();
      const [blockedRows, mutedRows] = await Promise.all([
        db.prepare(
          "SELECT blocked_user_id, blocked_discord_id FROM user_blocks WHERE blocker_user_id = ?"
        ).bind(actorUid).all(),
        db.prepare(
          "SELECT muted_user_id, muted_discord_id FROM user_mutes WHERE muter_user_id = ?"
        ).bind(actorUid).all(),
      ]);
      return json({
        ok: true,
        uid: actorUid,
        signedIn: true,
        linked: !!(link && link.discord_id),
        blocked: (blockedRows.results || []).map(function (r) {
          return { uid: r.blocked_user_id, discordId: r.blocked_discord_id };
        }),
        muted: (mutedRows.results || []).map(function (r) {
          return { uid: r.muted_user_id, discordId: r.muted_discord_id };
        }),
      });
    }

    const target = await resolveTarget(db, id);
    if (!target) return json({ error: "not found" }, 404);

    let blocked = false;
    let muted = false;
    let self = false;
    if (actorUid && target.uid === actorUid) {
      self = true;
    } else if (actorUid) {
      const [b, m] = await Promise.all([
        db.prepare(
          "SELECT 1 FROM user_blocks WHERE blocker_user_id = ? AND blocked_user_id = ? LIMIT 1"
        ).bind(actorUid, target.uid).first(),
        db.prepare(
          "SELECT 1 FROM user_mutes WHERE muter_user_id = ? AND muted_user_id = ? LIMIT 1"
        ).bind(actorUid, target.uid).first(),
      ]);
      blocked = !!b;
      muted = !!m;
    }
    const link = actorUid ? await db.prepare(
      "SELECT discord_id FROM discord_links WHERE site_uid = ?"
    ).bind(actorUid).first() : null;

    return json({
      ok: true,
      uid: target.uid,
      name: target.name,
      self: self,
      signedIn: !!actorUid,
      linked: !!(link && link.discord_id),
      blocked: blocked,
      muted: muted,
    });
  } catch (err) {
    return json({ error: String((err && err.message) || err) }, 500);
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" } });
}