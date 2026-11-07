import { json, authJson, getCookie, getSessionUser, setSessionCookie, SESSION_COOKIE } from "../../_lib/auth.js";

/* The boot session check.
 *
 * Every page load asks the server who is signed in - the answer decides what
 * the nav renders - and the client reads the user out of the response. Along
 * with the user, this endpoint re-issues the session COOKIE.
 *
 * That matters because of how the cookie and the database disagree about time.
 * Signing in sets the cookie with a fixed 30-day Max-Age: the browser counts it
 * down from that moment and no server call can pause it. The database row
 * meanwhile slides (functions/_lib/auth.js) whenever the session is still in
 * use. Decrypting nothing fancy: if a daily visitor's slid session is fine but
 * the cookie quietly died on day 30, they would be signed out anyway - the
 * cookie IS the session as far as their browser is concerned.
 *
 * Re-issuing the cookie here, on every successful check, restarts that
 * countdown with each visit. Active devices - any of them, phone or desktop -
 * never see the 30 days run out; only a device idle for a whole month does.
 * This is also why sessions are no longer single-seat: several devices stay
 * signed in at once, each on its own slid window. */
export async function onRequestGet(context) {
  try {
    const db = context.env.wanted_vault;
    const user = await getSessionUser(db, context.request);
    if (!user) return json({ user: null }, 200);
    /* Only re-issue when the browser actually sent the token back, so the
       shape of a signed-out answer never changes. */
    const token = getCookie(context.request, SESSION_COOKIE);
    return authJson({ user }, token ? setSessionCookie(token) : undefined);
  } catch (err) {
    return json({ error: String(err && err.message || err) }, 500);
  }
}
