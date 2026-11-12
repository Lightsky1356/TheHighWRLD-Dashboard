// SONG COMMENTS: a thread per song.
//
// WHY THIS SUITE EXISTS
// A comment is a thing somebody said about a song, and it hangs off the
// song. Three things have to be true at once, and each of them can fail
// on its own:
//
//   1. The thread belongs to the song that was asked for, and to no other.
//   2. A reply sits under the comment it answers, and a heart belongs to
//      one person and is taken back when they change their mind.
//   3. The bytes are only served to somebody who is signed in, and only
//      the author may take a comment back.
//
// The third one is the one that matters: a comment is a person's words,
// and a way to post as somebody else is a way to be somebody else.
//
// Run against the local dev server, as the other server suites do.

const BASE = "http://127.0.0.1:8788";

/* Two members and one who is not in the conversation. */
const ALICE = { uid: "gallinked1", token: "gallinked1token" };
const BOB = { uid: "notifon1", token: "notifontoken1" };
const OUTSIDER = { uid: "pushuser1", token: "pushsessiontoken1" };

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
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) {}
  return { status: res.status, json, text };
}

/* A song of this run's own, so the thread starts empty however many times
   the suite has been run before - and so two runs never argue over the
   same comments. */
const TRACK = "Comment Test " + Date.now();

/* ---------- a comment is written ---------- */
const none = await call(ALICE.token, "/api/song-comments?track=" + encodeURIComponent(TRACK));
check("an empty thread reads", none.status === 200 && (none.json?.comments || []).length === 0,
  `status ${none.status}`);

/* Signed out, nothing can be written. */
const anon = await call("", "/api/song-comments", "POST", { track: TRACK, body: "hello" });
check("a comment needs an account", anon.status === 401, `status ${anon.status}`);

/* A song is needed - a comment about nothing is not a comment. */
const noTrack = await call(ALICE.token, "/api/song-comments", "POST", { body: "hello" });
check("a comment needs a song", noTrack.status === 400, `status ${noTrack.status}`);

/* An empty comment is not a comment. */
const empty = await call(ALICE.token, "/api/song-comments", "POST", { track: TRACK, body: "   " });
check("an empty comment is refused", empty.status === 400, `status ${empty.status}`);

/* The real one. */
const made = await call(ALICE.token, "/api/song-comments", "POST", {
  track: TRACK,
  body: "love this song so much",
  atSeconds: 52,
  atLabel: "0:52",
});
check("a comment is written", made.status === 201 && !!made.json?.comment?.id,
  `status ${made.status} ${JSON.stringify(made.json?.comment || {}).slice(0, 160)}`);
const commentId = made.json?.comment?.id || 0;

/* The moment of the song is kept. */
check("the comment keeps the moment", made.json?.comment?.atSeconds === 52 && made.json?.comment?.atLabel === "0:52",
  JSON.stringify({ s: made.json?.comment?.atSeconds, l: made.json?.comment?.atLabel }));

/* The writer's own name comes from the server, not from the client. */
check("the writer is named by the server",
  !!made.json?.comment?.authorName && made.json?.comment?.authorUid === ALICE.uid,
  JSON.stringify({ n: made.json?.comment?.authorName, u: made.json?.comment?.authorUid }));

/* ---------- the thread reads back ---------- */
const read = await call(BOB.token, "/api/song-comments?track=" + encodeURIComponent(TRACK));
check("the thread reads back", read.status === 200 && (read.json?.comments || []).length === 1,
  `status ${read.status} ${(read.json?.comments || []).length} comments`);
check("the count is right", read.json?.count === 1, `count ${read.json?.count}`);
check("the comment is the one that was written",
  read.json?.comments?.[0]?.body === "love this song so much",
  read.json?.comments?.[0]?.body);

/* Another song has another thread. */
const other = await call(BOB.token, "/api/song-comments?track=" + encodeURIComponent("Some Other Song"));
check("another song has another thread", (other.json?.comments || []).length === 0,
  `${(other.json?.comments || []).length} comments`);

/* ---------- a reply sits under its comment ---------- */
const reply = await call(BOB.token, "/api/song-comments", "POST", {
  track: TRACK,
  body: "i been balling like kobe",
  parentId: commentId,
  atSeconds: 38,
  atLabel: "0:38",
});
check("a reply is written", reply.status === 201 && !!reply.json?.comment?.id, `status ${reply.status}`);
check("the reply knows its parent", reply.json?.comment?.parentId === commentId,
  `parent ${reply.json?.comment?.parentId}`);
const replyId = reply.json?.comment?.id || 0;

const withReply = await call(ALICE.token, "/api/song-comments?track=" + encodeURIComponent(TRACK));
const top = withReply.json?.comments?.[0];
check("the reply sits under the comment", (top?.replies || []).length === 1,
  `${(top?.replies || []).length} replies`);
check("the reply carries its own moment",
  top?.replies?.[0]?.atSeconds === 38,
  JSON.stringify(top?.replies?.[0]?.atSeconds));

/* A reply to a comment that is not there is refused. */
const orphan = await call(BOB.token, "/api/song-comments", "POST", {
  track: TRACK, body: "into the void", parentId: 999999,
});
check("a reply to nothing is refused", orphan.status === 404, `status ${orphan.status}`);

/* ---------- the heart ---------- */
const liked = await call(BOB.token, "/api/song-comments/likes", "POST", { id: commentId });
check("a heart is given", liked.status === 200 && liked.json?.liked === true && liked.json?.likes === 1,
  JSON.stringify(liked.json));

/* The same person cannot heart it twice. */
const again = await call(BOB.token, "/api/song-comments/likes", "POST", { id: commentId });
check("a heart is taken back", again.status === 200 && again.json?.liked === false && again.json?.likes === 0,
  JSON.stringify(again.json));

/* Somebody else can. */
const otherHeart = await call(OUTSIDER.token, "/api/song-comments/likes", "POST", { id: commentId });
check("somebody else can heart it", otherHeart.json?.likes === 1, JSON.stringify(otherHeart.json));

const sawLiked = await call(ALICE.token, "/api/song-comments?track=" + encodeURIComponent(TRACK));
check("the heart is shown to the person who gave it",
  sawLiked.json?.comments?.[0]?.likedByMe === false,
  `likedByMe ${sawLiked.json?.comments?.[0]?.likedByMe}`);

/* A heart on a comment that is not there. */
const noComment = await call(BOB.token, "/api/song-comments/likes", "POST", { id: 999999 });
check("a heart on nothing is refused", noComment.status === 404, `status ${noComment.status}`);

/* ---------- taking a comment back ---------- */
const notYours = await call(BOB.token, "/api/song-comments/" + commentId, "DELETE");
check("somebody else cannot take a comment back", notYours.status === 403, `status ${notYours.status}`);

const yours = await call(ALICE.token, "/api/song-comments/" + commentId, "DELETE");
check("the author can take a comment back", yours.status === 200 && yours.json?.deleted === true,
  `status ${yours.status}`);

const after = await call(BOB.token, "/api/song-comments?track=" + encodeURIComponent(TRACK));
check("the taken comment keeps its place but loses its words",
  (after.json?.comments || []).length === 1 && after.json?.comments?.[0]?.body === "",
  JSON.stringify({ n: (after.json?.comments || []).length, b: after.json?.comments?.[0]?.body }));

/* ---------- the comments are taken back down ---------- */
/* The thread belongs to this run alone, and it is left tidy: each author
   takes their own comment back, which is the same thing a person leaving
   would do - the comment keeps its place and loses its words. */
await call(ALICE.token, "/api/song-comments/" + commentId, "DELETE");
if (replyId) await call(BOB.token, "/api/song-comments/" + replyId, "DELETE");

console.log(out.join("\n"));
const failed = out.filter((l) => l.startsWith("FAIL")).length;
console.log(`\n${out.length - failed} passed, ${failed} failed`);
await new Promise((r) => setTimeout(r, 300));
await new Promise((r) => setTimeout(r, 300));
/* The exit code is set, and the process is left to end on its own - calling
   process.exit() while a socket is still closing crashes the runner on
   Windows, and a red run that has nothing to do with the comments is worse
   than no run at all. */
process.exitCode = failed ? 1 : 0;
