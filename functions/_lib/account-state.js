/* The remembered copy of an account.
 *
 * The account page is read on every load, and again after every save, and
 * it is not cheap: it aggregates the whole listening history and walks every
 * playlist. Two visits in a minute cost exactly as much as one, so the
 * answer is remembered for a moment - and dropped the moment the account
 * changes, so nobody ever sees their own change come back late.
 *
 * It lives here rather than in the account endpoint because other endpoints
 * change the account too: a playlist is made in one endpoint and shown in
 * another, and without this the account page would carry on showing the
 * playlists it had before, for half a minute, after one was made.
 *
 * The answer is not the same for everybody. The account block - the email,
 * the google link - goes only to the person whose account it is, so the
 * remembered copy is kept per viewer as well as per account. Handing one
 * person's copy to another would leak their email.
 *
 * subject -> viewer -> { at, data }.
 */
const STATE_CACHE = new Map();
const STATE_TTL_MS = 30000;
const STATE_CACHE_MAX = 64;

export function stateCacheGet(subject, viewer) {
  const byViewer = STATE_CACHE.get(subject);
  if (!byViewer) return null;
  const hit = byViewer.get(viewer);
  if (!hit) return null;
  if (Date.now() - hit.at >= STATE_TTL_MS) { byViewer.delete(viewer); return null; }
  return hit.data;
}

export function stateCacheSet(subject, viewer, data) {
  let byViewer = STATE_CACHE.get(subject);
  if (!byViewer) { byViewer = new Map(); STATE_CACHE.set(subject, byViewer); }
  byViewer.set(viewer, { at: Date.now(), data });
  /* Bounded: the subject is a query parameter, so in principle anybody can
     ask for a lot of them. */
  while (STATE_CACHE.size > STATE_CACHE_MAX) {
    const oldest = STATE_CACHE.keys().next().value;
    STATE_CACHE.delete(oldest);
  }
}

/* Forget every viewer's copy of an account. Called by anything that changes
   one, from wherever it happens. */
export function invalidateAccountState(uid) {
  if (uid) STATE_CACHE.delete(uid);
}
