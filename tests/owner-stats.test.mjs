// The owner's statistics.
//
// WHY THIS SUITE EXISTS
// The statistics were asked for four times over - the totals, the days, the
// pages and the countries - and each one was a scan of the whole visits
// table, so one request for the owner's panel read the table four times
// over. The free tier counts rows read rather than queries, and the panel
// asks again every thirty seconds.
//
// So the visits are read once and the summaries are made from what comes
// back. This checks that the summaries still say the same thing as each
// other - the days, the pages and the countries all have to add up to the
// total - and that the numbers do not change between one request and the
// next.
//
// Run against the local dev server, as the other server suites do.

const BASE = "http://127.0.0.1:8788";
const OWNER = { uid: "owner1", token: "owner1token" };

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
     leaves the connection open, and Node on Windows asserts about that
     when the process ends - which fails the group even when every check in
     it passed. */
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) {}
  return { status: res.status, json };
}

/* Some visits, so the summaries have something to say. The pages are
   different on purpose, so the per-page figures can be checked against
   each other. */
const PAGES = ["home", "profile", "community"];
for (const page of PAGES) {
  for (let i = 0; i < 2; i++) {
    const r = await call(OWNER.token, "/api/visit", "POST", { uid: OWNER.uid, page, ua: "Seed Test" });
    if (r.status !== 200) check(`the visit of "${page}" is recorded`, false, `status ${r.status}`);
  }
}

const stats = await call(OWNER.token, "/api/stats?user=" + encodeURIComponent(OWNER.uid));
check("the statistics are read", stats.status === 200 && stats.json?.totals !== undefined,
  `status ${stats.status}`);

const totals = stats.json?.totals || {};
const perDay = stats.json?.perDay || [];
const perPage = stats.json?.perPage || [];
const perCountry = stats.json?.perCountry || [];

check("the totals count the visits", Number(totals.visits) > 0, String(totals.visits));
check("the totals count the visitors", Number(totals.uniques) > 0, String(totals.uniques));

/* The three breakdowns are made from the same rows, so they have to add up
   to the same total. */
const daySum = perDay.reduce((a, r) => a + Number(r.visits || 0), 0);
const pageSum = perPage.reduce((a, r) => a + Number(r.visits || 0), 0);
const countrySum = perCountry.reduce((a, r) => a + Number(r.visits || 0), 0);

check("the days add up to the total", daySum === Number(totals.visits),
  `${daySum} against ${totals.visits}`);
check("the pages add up to the total", pageSum === Number(totals.visits),
  `${pageSum} against ${totals.visits}`);
check("the countries add up to the total", countrySum === Number(totals.visits),
  `${countrySum} against ${totals.visits}`);

/* The days are the most recent ones, and there are no more than fourteen
   of them. */
check("there are no more than fourteen days", perDay.length <= 14, String(perDay.length));
check("the days come back newest first",
  perDay.every((r, i) => i === 0 || perDay[i - 1].day >= r.day),
  perDay.map((r) => r.day).join(", "));

/* The pages are ordered by how often they were visited. */
check("the pages come back in order",
  perPage.every((r, i) => i === 0 || perPage[i - 1].visits >= r.visits),
  perPage.map((r) => `${r.page}:${r.visits}`).join(", "));

/* The pages that were visited are the ones that were visited. */
for (const page of PAGES) {
  check(`the page "${page}" is in the list`, perPage.some((r) => r.page === page));
}

/* And the numbers do not move between one request and the next, because
   the visits are read once and the summaries are made from them. */
const again = await call(OWNER.token, "/api/stats?user=" + encodeURIComponent(OWNER.uid));
check("the totals do not change between requests",
  Number(again.json?.totals?.visits) === Number(totals.visits),
  `${again.json?.totals?.visits} against ${totals.visits}`);
check("the days do not change between requests",
  JSON.stringify(again.json?.perDay) === JSON.stringify(perDay));

/* Somebody else is still refused. */
const other = await call("pushsessiontoken1", "/api/stats?user=" + encodeURIComponent("pushuser1"));
check("somebody else is refused", other.status === 403, `status ${other.status}`);

console.log(out.join("\n"));
const failed = out.filter((l) => l.startsWith("FAIL")).length;
console.log(`\n${out.length - failed} passed, ${failed} failed`);
/* A moment, so the connections close before the process ends. */
await new Promise((r) => setTimeout(r, 300));
/* A moment, so the connections close before the process ends. */
await new Promise((r) => setTimeout(r, 300));
process.exit(failed ? 1 : 0);
