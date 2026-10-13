// Blocks the test suite from being served.
//
// WHY THIS FILE EXISTS
// wrangler.toml sets the Pages output directory to "." - the repository root. That
// means EVERY file committed here is published as a static URL, including tests/.
// Cloudflare Pages has no _headers directive to deny a path, and _routes.json
// only controls whether a path invokes a Function; it does not stop static
// assets being served.
//
// A Function route for /tests/* DOES intercept the request before the static
// asset handler, so this returns 404 and the files are unreachable in production
// while remaining in git for developers.
//
// The tests contain no secrets, so this is hygiene rather than a security fix -
// but shipping a test harness that points at internal endpoints and local test
// accounts is not something to leave publicly reachable.

export async function onRequest() {
  return new Response("Not found", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}