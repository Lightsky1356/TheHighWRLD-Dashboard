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

/* Which preference category each notification type belongs to.
   Types absent from this map are not user-configurable and are always delivered
   (subject to the master switch): follow, playlist, drop, suggestion, wanted,
   moderation, warning, ban, appeal. Moderation notices stay non-optional on
   purpose - someone who has been banned should never be able to tune that away
   by accident. */
const TYPE_CATEGORY = {
  reply: "replies",
  wanted_reply: "wanted_replies",
  mention: "mentions",
  vote: "upvotes",
  upvote: "upvotes",
  reply_vote: "upvotes",
  dm_message: "direct_messages",
  friend_request: "friend_requests",
  friend_accepted: "friend_requests",
};

/* Types covered by the partial unique index in migration 0037. Only these are
   safe to deduplicate: re-delivering a vote is the bug, re-delivering a message
   is the feature. */
const IDEMPOTENT_TYPES = ["vote", "upvote", "reply_vote"];

/**
 * Per-category preferences for a user. Returns all-true defaults when there is
 * no row, matching the fail-open rule above: an existing account must keep its
 * current behaviour without needing a backfill.
 */
export async function notificationPrefs(db, uid) {
  const defaults = {
    replies: 1,
    wanted_replies: 1,
    mentions: 1,
    upvotes: 1,
    direct_messages: 1,
    friend_requests: 1,
    in_site: 1,
    push: 1,
    message_previews: 1,
  };
  if (!uid) return defaults;
  try {
    const row = await db
      .prepare("SELECT * FROM user_notification_prefs WHERE uid = ?")
      .bind(uid)
      .first();
    if (!row) return defaults;
    for (const k of Object.keys(defaults)) {
      if (row[k] !== undefined && row[k] !== null) defaults[k] = Number(row[k]) !== 0 ? 1 : 0;
    }
    return defaults;
  } catch (_) {
    // Fail open. A missing prefs table or a broken read must not silently mute
    // every notification on the site.
    return defaults;
  }
}

/**
 * May this user be notified about this event type at all?
 * Honours the master switch first, then the per-category opt-out.
 */
export async function categoryEnabled(db, uid, type) {
  const master = await notificationsEnabled(db, uid);
  if (!master) return false;
  const category = TYPE_CATEGORY[String(type || "")];
  if (!category) return true;
  const prefs = await notificationPrefs(db, uid);
  return prefs.in_site !== 0 && prefs[category] !== 0;
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
  /* Narrower opt-outs sit under the master switch, checked here rather than at
     each of the thirteen call sites for the same reason the master switch is:
     a new feature must not be able to skip the preference by forgetting it. */
  if (!(await categoryEnabled(db, recipientUid, opts.type))) return null;

  const type = String(opts.type || "notice");
  const postId = opts.postId == null ? null : opts.postId;
  const replyId = opts.replyId == null ? null : opts.replyId;
  const actorUid = String(opts.actorUid || "");
  /* Self-notification is never right. Several call sites already guard for it;
     doing it here too means a future call site cannot forget. */
  if (actorUid && actorUid === String(recipientUid)) return null;

  const idempotent = IDEMPOTENT_TYPES.indexOf(type) !== -1;

  try {
    const inserted = await db
      .prepare(
        "INSERT " + (idempotent ? "OR IGNORE " : "") + "INTO community_notifications " +
          "(recipient_uid, type, actor_uid, actor_name, message, post_id, reply_id) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?)"
      )
      .bind(
        recipientUid,
        type,
        actorUid,
        String(opts.actorName || "Member"),
        String(opts.message || ""),
        postId,
        replyId
      )
      .run();

    /* OR IGNORE on an idempotent type means the row already existed, so this was
       a retry or a repeated upvote. meta.changes of 0 is the signal; returning
       early keeps the client from being told about a notification it already
       has. */
    if (idempotent && inserted && inserted.meta && Number(inserted.meta.changes) === 0) {
      return { id: 0, deduped: true };
    }

    const id = inserted && inserted.meta && inserted.meta.last_row_id ? Number(inserted.meta.last_row_id) : 0;

    await hubBroadcast(env, {
      type: "notification:created",
      // Private routing: only the recipient's own hub connection may see it.
      private: opts.private !== false,
      recipientUid,
      notification: {
        id,
        type,
        message: String(opts.message || ""),
        post_id: postId,
        reply_id: replyId,
        actor: String(opts.actorName || "Member"),
        actor_uid: actorUid,
      },
    });

    return { id };
  } catch (_) {
    // Never let a notification failure break the request that triggered it.
    return null;
  }
}