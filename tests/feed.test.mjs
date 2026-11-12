// THE FEED
//
// WHY THIS SUITE EXISTS
// The feed is a promise to anything that reads the site without a browser:
// the newest songs, and what is being said about them. A feed that is not
// well formed, or that is served as the wrong thing, is worse than no
// feed - a reader shows an error and nobody comes back.
//
// It is also the one thing on the site that answers with something other
// than JSON or HTML, so it is the one thing that can be got wrong in a
// way nothing else would notice.
//
// Run against the local dev server, as the other server suites do.

const BASE = "http://127.0.0.1:8788";

const out = [];
function check(name, pass, detail) {
  out.push(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  -> " + detail : ""}`);
}

const res = await fetch(BASE + "/feed.xml", { headers: { Accept: "application/rss+xml" } });
const body = await res.text();

check("the feed answers", res.status === 200, `status ${res.status}`);

const type = String(res.headers.get("content-type") || "");
check("it is served as a feed", /xml/i.test(type), type);

check("it is a well formed feed",
  body.indexOf("<?xml") === 0 && /<rss[\s>]/.test(body) && /<\/rss>/.test(body),
  body.slice(0, 60).replace(/\n/g, " "));

check("it has a channel", /<channel>/.test(body) && /<\/channel>/.test(body), "");
check("the channel has a title", /<title>[^<]+<\/title>/.test(body), "");
check("the channel has a link", /<link>https?:\/\/[^<]+<\/link>/.test(body), "");
check("it says what it is", /<description>[^<]+<\/description>/.test(body), "");
check("it is dated", /<lastBuildDate>[^<]+<\/lastBuildDate>/.test(body), "");

/* Every item has to carry the three things a reader needs: what it is,
   where it is, and when it was. */
const items = body.match(/<item>[\s\S]*?<\/item>/g) || [];
check("the items are well formed", items.every((i) => /<title>[^<]*<\/title>/.test(i) && /<link>[^<]+<\/link>/.test(i) && /<pubDate>[^<]+<\/pubDate>/.test(i)),
  items.length + " items");

/* The links are the site's own addresses, so a song in the feed is a song
   that can be opened. */
const links = items.map((i) => (/<link>([^<]+)<\/link>/.exec(i) || [])[1] || "");
check("every item links somewhere on the site",
  links.every((l) => !l || /^https?:\/\/[^/]+\/(song|feed|song-comments)/.test(l)),
  links.slice(0, 3).join(" | "));

/* And the feed is not a copy of the page. */
check("it is not the page", body.indexOf("<html") < 0, "");

console.log(out.join("\n"));
const failed = out.filter((l) => l.startsWith("FAIL")).length;
console.log(`\n${out.length - failed} passed, ${failed} failed`);
await new Promise((r) => setTimeout(r, 300));
await new Promise((r) => setTimeout(r, 300));
process.exitCode = failed ? 1 : 0;
