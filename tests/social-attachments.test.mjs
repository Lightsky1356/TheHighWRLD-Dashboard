// SOCIAL MESSAGES: pictures, files, stickers, and the activity line.
//
// WHY THIS SUITE EXISTS
// A message that carries a picture has to carry it all the way: the sender
// picks it, the server keeps it, the reader gets it back, the reader can
// fetch the bytes, and NOBODY ELSE can.
//
// The last one is the one that matters. An attachment that anybody with the
// link could fetch is a picture that was never really private, and the
// people in a chat are the only ones who should have it.
//
// And the activity line: it says what a friend is playing RIGHT NOW, so it
// may only be there while they are actually here. A friend who is offline
// is not listening to anything on this site, and showing a song beside
// their name would be saying something that is not true.
//
// Run against the local dev server, as the other server suites do.

const BASE = "http://127.0.0.1:8788";

/* The two who talk to each other, and the one who is not in the chat. */
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
  return { status: res.status, json, text, headers: res.headers };
}

async function callBytes(token, path) {
  const res = await fetch(BASE + path, {
    headers: { Cookie: `thw_session=${token}` },
  });
  const buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, buf, type: res.headers.get("content-type") || "" };
}

/* A one-pixel PNG. The bytes are what the server checks, so they have to be
   real bytes and not a file called picture.png. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);
const PNG_DATA = "data:image/png;base64," + PNG.toString("base64");

/* ------------------------------------------------------------------ *
 * The two of them are friends, and talking.
 * ------------------------------------------------------------------ */
/* The two of them may already be friends - the database keeps what the
   last run left behind - so a request that is refused because they already
   are is not a failure. */
const requested = await call(ALICE.token, "/api/social/requests", "POST", { uid: BOB.uid });
check("a friend request is sent", requested.status === 200 || requested.status === 409,
  `status ${requested.status}`);

/* The request is not answered with its id, so it is looked for in the
   pending list - which is where the person who received it sees it. */
const bobBoot = await call(BOB.token, "/api/social/bootstrap");
const pending = (bobBoot.json?.requests || []).find((r) => r.uid === ALICE.uid);
let acceptedOk = (bobBoot.json?.friends || []).some((f) => f.uid === ALICE.uid);
if (!acceptedOk && pending) {
  const second = await call(BOB.token, `/api/social/requests/${pending.id}`, "PATCH", { action: "accept" });
  acceptedOk = second.status === 200;
}
check("the two of them are friends", acceptedOk, pending ? `request ${pending.id}` : "already friends");

const opened = await call(ALICE.token, "/api/social/conversations", "POST", { uid: BOB.uid });
check("a conversation is opened", opened.status === 200 && !!opened.json?.conversationId,
  `status ${opened.status} ${JSON.stringify(opened.json || {}).slice(0, 120)}`);
const conversationId = opened.json?.conversationId;
if (!conversationId) {
  console.log(out.join("\n"));
  console.log("\nno conversation was opened, so there is nothing to send");
  process.exit(1);
}

/* ------------------------------------------------------------------ *
 * A message with a picture in it.
 * ------------------------------------------------------------------ */
/* Every message this run sends carries the same mark, so the ones a
   previous run left behind are not counted. */
const MARK = "thw-attach-test-" + Date.now();
const sent = await call(ALICE.token, `/api/social/conversations/${conversationId}/messages`, "POST", {
  body: "here is the cover " + MARK,
  attachments: [{ kind: "photo", name: "cover.png", mime: "image/png", data: PNG_DATA, width: 1, height: 1 }],
});
check("a message with a picture is sent", sent.status === 201 && sent.json?.ok === true,
  `status ${sent.status} ${JSON.stringify(sent.json || {}).slice(0, 140)}`);
check("the sent message carries the picture", (sent.json?.message?.attachments || []).length === 1,
  JSON.stringify(sent.json?.message?.attachments || []));

/* The reader gets it back. */
const read = await call(BOB.token, `/api/social/conversations/${conversationId}/messages`);
check("the reader can read the conversation", read.status === 200, `status ${read.status}`);
const messages = read.json?.messages || [];
const withPicture = messages.filter((m) => (m.attachments || []).length && String(m.body || "").indexOf(MARK) >= 0);
check("the reader sees the picture on the message", withPicture.length === 1,
  `${withPicture.length} messages carry an attachment`);
const attachment = withPicture[0]?.attachments?.[0];
check("the attachment has a name and a size", !!attachment?.name && attachment?.size > 0,
  JSON.stringify(attachment || {}).slice(0, 140));
check("the attachment has a url", /^\/api\/social\/attachments\//.test(attachment?.url || ""),
  attachment?.url || "no url");

/* The bytes come back, and they are the right bytes. */
if (attachment?.url) {
  const fetched = await callBytes(BOB.token, attachment.url);
  check("the reader can fetch the picture", fetched.status === 200, `status ${fetched.status}`);
  check("it comes back as an image", /image\/png/.test(fetched.type), fetched.type);
  check("the bytes are the bytes that were sent",
    fetched.buf.length === PNG.length && fetched.buf.equals(PNG),
    `${fetched.buf.length} bytes against ${PNG.length}`);

  /* And nobody else can. */
  const denied = await callBytes(OUTSIDER.token, attachment.url);
  check("nobody outside the chat can fetch it", denied.status === 404, `status ${denied.status}`);
}

/* ------------------------------------------------------------------ *
 * A sticker.
 * ------------------------------------------------------------------ */
/* How many stickers the thread already holds. A sticker is not words - it
   IS the message - so it cannot carry a mark like the other messages do,
   and the count is what tells this run's sticker from an earlier one. */
const beforeStickers = (read.json?.messages || []).filter((m) => m.sticker).length;

const sticker = await call(ALICE.token, `/api/social/conversations/${conversationId}/messages`, "POST", {
  body: "\u{1F917}", sticker: "\u{1F917}",
});
check("a sticker is sent", sticker.status === 201, `status ${sticker.status}`);
check("the sticker comes back with the message", sticker.json?.message?.sticker === "\u{1F917}",
  JSON.stringify(sticker.json?.message?.sticker || ""));

const readAgain = await call(BOB.token, `/api/social/conversations/${conversationId}/messages`);
const stickerSeen = (readAgain.json?.messages || []).filter((m) => m.sticker);
check("the reader sees the sticker", stickerSeen.length === beforeStickers + 1,
  `${stickerSeen.length} stickers, against ${beforeStickers} before`);

/* ------------------------------------------------------------------ *
 * What may NOT be attached.
 * ------------------------------------------------------------------ */
const wrongType = await call(ALICE.token, `/api/social/conversations/${conversationId}/messages`, "POST", {
  body: "not this",
  attachments: [{ kind: "photo", name: "thing.exe", mime: "application/x-msdownload", data: PNG_DATA }],
});
check("a type that is not allowed is refused", wrongType.status === 400, `status ${wrongType.status}`);

const lying = await call(ALICE.token, `/api/social/conversations/${conversationId}/messages`, "POST", {
  body: "not this either",
  attachments: [{ kind: "photo", name: "picture.png", mime: "image/png", data: "data:image/png;base64," + Buffer.from("<script>").toString("base64") }],
});
check("bytes that are not what they say are refused", lying.status === 400, `status ${lying.status}`);

const tooBig = await call(ALICE.token, `/api/social/conversations/${conversationId}/messages`, "POST", {
  body: "nor this",
  attachments: [{ kind: "file", name: "big.txt", mime: "text/plain", data: "data:text/plain;base64," + Buffer.alloc(900 * 1024, 65).toString("base64") }],
});
check("a file over the cap is refused", tooBig.status === 400, `status ${tooBig.status}`);

/* ------------------------------------------------------------------ *
 * The activity line.
 *
 * The friend is not on the site, so there is nothing to say about what they
 * are playing - and the friends list must say nothing.
 * ------------------------------------------------------------------ */
const boot = await call(ALICE.token, "/api/social/bootstrap");
const friendRow = (boot.json?.friends || []).find((f) => f.uid === BOB.uid);
check("the friend is in the friends list", !!friendRow, friendRow ? friendRow.name : "not found");
if (friendRow) {
  check("an offline friend has no activity line", !friendRow.activity,
    JSON.stringify(friendRow.activity || ""));
  check("the friend is shown as offline", friendRow.online === false, String(friendRow.online));
}

/* The conversation says the same thing. */
const convoRow = (boot.json?.conversations || []).find((c) => c.id === conversationId);
if (convoRow) {
  check("an offline conversation has no activity line", !convoRow.activity,
    JSON.stringify(convoRow.activity || ""));
}

console.log(out.join("\n"));
const failed = out.filter((l) => l.startsWith("FAIL")).length;
console.log(`\n${out.length - failed} passed, ${failed} failed`);
await new Promise((r) => setTimeout(r, 300));
await new Promise((r) => setTimeout(r, 300));
process.exit(failed ? 1 : 0);
