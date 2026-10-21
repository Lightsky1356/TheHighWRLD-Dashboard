// The signed-in paths that had never been exercised end to end.
//
// WHY THIS SUITE EXISTS
// Three behaviours were fixed but only ever verified by reading the code, or by
// testing the GUEST branch. Each of them is a branch that only runs for a
// signed-in user, so a guest test cannot reach it:
//
//   1. "Mark all read" against real unread community notifications. The client
//      posts { action: "readAll" } to /api/notifications; the guest branch
//      only clears localStorage, so the server path was untested.
//   2. Dismissing ONE notification. The dismiss action deletes a row by id.
//   3. Saving the theme to the ACCOUNT. The guest branch writes localStorage;
//      the signed-in branch posts to /api/account and reads the theme back.
//
// All three are driven against the real endpoints with a real session cookie,
// because the bug class here is exactly "the code path that only runs when
// signed in, silently doing nothing".
//
// NOTIFICATIONS ARE CREATED THROUGH THE API, NOT BY WRITING TO THE DATABASE
// The first version of this suite inserted community_notifications rows with
// `wrangler d1 execute --local` while the dev server was running, and the
// server's connection to the local database was reset by the write - the next
// fetch came back with ECONNRESET. So a follow is used to create the rows
// instead, which is what the app itself does and what the opt-out suite
// already does. Everything is then asserted through the API, because the GET
// response carries both the unread count and a per-row read flag, so the
// database never has to be read directly either.
//
// Run against the local dev server, as the other server suites do.

const BASE = "http://127.0.0.1:8788";

/* The recipient has notifications_enabled = 1 (see tests/seed.mjs), so it
   actually receives them. The four others are used as actors: each one follows
   the recipient to create one notification. */
const RECIPIENT = { uid: "notifon1", token: "notifontoken1" };
const ACTORS = [
  { uid: "notifactor1", token: "notifactor1token" },
  { uid: "pushuser1", token: "pushsessiontoken1" },
  { uid: "gallinked1", token: "gallinked1token" },
  { uid: "galunlinked1", token: "galunlinked1token" },
];

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
  /* The body is read in full every time. A response left half read
     leaves the connection open, and Node on Windows asserts about that when
     the process ends - which fails the whole group even when every check in
     it passed. */
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) {}
  return { status: res.status, json };
}

const bell = async () => {
  const r = await call(RECIPIENT.token, "/api/notifications");
  return {
    status: r.status,
    unread: r.json?.unread ?? -1,
    items: r.json?.notifications || [],
  };
};

/* Follow, then unfollow, so the follow is a NEW one and the notification is
   definitely created rather than skipped as a duplicate. The unfollow first
   matters: the opt-out suite leaves a follow behind, and re-following someone
   you already follow does not create a second notification. */
async function makeNotification(actor) {
  await call(actor.token, "/api/follows", "POST", { action: "unfollow", uid: RECIPIENT.uid });
  const r = await call(actor.token, "/api/follows", "POST", { action: "follow", uid: RECIPIENT.uid });
  return r;
}

// ---- 1. mark all read, with real unread rows --------------------------------
{
  const before = await bell();
  check("the session is recognised", before.status === 200, `status=${before.status}`);

  let created = 0;
  for (const a of ACTORS.slice(0, 3)) {
    const r = await makeNotification(a);
    if (r.status === 200) created++;
  }
  check("three follows were accepted", created === 3, `accepted=${created}`);

  const withUnread = await bell();
  const added = withUnread.unread - before.unread;
  check("the recipient now has three unread notifications", added === 3, `unread ${before.unread} -> ${withUnread.unread}`);

  const readAll = await call(RECIPIENT.token, "/api/notifications", "POST", { action: "readAll" });
  check("POST readAll succeeds", readAll.status === 200, `status=${readAll.status}`);

  const after = await bell();
  check("unread is now zero", after.unread === 0, `unread=${after.unread}`);

  const unreadFlags = after.items.filter((n) => !n.read);
  check("every listed row reports itself read, not merely hidden", unreadFlags.length === 0, `${unreadFlags.length} still flagged unread`);

  check("readAll does not delete the rows", after.items.length >= withUnread.items.length, `items ${withUnread.items.length} -> ${after.items.length}`);
}

// ---- 2. dismissing ONE notification ------------------------------------------
{
  const before = await bell();
  check("the inbox is settled before the dismiss test", before.unread === 0, `unread=${before.unread}`);

  for (const a of ACTORS.slice(0, 2)) await makeNotification(a);

  const list = await bell();
  check("two notifications arrived for the dismiss test", list.unread === 2, `unread=${list.unread}`);

  const two = list.items.filter((n) => !n.read).slice(0, 2);
  if (two.length < 2) {
    check("POST dismiss succeeds", false, "not enough unread rows to dismiss one of");
    check("only the chosen row is removed", false, "not run");
    check("the other row survives", false, "not run");
  } else {
    const [doomed, keeper] = two;

    const d = await call(RECIPIENT.token, "/api/notifications", "POST", { action: "dismiss", id: doomed.id });
    check("POST dismiss succeeds", d.status === 200, `status=${d.status}`);

    const after = await bell();
    const ids = after.items.map((n) => n.id);
    check("the dismissed row is gone", !ids.includes(doomed.id), `ids=${ids.join(",")}`);
    check("the other row survives", ids.includes(keeper.id), `ids=${ids.join(",")}`);
    check("unread dropped by exactly one", after.unread === 1, `unread=${after.unread}`);
  }
}

// ---- 3. saving the theme to the account --------------------------------------
{
  const save = await call(RECIPIENT.token, "/api/account", "POST", { action: "saveTheme", theme: "violet" });
  check("POST saveTheme succeeds", save.status === 200 && save.json?.ok === true, `status=${save.status} body=${JSON.stringify(save.json).slice(0, 80)}`);

  const acct = await call(RECIPIENT.token, "/api/account?user=" + encodeURIComponent(RECIPIENT.uid));
  check("the theme is read back as violet", acct.json?.theme === "violet", `theme=${acct.json?.theme}`);

  // A second, different theme, to prove it is not a one-off write.
  await call(RECIPIENT.token, "/api/account", "POST", { action: "saveTheme", theme: "obsidian" });
  const acct2 = await call(RECIPIENT.token, "/api/account?user=" + encodeURIComponent(RECIPIENT.uid));
  check("a second theme overwrites the first", acct2.json?.theme === "obsidian", `theme=${acct2.json?.theme}`);

  // Put it back, so the account is not left on a theme the test chose.
  await call(RECIPIENT.token, "/api/account", "POST", { action: "saveTheme", theme: "default" });
  const acct3 = await call(RECIPIENT.token, "/api/account?user=" + encodeURIComponent(RECIPIENT.uid));
  check("and it can be put back", acct3.json?.theme === "default", `theme=${acct3.json?.theme}`);
}

console.log(out.join("\n"));
const failed = out.filter((l) => l.startsWith("FAIL")).length;
console.log(`\n${out.length - failed} passed, ${failed} failed`);
/* A moment, so the connections close before the process ends. */
await new Promise((r) => setTimeout(r, 300));
process.exit(failed ? 1 : 0);
