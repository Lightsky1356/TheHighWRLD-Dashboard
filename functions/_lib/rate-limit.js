/* A rate limit, kept in the action log.
 *
 * The limit is a count of what somebody has done in the last window, and
 * the check and the count are one statement - so two requests at once
 * cannot both slip past a limit that was nearly reached.
 *
 * It lives here rather than in the endpoint that first needed it, because
 * there are now more than one of them, and a limit that means one thing in
 * one place and something else in another is not a limit.
 */
export async function rateLimit(db, uid, action, max, windowMs) {
  const since = new Date(Date.now() - windowMs).toISOString();
  const result = await db.prepare(
    "INSERT INTO user_action_log (actor_uid, action) " +
    "SELECT ?, ? WHERE (SELECT COUNT(*) FROM user_action_log " +
    "WHERE actor_uid = ? AND action = ? AND created_at >= ?) < ?"
  ).bind(uid, action, uid, action, since, max).run();
  return Number(result.meta && result.meta.changes) > 0;
}
