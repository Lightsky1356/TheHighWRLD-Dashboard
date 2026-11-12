/*
 * The feed - /feed.xml
 *
 * The newest songs in the vault and the newest things said about them, as
 * a feed anything can read. It is the same information the site shows,
 * in the shape a reader expects.
 *
 * Public, read-only, and cheap: two indexed reads and a little XML.
 */

const SITE = "https://thehighwrlddashboard.pages.dev";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#apos;");
}

/* RFC 822, which is what a feed asks for. */
function rfc822(iso) {
  const d = new Date(iso || Date.now());
  if (isNaN(d.getTime())) return new Date().toUTCString();
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const p = (n) => String(n).padStart(2, "0");
  return days[d.getUTCDay()] + ", " + p(d.getUTCDate()) + " " + months[d.getUTCMonth()] + " " +
    d.getUTCFullYear() + " " + p(d.getUTCHours()) + ":" + p(d.getUTCMinutes()) + ":" + p(d.getUTCSeconds()) + " GMT";
}

/* A link to the song's page. The path is the same one the site uses, and
   the name is written the same way - so the link in the feed is the
   address of the page. */
function songSlug(title) {
  return String(title == null ? "" : title)
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function songPath(title) {
  return "/song/" + songSlug(title);
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestGet(context) {
  const db = context.env.wanted_vault;
  let songs = [];
  let comments = [];

  try {
    const songRows = await db.prepare(
      "SELECT title, note, source, created_at FROM tracks ORDER BY created_at DESC, id DESC LIMIT 25"
    ).all();
    songs = songRows.results || [];

    const commentRows = await db.prepare(
      "SELECT id, track_title, author_name, body, created_at FROM song_comments " +
      "WHERE deleted_at IS NULL AND body <> '' ORDER BY created_at DESC, id DESC LIMIT 25"
    ).all();
    comments = commentRows.results || [];
  } catch (e) {
    /* A feed with nothing in it is still a feed. */
  }

  const items = [];

  comments.forEach(function (c) {
    items.push({
      title: (c.author_name || "Someone") + " on " + (c.track_title || "a song"),
      link: SITE + songPath(c.track_title),
      guid: SITE + "/song-comments#" + c.id,
      date: c.created_at,
      description: c.body || "",
    });
  });

  songs.forEach(function (t) {
    items.push({
      title: t.title || "A song",
      link: SITE + songPath(t.title),
      guid: SITE + songPath(t.title) + "#added",
      date: t.created_at,
      description: t.note || ("Added to the vault" + (t.source && t.source !== "custom" ? " (" + t.source + ")" : "")),
    });
  });

  const body =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">\n' +
    "<channel>\n" +
    "<title>TheHighWRLD Dashboard</title>\n" +
    "<link>" + SITE + "</link>\n" +
    '<atom:link href="' + SITE + '/feed.xml" rel="self" type="application/rss+xml"/>\n' +
    "<description>The newest songs in the vault, and what is being said about them.</description>\n" +
    "<language>en</language>\n" +
    "<lastBuildDate>" + rfc822(new Date().toISOString()) + "</lastBuildDate>\n" +
    items.map(function (i) {
      return "<item>\n" +
        "<title>" + esc(i.title) + "</title>\n" +
        "<link>" + esc(i.link) + "</link>\n" +
        '<guid isPermaLink="false">' + esc(i.guid) + "</guid>\n" +
        "<pubDate>" + rfc822(i.date) + "</pubDate>\n" +
        "<description>" + esc(i.description) + "</description>\n" +
        "</item>";
    }).join("") +
    "</channel>\n</rss>\n";

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, max-age=300, stale-while-revalidate=600",
      ...CORS,
    },
  });
}
