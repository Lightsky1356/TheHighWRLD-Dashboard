// The listening statistics, end to end.
//
// WHY THIS SUITE EXISTS
// The listening summaries are kept in three small tables instead of being
// asked for from the history every time a profile is looked at. The history
// is one row per play, and each of the summaries used to read all of it - so
// a profile view read it four times over, and the free tier counts rows
// read rather than queries.
//
// A summary that says something different from the history would be worse
// than an expensive one, so this drives the real endpoints: it records plays
// through the account API, and then reads the profile and the account back
// and checks that they agree with each other and with what was played.
//
// The local database keeps its rows between runs, so everything here is
// counted as a difference rather than an absolute.
//
// Run against the local dev server, as the other server suites do.

const BASE = "http://127.0.0.1:8788";
const MEMBER = { uid: "notifon1", token: "notifontoken1" };

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
  let json = null;
  try { json = await res.json(); } catch (_) {}
  return { status: res.status, json };
}

/* The plays are given titles of their own, because the account API will not
   record the same track twice inside ninety seconds. */
const stamp = Date.now();
const TITLES = [
  `Rollup Test ${stamp} A`,
  `Rollup Test ${stamp} B`,
  `Rollup Test ${stamp} C`,
];

// ---- before --------------------------------------------------------------
const profileBefore = await call(MEMBER.token, "/api/profile?user=" + encodeURIComponent(MEMBER.uid));
const accountBefore = await call(MEMBER.token, "/api/account?user=" + encodeURIComponent(MEMBER.uid));
const trendingBefore = await call(MEMBER.token, "/api/trending?days=7&limit=10");

check("the profile reads", profileBefore.status === 200 && profileBefore.json?.ok === true,
  `status ${profileBefore.status}`);
check("the account reads", accountBefore.status === 200 && accountBefore.json?.ok === true,
  `status ${accountBefore.status}`);
check("the trending page reads", trendingBefore.status === 200 && trendingBefore.json?.ok === true,
  `status ${trendingBefore.status}`);

const playsBefore = Number(profileBefore.json?.stats?.plays ?? profileBefore.json?.plays ?? 0);
const acctPlaysBefore = Number(accountBefore.json?.stats?.plays ?? 0);
const totalBefore = Number(trendingBefore.json?.total_listens ?? 0);

// ---- the plays ------------------------------------------------------------
for (const title of TITLES) {
  const r = await call(MEMBER.token, "/api/account", "POST", { action: "listen", title, seconds: 45 });
  check(`the play of "${title}" is accepted`, r.status === 200 && r.json?.ok !== false, `status ${r.status}`);
}

// ---- after ----------------------------------------------------------------
const profileAfter = await call(MEMBER.token, "/api/profile?user=" + encodeURIComponent(MEMBER.uid));
const accountAfter = await call(MEMBER.token, "/api/account?user=" + encodeURIComponent(MEMBER.uid));

const playsAfter = Number(profileAfter.json?.stats?.plays ?? profileAfter.json?.plays ?? 0);
const acctPlaysAfter = Number(accountAfter.json?.stats?.plays ?? 0);

check("the profile counts the plays that were made",
  playsAfter === playsBefore + TITLES.length,
  `${playsAfter} against ${playsBefore} before`);
check("the account counts the plays that were made",
  acctPlaysAfter === acctPlaysBefore + TITLES.length,
  `${acctPlaysAfter} against ${acctPlaysBefore} before`);
check("the profile and the account agree on the number of plays",
  playsAfter === acctPlaysAfter,
  `${playsAfter} against ${acctPlaysAfter}`);

/* The most played tracks, and the hours of the day, come from the same
   summaries - so they have to agree with the totals. */
const top = (profileAfter.json?.topPlays || profileAfter.json?.stats?.topPlays || []);
const acctTop = (accountAfter.json?.analytics?.topPlays || []);
const topTotal = top.reduce((a, t) => a + Number(t.n || 0), 0);
check("the most played tracks do not claim more plays than were made",
  topTotal <= playsAfter,
  `${topTotal} across ${top.length} tracks, of ${playsAfter} plays`);
check("the account and the profile agree on the most played tracks",
  JSON.stringify(top.slice(0, 5).map((t) => [t.track_id, t.n])) ===
  JSON.stringify(acctTop.slice(0, 5).map((t) => [t.track_id, t.n])),
  JSON.stringify(top.slice(0, 3)) + " against " + JSON.stringify(acctTop.slice(0, 3)));

/* The hours of the day sit at the top of the response; inside "stats" the
   hours are the number of hours listened to. */
const hours = profileAfter.json?.hours || [];
check("there is an hour for every hour of the day", hours.length === 24, String(hours.length));
const hourTotal = hours.reduce((a, h) => a + Number(h || 0), 0);
check("the hours add up to the number of plays", hourTotal === playsAfter, `${hourTotal} against ${playsAfter}`);

/* The day by day figures for the account have to add up to the same total. */
const weekly = accountAfter.json?.analytics?.weekly || [];
const monthly = accountAfter.json?.analytics?.monthly || [];
check("the week adds up to no more than the month",
  weekly.reduce((a, r) => a + Number(r.n || 0), 0) <= monthly.reduce((a, r) => a + Number(r.n || 0), 0),
  `${weekly.length} days in the week, ${monthly.length} in the month`);
check("the month does not claim more plays than were made",
  monthly.reduce((a, r) => a + Number(r.n || 0), 0) <= playsAfter,
  String(monthly.reduce((a, r) => a + Number(r.n || 0), 0)));

/* Reading it again must give the same answer - the summaries are kept, not
   guessed at. */
const profileAgain = await call(MEMBER.token, "/api/profile?user=" + encodeURIComponent(MEMBER.uid));
const playsAgain = Number(profileAgain.json?.stats?.plays ?? profileAgain.json?.plays ?? 0);
check("reading the profile again gives the same number of plays",
  playsAgain === playsAfter,
  `${playsAgain} against ${playsAfter}`);

/* The trending page keeps its own count of the plays - the number of them
   in total, which used to mean counting every row of the history. */
const trendingAfter = await call(MEMBER.token, "/api/trending?days=7&limit=10");
const totalAfter = Number(trendingAfter.json?.total_listens ?? 0);
check("the trending page counts the plays that were made",
  totalAfter === totalBefore + TITLES.length,
  `${totalAfter} against ${totalBefore} before`);
check("the trending page still lists tracks",
  Array.isArray(trendingAfter.json?.trending),
  String(trendingAfter.json?.trending?.length));

console.log(out.join("\n"));
const failed = out.filter((l) => l.startsWith("FAIL")).length;
console.log(`\n${out.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
