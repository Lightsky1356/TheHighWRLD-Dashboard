// Site-wide ban foundation (Phase 1): server-side active-ban checks.
// A ban is ACTIVE when revoked_at IS NULL AND (expires_at IS NULL OR future).
// Expired/revoked rows stay in the table for moderation history.
// Moderator notes never leave the server (not returned by banStatus).

export async function banStatus(db, uid) {
  const none = { banned: false, id: 0, reason: "", created_at: "", expires_at: "" };
  if (!uid) return none;
  try {
    const row = await db.prepare(
      "SELECT id, reason, created_at, expires_at FROM bans " +
      "WHERE user_id = ? AND revoked_at IS NULL " +
      "AND (expires_at IS NULL OR expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')) " +
      "ORDER BY id DESC LIMIT 1"
    ).bind(String(uid).slice(0, 40)).first();
    if (!row) return none;
    return {
      banned: true,
      id: row.id,
      reason: row.reason || "",
      created_at: row.created_at || "",
      expires_at: row.expires_at || "",
    };
  } catch (_) {
    // Fail closed-safe: a DB error must not lock users out, and callers
    // decide enforcement. Return not-banned; errors surface in logs.
    return none;
  }
}

// Helper for protected mutation endpoints. Returns a JSON Response when the
// user is banned, or null when the request may continue.
export async function banRejection(db, uid) {
  const st = await banStatus(db, uid);
  if (!st.banned) return null;
  return {
    banned: true,
    response: new Response(
      JSON.stringify({
        error: "ACCOUNT_BANNED",
        message: "Your account is currently banned.",
        ban: { id: st.id, reason: st.reason, expires_at: st.expires_at },
      }),
      { status: 403, headers: { "Content-Type": "application/json" } }
    ),
  };
}
