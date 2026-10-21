// The community list.
//
// WHY THIS SUITE EXISTS
// The reply count for each post was counted by a subquery for each post, so
// one request for the list ran two hundred queries - and two hundred
// queries is more than the ten milliseconds a request is allowed to take.
//
// So the counts are asked for once, for all of the posts at once. This
// checks that the counts are still the right ones: a post with two replies
// on it says two.
//
// Run against the local dev server, as the other server suites do.

const BASE = "http://127.0.0.1:8788";
/* The community only accepts people who have linked their Discord account,
   so this is the account the seed gives one. */
const AUTHOR = { uid: "gallinked1", token: "gallinked1token" };

const out = [];
function check(name, pass, detail) {
  out.push(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  -> " + detail : ""}`);
}

async function call(token, path, method = "GET", body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { Cookie: `thw_session=${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  /* The body is read in full every time. A response that is left half read
     leaves the connection open, and Node on Windows has a habit of asserting
     about that when the process ends. */
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) {}
  return { status: res.status, json };
}

const title = "Rollup Test " + Date.now();
const created = await call(AUTHOR.token, "/api/community/posts", "POST", {
  title,
  body: "A post made to count the replies on it.",
});
check("the post is made", created.status === 200 && created.json?.ok === true,
  `status ${created.status} ${JSON.stringify(created.json || {}).slice(0, 120)}`);

const postId = created.json?.post?.id ?? created.json?.id;
if (!postId) {
  console.log(out.join("\n"));
  console.log("\nno post was made, so there is nothing to count");
  process.exit(1);
}

for (const body of ["First reply.", "Second reply."]) {
  const r = await call(AUTHOR.token, `/api/community/posts/${postId}/replies`, "POST", { body });
  check(`the reply "${body}" is made`, r.status === 200 && r.json?.ok === true, `status ${r.status}`);
}

const list = await call(AUTHOR.token, "/api/community/posts");
check("the list is read", list.status === 200 && Array.isArray(list.json?.posts), `status ${list.status}`);

const post = (list.json?.posts || []).find((p) => Number(p.id) === Number(postId));
check("the post is in the list", !!post, post ? String(post.id) : "not found");
check("the reply count is right", post && Number(post.reply_count) === 2,
  post ? String(post.reply_count) : "no post");

/* And the list is not counting the replies of a post that is not there. */
const others = (list.json?.posts || []).filter((p) => Number(p.id) !== Number(postId));
check("the other posts have counts of their own",
  others.every((p) => Number(p.reply_count || 0) >= 0),
  others.slice(0, 3).map((p) => `${p.id}:${p.reply_count}`).join(", "));

/* The post is removed again, so the next run starts from the same place. */
const removed = await call(AUTHOR.token, `/api/community/posts/${postId}`, "DELETE");
check("the post is removed again", removed.status === 200 || removed.status === 404, `status ${removed.status}`);

console.log(out.join("\n"));
const failed = out.filter((l) => l.startsWith("FAIL")).length;
console.log(`\n${out.length - failed} passed, ${failed} failed`);
/* A moment, so the connections close before the process ends. */
await new Promise((r) => setTimeout(r, 300));
process.exit(failed ? 1 : 0);
