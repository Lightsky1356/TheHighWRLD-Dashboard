// The bootstrap: one request for everything a page needs.
//
// WHY THIS EXISTS
// Opening the site asked for a dozen separate things - the announcements,
// the drops, the trending tracks, the submission rules, the sign-in
// configuration, the session, the account, the notifications, the recent
// plays, the notification settings, the push state and the presence.
//
// Each of those is a request, and the free tier allows a hundred thousand a
// day. A visitor who opened six pages was spending eighty-four requests
// before doing anything at all.
//
// So they are asked for together. One request carries the lot, and the
// database is read once rather than once per thing.
//
// HOW THE OTHER CALLS USE IT
// Each module still asks for what it needs - that is the honest way round -
// but the answer is already here, so it is taken from here instead of being
// fetched again. The window is short: this is a way of making one request
// carry several answers, not a cache that goes stale.
//
// The individual endpoints are untouched, so anything that asks for one of
// them directly still works, and the site still works if this never loads.
//
// Usage:  fetch(BASE + "?t=" + Date.now()).then(r => r.json())

const BASE = "/api/bootstrap";

let data = null;
let loading = null;
let at = 0;

/* How long an answer is used for. Long enough that everything on the page
   shares one request, short enough that a change is picked up at once. */
const FRESH_MS = 20000;

export function bootstrap() {
  const now = Date.now();
  if (data && now - at < FRESH_MS) return Promise.resolve(data);
  if (loading) return loading;
  loading = fetch(BASE, { cache: "no-store", credentials: "same-origin" })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (d && d.ok) { data = d; at = Date.now(); }
      return d;
    })
    .catch(function () { return null; })
    .then(function (d) { loading = null; return d; });
  return loading;
}

/* What the bootstrap knows, without asking for it. */
export function bootstrapped() {
  return data;
}

/* Forget it, so the next thing asked for is fetched again. */
export function invalidateBootstrap() {
  data = null;
  at = 0;
}

/* Take one thing from the bootstrap, if it is there and fresh enough.
   Returns undefined when there is nothing to take, so the caller falls back
   to asking for itself. */
export function fromBootstrap(key) {
  if (!data) return undefined;
  if (Date.now() - at >= FRESH_MS) return undefined;
  return data[key];
}

window.THWBootstrap = {
  get: bootstrap,
  data: bootstrapped,
  invalidate: invalidateBootstrap,
  from: fromBootstrap,
};

/* Start fetching straight away.
 *
 * The modules ask for what they need as the page loads, and the answer
 * should already be on its way by then. Without this, the first module to
 * ask would fetch the bootstrap and the rest would wait for it - which is
 * the same request either way, but it starts a moment later. */
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", function () { bootstrap(); }, { once: true });
} else {
  bootstrap();
}
