// /api/notification-settings - per-category notification preferences.
//
//   GET  /api/notification-settings -> { ok, prefs }
//   POST /api/notification-settings -> { ok, prefs }
//
// Separate from /api/privacy, which is the visibility record, and from
// /api/push, which owns device subscriptions. This owns only which categories of
// event reach this account, and it applies on top of the master switch in
// user_privacy.notifications_enabled - turning a category off here never turns
// the master switch off, and never touches other people's notifications.
//
// Session-authed, and scoped to the caller's own uid on write. There is no
// request field naming a user, so a caller cannot edit anyone else's preferences.

import { getSessionUser } from "../_lib/auth.js";
import { notificationPrefs } from "../_lib/notifications.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

/* Allowlist. Anything not named here is ignored rather than passed to SQL, and
   the values are coerced to 0/1 so a caller cannot store a string and have it
   read back as truthy. */
const COLUMNS = [
  "replies",
  "wanted_replies",
  "mentions",
  "upvotes",
  "direct_messages",
  "friend_requests",
  "in_site",
  "push",
  "message_previews",
  "announcements",
  "suggestions",
  "comment_replies",
];

export async function onRequest(context) {
  const { request } = context;
  const method = request.method;

  if (method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  const db = context.env.wanted_vault;
  if (!db) return json({ ok: false, error: "database_unavailable" }, 503);

  let me;
  try {
    me = await getSessionUser(db, request);
  } catch (_) {
    return json({ ok: false, error: "session_lookup_failed" }, 401);
  }
  // Without an account there are no preferences to read or write. Silently
  // succeeding would show the user a saved state that nothing is honouring.
  if (!me || !me.uid) return json({ ok: false, error: "sign_in_required" }, 401);

  try {
    if (method === "GET") {
      return json({ ok: true, prefs: await notificationPrefs(db, me.uid) });
    }

    if (method === "POST") {
      let body = {};
      try {
        body = await request.json();
      } catch (_) {
        return json({ ok: false, error: "invalid_json" }, 400);
      }
      const input = body.prefs && typeof body.prefs === "object" ? body.prefs : body;

      const sets = [];
      const vals = [];
      for (const col of COLUMNS) {
        if (!(col in input)) continue;
        sets.push(col + " = ?");
        vals.push(input[col] ? 1 : 0);
      }
      if (!sets.length) return json({ ok: false, error: "no_known_preferences" }, 400);

      // Upsert on uid so first save creates the row and later saves update it.
      // A blank slate must not be written: an account that has never touched
      // these settings is represented by "no row", which reads as all-defaults.
      await db
        .prepare(
          "INSERT INTO user_notification_prefs (uid, " + COLUMNS.join(", ") + ", updated_at) " +
          "VALUES (?, " + COLUMNS.map(() => "?").join(", ") + ", strftime('%Y-%m-%dT%H:%M:%fZ','now')) " +
          "ON CONFLICT(uid) DO UPDATE SET " + sets.join(", ") +
          ", updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')"
        )
        .bind(me.uid, ...COLUMNS.map((c) => (c in input ? (input[c] ? 1 : 0) : 1)), ...vals)
        .run();

      return json({ ok: true, prefs: await notificationPrefs(db, me.uid) });
    }

    return json({ ok: false, error: "method_not_allowed" }, 405);
  } catch (_) {
    // Opaque: this endpoint's errors never need the SQL text to be useful, and
    // echoing it risks leaking the schema to an unauthenticated probe.
    return json({ ok: false, error: "notification_settings_failed" }, 500);
  }
}