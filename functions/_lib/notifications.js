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
import { sendPushToUser } from "./webpush.js";

/* ------------------------------------------------------------------ push --
 *
 * WHY THE DEVICE PUSH LIVES HERE
 *
 * A notification has three delivery routes today, and two of them only work
 * while the app is open:
 *
 *   1. the community_notifications row - a badge, seen on next open
 *   2. the hub broadcast - a WebSocket, and a WebSocket only exists while a
 *      tab is open
 *   3. a device push - the push service wakes the service worker, so this is
 *      the ONLY route that reaches someone who has the app closed
 *
 * Route 3 was built (the service worker handler, the VAPID sender, the
 * subscription API, the opt-in UI) but nothing ever called it except
 * /api/push-test. A reply to a closed app was therefore invisible until the
 * user happened to open it.
 *
 * Sending it from here rather than from each of the call sites is the same
 * reasoning as the opt-out check above: one place, so a new notification type
 * physically cannot forget to push.
 */

/* Push text is generic ON PURPOSE.
 *
 * A push payload is handled by push-service infrastructure and the result is
 * visible on a lock screen, so the message body must never travel in one. These
 * summaries name the KIND of event and nothing else - no post title, no reply
 * text, no display name. The notification opens the app to see the detail. */
const PUSH_SUMMARY = {
  reply: { title: "New reply", body: "Someone replied to your post." },
  wanted_reply: { title: "New reply", body: "Someone replied to your wanted post." },
  mention: { title: "You were mentioned", body: "Someone mentioned you." },
  follow: { title: "New follower", body: "Someone started following you." },
  upvote: { title: "Upvote", body: "Someone upvoted your post." },
  vote: { title: "Upvote", body: "Someone upvoted your post." },
  reply_vote: { title: "Reply upvoted", body: "Someone upvoted your reply." },
  dm_message: { title: "New message", body: "You have a new direct message." },
  friend_request: { title: "Friend request", body: "Someone sent you a friend request." },
  friend_accepted: { title: "Friend request accepted", body: "Someone accepted your friend request." },
  playlist: { title: "Playlist activity", body: "Someone interacted with your playlist." },
  drop: { title: "Drop alert", body: "A drop you follow is happening." },
  suggestion: { title: "Suggestion", body: "There is an update on your suggestion." },
  wanted: { title: "Wanted Vault", body: "Someone replied to your nomination." },
  announcement: { title: "Announcement", body: "There is a new announcement." },
  moderation: { title: "Moderation notice", body: "There is a moderation notice for your account." },
  warning: { title: "Account warning", body: "There is a warning on your account." },
  ban: { title: "Account action", body: "There is an update on your account status." },
  appeal: { title: "Appeal update", body: "There is an update on your appeal." },
};
const PUSH_DEFAULT = { title: "TheHighWRLD", body: "You have a new notification." };

/* Where the notification should open when tapped.
 *
 * The service worker only accepts a target from its own allow-list
 * (PUSH_ROUTES in sw.js), so these strings have to match that list. A target
 * that is not on the list is dropped by safeTarget and the notification simply
 * focuses the app, which is a safe outcome - but a real route is better, and
 * the page routes here are the same ones the nav buttons use. */
function pushTargetFor(type) {
  switch (String(type || "")) {
    case "reply":
    case "mention":
    case "upvote":
    case "vote":
    case "reply_vote":
    case "wanted":
    case "wanted_reply":
      return "community";
    case "suggestion":
      return "suggestions";
    case "drop":
      return "hub";
    case "playlist":
      return "profile";
    case "dm_message":
      return "social:conversation";
    case "friend_request":
      return "social:requests";
    case "friend_accepted":
      return "social:friends";
    case "follow":
      return "social:friends";
    case "moderation":
    case "warning":
    case "ban":
    case "appeal":
      return "account";
    default:
      return null;
  }
}

/* Build the push payload for a notification.
 *
 * Exported so it can be asserted on directly. The property that matters most is
 * the one that cannot be checked by looking at a delivery: that the payload
 * carries the KIND of event and nothing else. A payload that leaked a post
 * title or a reply body would be visible on a lock screen, and the lock screen
 * is not the same audience as the app.
 *
 * `id` is the new notification row's id, for callers that want a tag unique
 * per notification. */
export function pushPayloadFor(opts, id) {
  const o = opts || {};
  const summary = PUSH_SUMMARY[o.type] || PUSH_DEFAULT;
  return {
    title: o.pushTitle || summary.title,
    body: o.pushBody || summary.body,
    /* One tag PER NOTIFICATION, not per kind.
       A shared tag makes each new notification REPLACE the one already on the
       lock screen, silently. That is not how a phone works - a second reply
       should be a second banner, and it should make a sound. The social API
       already asked for a per-notification tag for exactly this reason; this
       makes it the default for everything. */
    tag:
      typeof o.pushTag === "function"
        ? String(o.pushTag(id))
        : o.pushTag || ("thw-" + String(o.type || "notice") + "-" + (id || "0")),
    type: String(o.type || "notice"),
    url: o.pushUrl || pushTargetFor(o.type),
    /* Grouped by kind on the lock screen, the way a phone groups a
       conversation. A device that does not support grouping ignores it. */
    threadId: "thw-" + String(o.type || "notice"),
  };
}

/* Send the device push for a notification that has just been created.
 *
 * Never throws. A push failure must not be able to fail the action that
 * caused it - the reply is already stored and the row already exists by the
 * time this runs. */
async function dispatchPush(env, db, recipientUid, opts, ctx, id, prefs) {
  try {
    /* The push toggle is separate from the notification switches. The master
       switch and the per-category switches decide whether the ROW is created;
       the push toggle decides whether the device buzzes. Someone who wants
       notifications in the app but not on their lock screen gets exactly that. */
    const p = prefs || (await notificationPrefs(db, recipientUid));
    if (!p.push) return;

    /* A caller may override the wording. The social API has always sent its own
       summary for direct messages and friend requests - including the sender's
       display name - so that behaviour is preserved rather than quietly
       downgraded to the generic text. Everything else gets the generic
       summary, because a post title or a reply body must not travel in a push
       payload.
     *
     * Unless previews are off, in which case the caller's body is dropped and
       the generic summary is used instead. The body is the message text - the
       social API puts the whole message there - so it is exactly the thing
       this setting is about. The title is not: it is the app name, and it
       leaks nothing. */
    const previewOff = p.message_previews === 0;
    const pushOpts = previewOff
      ? Object.assign({}, opts, { pushBody: undefined })
      : opts;
    const payload = pushPayloadFor(pushOpts, id);

    const sending = sendPushToUser(env, db, recipientUid, payload)
      .catch(() => ({ sent: 0, failed: 0, pruned: 0 }));

    if (ctx && typeof ctx.waitUntil === "function") {
      /* The reply that triggered this should not be held up by a round trip to
         the push service. waitUntil tells the runtime the work outlives the
         response, and guarantees it is not cancelled when the response is
         sent. */
      ctx.waitUntil(sending);
      return;
    }

    /* No context to hand the work to, so it is awaited here. A cap keeps a
       slow push service from holding the request open indefinitely - the
       notification is already stored, so a push that misses its window is far
       better than a request that never returns. */
    await Promise.race([
      sending,
      new Promise((resolve) => setTimeout(resolve, 4000)),
    ]);
  } catch (_) {
    /* A push failure must never fail the notification. */
  }
}

/**
 * May this user be notified about this event type, given their preferences?
 *
 * The same rule as categoryEnabled(), but with the preferences already read, so
 * a caller that needs them for something else does not read them twice. Every
 * notification already needs the preferences, because the message preview
 * setting lives in the same row.
 */
export function categoryAllowedByPrefs(prefs, type) {
  if (!prefs) return true;
  /* The master in-site switch. Off means no row is created at all. */
  if (prefs.in_site === 0) return false;
  const category = TYPE_CATEGORY[String(type || "")];
  if (category && prefs[category] === 0) return false;
  return true;
}

/**
 * The text to show when previews are off: the kind of event and nothing else.
 *
 * The same wording the push summary uses, so a notification with previews off
 * reads the same wherever it is seen. There is no "and here is what was
 * actually said" fallback - that is the whole point of the setting.
 */
function genericMessage(type) {
  const summary = PUSH_SUMMARY[String(type || "")] || PUSH_DEFAULT;
  return summary.body;
}

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
  const prefs = await notificationPrefs(db, uid);
  return categoryAllowedByPrefs(prefs, type);
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
export async function createNotification(db, env, recipientUid, options, ctx) {
  const opts = options || {};
  if (!recipientUid) return null;

  if (!(await notificationsEnabled(db, recipientUid))) return null;
  /* Narrower opt-outs sit under the master switch, checked here rather than at
     each of the thirteen call sites for the same reason the master switch is:
     a new feature must not be able to skip the preference by forgetting it. */
  const prefs = await notificationPrefs(db, recipientUid);
  if (!categoryAllowedByPrefs(prefs, opts.type)) return null;

  const type = String(opts.type || "notice");
  /* With previews off, the notification carries the kind of event instead of
   * the content. The text is what shows in the bell and on a lock screen, and a
   * message excerpt is exactly the thing somebody might not want read over
   * their shoulder. The setting has always been stored; until now nothing
   * read it, which made it a preference that looked like it worked and did
   * not. */
  const previewOff = prefs.message_previews === 0;
  const previewMessage = previewOff ? genericMessage(type) : String(opts.message || "");
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
        previewMessage,
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
        message: previewMessage,
        post_id: postId,
        reply_id: replyId,
        actor: String(opts.actorName || "Member"),
        actor_uid: actorUid,
      },
    });

    /* And the device push, which is the only route that reaches someone who
       has the app closed. The row above is a badge, and the broadcast above is
       a WebSocket that only exists while a tab is open - neither of them
       reaches a closed app.

       Dispatched from inside this function, not from the caller, so it happens
       for exactly the notifications the row is created for. A second list in
       the caller would be a second thing to keep in step with this one, and the
       two would drift.

       Not awaited when there is a context to hand the work to: the reply that
       triggered this should not wait on a round trip to the push service. */
    await dispatchPush(env, db, recipientUid, opts, ctx, id, prefs);

    return { id };
  } catch (_) {
    // Never let a notification failure break the request that triggered it.
    return null;
  }
}