// Shared notification creation for every feature that writes to
// community_notifications.
//
// WHY THIS EXISTS
// user_privacy.notifications_enabled is the user's master "send me
// notifications" switch. Until now it was checked in exactly ONE of the
// thirteen writers (the social API's notify()), so a user who turned
// notifications off still received replies, mentions, follows, playlist
// favourites, drop alerts and moderation notices. The preference looked like it
// worked and did not.
//
// The fix is structural rather than thirteen copies of an if-statement: the
// check, the INSERT and the realtime broadcast all live here, so a new feature
// physically cannot skip the preference by forgetting to test it.
//
// Behaviour deliberately preserved:
//   - No user_privacy row means the server default (enabled), which is what the
//     social API already did (`if (pref && pref.notifications_enabled === 0)`).
//   - A database failure while reading the preference fails OPEN, so a transient
//     D1 error never silently swallows a user's notifications.
//   - Failures are swallowed. A notification must never be able to fail the
//     action that caused it - a reply is already stored by the time it runs.
//   - The broadcast payload is a superset of what the previous per-site payloads
//     sent, so existing clients that read a subset keep working.

import { hubBroadcast } from "./realtime.js";

/**
 * Has this user opted out of notifications?
 * Returns true when the user has not opted out (or has no preference row).
 */
export async function notificationsEnabled(db, uid) {
  if (!uid) return false;
  try {
    const row = await db
      .prepare("SELECT notifications_enabled FROM user_privacy WHERE uid = ?")
      .bind(uid)
      .first();
    if (!row) return true;
    return Number(row.notifications_enabled) !== 0;
  } catch (_) {
    // Fail open: a broken preference lookup must not eat notifications.
    return true;
  }
}

/**
 * Create a notification and broadcast it.
 *
 * Returns { id } when the notification was created, or null when it was
 * suppressed because the recipient opted out (or the write failed). Callers do
 * not need to broadcast themselves - doing so is what made the opt-out
 * ineffective, because the row could be skipped while the realtime event still
 * fired.
 */
export async function createNotification(db, env, recipientUid, options) {
  const opts = options || {};
  if (!recipientUid) return null;

  if (!(await notificationsEnabled(db, recipientUid))) return null;

  try {
    const inserted = await db
      .prepare(
        "INSERT INTO community_notifications " +
          "(recipient_uid, type, actor_uid, actor_name, message, post_id, reply_id) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?)"
      )
      .bind(
        recipientUid,
        String(opts.type || "notice"),
        String(opts.actorUid || ""),
        String(opts.actorName || "Member"),
        String(opts.message || ""),
        opts.postId == null ? null : opts.postId,
        opts.replyId == null ? null : opts.replyId
      )
      .run();

    const id = inserted && inserted.meta && inserted.meta.last_row_id ? Number(inserted.meta.last_row_id) : 0;

    await hubBroadcast(env, {
      type: "notification:created",
      // Private routing: only the recipient's own hub connection may see it.
      private: opts.private !== false,
      recipientUid,
      notification: {
        id,
        type: String(opts.type || "notice"),
        message: String(opts.message || ""),
        post_id: opts.postId == null ? null : opts.postId,
        reply_id: opts.replyId == null ? null : opts.replyId,
        actor: String(opts.actorName || "Member"),
        actor_uid: String(opts.actorUid || ""),
      },
    });

    return { id };
  } catch (_) {
    // Never let a notification failure break the request that triggered it.
    return null;
  }
}