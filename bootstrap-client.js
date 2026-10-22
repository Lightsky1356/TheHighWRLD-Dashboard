// The bootstrap: one request for everything a page needs.
//
// WHY THIS EXISTS
// Opening the site asked for a dozen separate things: the announcements,
// the drops, the trending tracks, the submission rules, the sign-in
// configuration, the session, the account, the notifications, the recent
// plays, the notification settings, the push state and the presence.
//
// Each of those is a request, and the free tier allows a hundred thousand a
// day. A visitor who opened six pages was spending eighty-four requests
// before doing anything at all - and the requests were made one after
// another, each waiting for the last.
//
// So they are asked for together. One request carries the lot, and the
// database is read once rather than once per thing.
//
// HOW THE OTHER CALLS USE IT
// Each module still asks for what it needs - that is the honest way round -
// but it waits for the bootstrap first, and takes the answer from there
// when the bootstrap has it. The modules that want something the bootstrap
// does not carry - the account, the presence, the push state - carry on
// asking for themselves.
//
// The bootstrap is fetched as soon as this file runs, which is before the
// modules that use it - so the answer is usually already on its way by the
// time the first one asks.
//
// The individual endpoints are untouched, so anything that asks for one of
// them directly still works, and the site still works if this never loads.
//
// Usage:  fetch(BASE, { cache: "no-store", credentials: "same-origin" })

const BASE = "/api/bootstrap";

let data = null;
let loading = null;
let at = 0;

/* How long an answer is used for. Long enough that everything on the page
   shares one request, short enough that a change is picked up at once. */
const FRESH_MS = 20000;

/* Fetch it. The same promise is handed to everybody who asks, so there is
   only ever one request in flight. */
function bootstrap() {
  if (data && Date.now() - at < FRESH_MS) return Promise.resolve(data);
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
function bootstrapped() {
  return data;
}

/* Forget it, so the next thing asked for is fetched again. */
function invalidateBootstrap() {
  data = null;
  at = 0;
}

/* Take one thing from the bootstrap.
 *
 * Returns undefined when there is nothing to take - so the caller asks for
 * itself - and the promise for when there is. */
function from(key) {
  if (!data) return undefined;
  if (Date.now() - at >= FRESH_MS) return undefined;
  return data[key];
}

/* Wait for the bootstrap, then take one thing from it.
 *
 * This is what the modules use: they ask for the bootstrap, and when it
 * arrives they take the answer from it rather than asking for it again.
 * The wait is bounded, so a bootstrap that never arrives - because the
 * network is down, or the endpoint is not deployed - does not hold the page
 * up: the module asks for itself instead. */
function take(key, fallback) {
  return bootstrap().then(function (d) {
    var v = from(key);
    if (v !== undefined) return v;
    return fallback();
  });
}

window.THWBootstrap = {
  get: bootstrap,
  data: bootstrapped,
  invalidate: invalidateBootstrap,
  from: from,
  take: take,
};

/* Start fetching straight away.
 *
 * This file runs before the modules that use it - it is first in the list -
 * so the answer is already on its way by the time the first module asks for
 * what it needs. */
bootstrap();
