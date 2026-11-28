// GET /api/search?q=<text>  |  GET /api/search?trending=1
// Global community search. Public, read-only, debounce-friendly.
// Every category is capped so row-read cost stays small and predictable.

import { getSessionUser } from "../_lib/auth.js";

/* build token: v8m4q9 search.js (wanted_vault D1) */
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const MAX_Q = 80;
const LIMIT = 6;
const LIMIT_CAP = 12;
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

// Escape LIKE wildcards so user input is matched literally.
function like(q) {
  return String(q || "").replace(/([%_\\])/g, "\\$1");
}

// Match user input literally against lower-cased columns via ES-CAPEd LIKE.
function pat(q) {
  return "%" + like(String(q || "").toLowerCase()) + "%";
}

// Split a query into up to 4 literal words. All words must match (AND).
function wordsOf(q) {
  return String(q || "").toLowerCase().split(/\s+/).filter(Boolean).slice(0, 4);
}

// "(LOWER(c1) LIKE ? AND ... words) OR (LOWER(c2) LIKE ? AND ...)" —
// every word must appear in at least one of the columns.
function anyColWordLike(cols, ws) {
  const perCol = cols.map(
    (c) => "(" + ws.map(() => "LOWER(" + c + ") LIKE ? ESCAPE '\\'").join(" AND ") + ")"
  );
  return "(" + perCol.join(" OR ") + ")";
}

// Params for anyColWordLike: one pattern per (col x word).
function wordParams(cols, ws) {
  const out = [];
  for (const c of cols) for (const w of ws) out.push(pat(w));
  return out;
}

// Relevance: exact match on the lead column first, then prefix, then rest.
function rankLead(col) {
  return "(CASE WHEN LOWER(" + col + ") = ? THEN 0 WHEN LOWER(" + col + ") LIKE ? ESCAPE '\\' THEN 1 ELSE 2 END)";
}

/* The search log is pruned on a timer of its own, so that a prune is not a
   cost on every search. */
let lastSearchPruneAt = 0;
const SEARCH_PRUNE_EVERY_MS = 10 * 60 * 1000;

function pruneSearchLog(db) {
  const now = Date.now();
  if (now - lastSearchPruneAt < SEARCH_PRUNE_EVERY_MS) return;
  lastSearchPruneAt = now;
  try {
    db.prepare("DELETE FROM search_logs WHERE ts < ?")
      .bind(new Date(now - 30 * 86400000).toISOString())
      .run();
  } catch (_) {}
}

export async function onRequestGet(context) {
  try {
    const url = new URL(context.request.url);
    const db = context.env.wanted_vault;
    const sql = (s) => db.prepare(s);

    // ---------------- trending (no query text) ----------------
    if (url.searchParams.get("trending") === "1") {
      const cap = 5;
      const [tTracks, tComm, tSugg, tWanted, tPls] = await Promise.all([
        sql(
          `SELECT t.id, t.title, t.note, COUNT(l.id) AS plays
           FROM tracks t LEFT JOIN listens l ON l.track_id = CAST(t.id AS TEXT)
           GROUP BY t.id ORDER BY plays DESC, t.id DESC LIMIT ?`
        ).bind(cap).all(),
        sql(
          `SELECT id, title, body, user_name, avatar, created_at, pinned
           FROM community_posts ORDER BY pinned DESC, id DESC LIMIT ?`
        ).bind(cap).all(),
        sql(
          `SELECT id, title, description, category, author_name, status, vote_count, created_at
           FROM suggestions_v2 ORDER BY vote_count DESC, id DESC LIMIT ?`
        ).bind(cap).all(),
        sql(
          `SELECT id, title, alt_name, description, era, author_name, status, created_at
           FROM wanted_posts ORDER BY id DESC LIMIT ?`
        ).bind(cap).all(),
        sql(
          `SELECT pl.id, pl.uid, pl.name, pl.desc, pl.color, pl.created_at, pl.visibility,
                  p.name AS owner_name,
                  (SELECT COUNT(*) FROM playlist_tracks pt WHERE pt.playlist_id = pl.id) AS count
           FROM playlists pl LEFT JOIN user_profiles p ON p.site_uid = pl.uid
           WHERE pl.visibility = 'public' ORDER BY pl.id DESC LIMIT ?`
        ).bind(cap).all(),
      ]);
      const results = {
        tracks: (tTracks.results || []).map((r) => ({
          id: r.id, title: r.title, note: (r.note || "").slice(0, 120), plays: r.plays || 0,
        })),
        community: (tComm.results || []).map((r) => ({
          id: r.id, title: r.title, body: (r.body || "").slice(0, 140),
          user_name: r.user_name || "", avatar: r.avatar || "", pinned: !!r.pinned, created_at: r.created_at,
        })),
        suggestions: (tSugg.results || []).map((r) => ({
          id: r.id, title: r.title, description: (r.description || "").slice(0, 120),
          category: r.category || "", author_name: r.author_name || "",
          vote_count: r.vote_count || 0, created_at: r.created_at,
        })),
        wanted: (tWanted.results || []).map((r) => ({
          id: r.id, title: r.title, alt_name: r.alt_name || "",
          description: (r.description || "").slice(0, 120), era: r.era || "",
          author_name: r.author_name || "", status: r.status, created_at: r.created_at,
        })),
        playlists: (tPls.results || []).map((r) => ({
          id: r.id, name: r.name, desc: r.desc || "", color: r.color || "",
          owner_name: r.owner_name || "", count: r.count || 0, created_at: r.created_at,
        })),
        users: [],
      };
      return json({
        ok: true, trending: true, results,
        tracks: results.tracks, community: results.community, suggestions: results.suggestions,
        wanted: results.wanted, playlists: results.playlists, users: [],
      });
    }

    // ---------------- text search ----------------
    const qraw = (url.searchParams.get("q") || "").trim().slice(0, MAX_Q);
    const q = qraw.toLowerCase();
    if (!q) return json({ ok: true, q: qraw, results: {} });

    const ws = wordsOf(q);
    const cap = Math.max(1, Math.min(LIMIT_CAP, Number(url.searchParams.get("limit")) || LIMIT));
    const prefix = like(q) + "%";

    const [users, playlists, wantedPosts, suggestions, communityPosts, trackRows, galleryRows] = await Promise.all([
      // --- users: linked Discord accounts (+ site name fallback) ---
      sql(
        `SELECT l.site_uid, l.display_name, l.avatar, p.name AS site_name, u.name AS email_name,
                l.discord_id, l.bio
         FROM discord_links l
         LEFT JOIN user_profiles p ON p.site_uid = l.site_uid
         LEFT JOIN users u ON u.uid = l.site_uid
         WHERE ${anyColWordLike(["l.display_name", "p.name", "u.name"], ws)}
         ORDER BY ${rankLead("l.display_name")}, LENGTH(l.display_name) ASC LIMIT ?`
      )
        .bind(...wordParams(["l.display_name", "p.name", "u.name"], ws), q, prefix, cap)
        .all(),
      // --- playlists: public (name + description) ---
      sql(
        `SELECT pl.id, pl.uid, pl.name, pl.desc, pl.color, pl.created_at, pl.visibility, pl.share_key,
                p.name AS owner_name, p.avatar AS owner_avatar,
                (SELECT COUNT(*) FROM playlist_tracks pt WHERE pt.playlist_id = pl.id) AS count
         FROM playlists pl
         LEFT JOIN user_profiles p ON p.site_uid = pl.uid
         WHERE pl.visibility = 'public' AND ${anyColWordLike(["pl.name", "pl.desc"], ws)}
         ORDER BY ${rankLead("pl.name")}, pl.id DESC LIMIT ?`
      )
        .bind(...wordParams(["pl.name", "pl.desc"], ws), q, prefix, cap)
        .all(),
      // --- wanted vault requests ---
      sql(
        `SELECT id, title, alt_name, description, era, author_uid, author_name, status, created_at
         FROM wanted_posts
         WHERE ${anyColWordLike(["title", "alt_name", "description"], ws)}
         ORDER BY ${rankLead("title")}, id DESC LIMIT ?`
      )
        .bind(...wordParams(["title", "alt_name", "description"], ws), q, prefix, cap)
        .all(),
      // --- suggestions (vote board) ---
      sql(
        `SELECT id, title, description, category, author_uid, author_name, status, vote_count, created_at
         FROM suggestions_v2
         WHERE ${anyColWordLike(["title", "description", "author_name"], ws)}
         ORDER BY ${rankLead("title")}, vote_count DESC, id DESC LIMIT ?`
      )
        .bind(...wordParams(["title", "description", "author_name"], ws), q, prefix, cap)
        .all(),
      // --- community posts ---
      sql(
        `SELECT id, title, body, user_name, avatar, author_uid, discord_id, created_at, pinned
         FROM community_posts
         WHERE ${anyColWordLike(["title", "body", "user_name"], ws)}
         ORDER BY ${rankLead("title")}, pinned DESC, id DESC LIMIT ?`
      )
        .bind(...wordParams(["title", "body", "user_name"], ws), q, prefix, cap)
        .all(),
      // --- tracks (vault) ---
      sql(
        `SELECT t.id, t.title, t.note,
                (SELECT COUNT(*) FROM listens l WHERE l.track_id = CAST(t.id AS TEXT)) AS plays,
                (SELECT COUNT(*) FROM favorites f WHERE f.title = t.title) AS favs
         FROM tracks t
         WHERE ${anyColWordLike(["t.title", "t.note"], ws)}
         ORDER BY ${rankLead("t.title")} LIMIT ?`
      )
        .bind(...wordParams(["t.title", "t.note"], ws), q, prefix, cap)
        .all(),
      // --- gallery (approved works only) ---
      sql(
        `SELECT id, title, caption, user_name
         FROM gallery_items
         WHERE status = 'approved' AND ${anyColWordLike(["title", "caption"], ws)}
         ORDER BY ${rankLead("title")}, id DESC LIMIT ?`
      )
        .bind(...wordParams(["title", "caption"], ws), q, prefix, cap)
        .all(),
    ]);

    const results = {
      tracks: (trackRows.results || []).map((r) => ({
        id: r.id, title: r.title, note: (r.note || "").slice(0, 120),
        plays: r.plays || 0, favs: r.favs || 0,
      })),
      users: (users.results || []).map((r) => ({
        uid: r.site_uid,
        discord_id: r.discord_id || "",
        name: r.display_name || r.site_name || r.email_name || "",
        avatar: r.avatar || "",
        bio: (r.bio || "").slice(0, 120),
        linked: !!r.discord_id,
      })),
      playlists: (playlists.results || []).map((r) => ({
        id: r.id,
        uid: r.uid || "",
        name: r.name,
        desc: r.desc || "",
        color: r.color || "",
        owner_name: r.owner_name || "",
        owner_avatar: r.owner_avatar || "",
        count: r.count || 0,
        created_at: r.created_at,
      })),
      wanted: (wantedPosts.results || []).map((r) => ({
        id: r.id,
        title: r.title,
        alt_name: r.alt_name || "",
        description: (r.description || "").slice(0, 120),
        era: r.era || "",
        author_uid: r.author_uid || "",
        author_name: r.author_name || "",
        status: r.status,
        created_at: r.created_at,
      })),
      suggestions: (suggestions.results || []).map((r) => ({
        id: r.id,
        title: r.title,
        description: (r.description || "").slice(0, 120),
        category: r.category || "",
        author_uid: r.author_uid || "",
        author_name: r.author_name || "",
        vote_count: r.vote_count || 0,
        created_at: r.created_at,
      })),
      community: (communityPosts.results || []).map((r) => ({
        id: r.id,
        title: r.title,
        body: (r.body || "").slice(0, 140),
        user_name: r.user_name || "",
        author_uid: r.author_uid || "",
        discord_id: r.discord_id || "",
        avatar: r.avatar || "",
        pinned: !!r.pinned,
        created_at: r.created_at,
      })),
      gallery: (galleryRows.results || []).map((r) => ({
        id: r.id,
        title: r.title || "Untitled",
        caption: (r.caption || "").slice(0, 120),
        user_name: r.user_name || "",
      })),
    };

    // Block/mute filtering: signed-in users never see content from accounts
    // they blocked/muted, nor from accounts that blocked them. Result sets
    // are capped (<=12 rows), so post-filtering in JS is cheaper than
    // complicating every query. Signed-out search is unfiltered.
    try {
      const me = await getSessionUser(db, context.request);
      if (me && me.uid) {
        const mine = await db.prepare(
          "SELECT discord_id FROM discord_links WHERE site_uid = ?"
        ).bind(me.uid).first().catch(() => null);
        const myDiscord = (mine && mine.discord_id) || "";
        const [bOut, mOut, bIn] = await Promise.all([
          db.prepare("SELECT blocked_user_id AS u, blocked_discord_id AS d FROM user_blocks WHERE blocker_user_id = ?").bind(me.uid).all(),
          db.prepare("SELECT muted_user_id AS u, muted_discord_id AS d FROM user_mutes WHERE muter_user_id = ?").bind(me.uid).all(),
          db.prepare("SELECT blocker_user_id AS u FROM user_blocks WHERE blocked_user_id = ?").bind(me.uid).all(),
        ]);
        const hideUid = new Set(), hideDisc = new Set();
        for (const rows of [bOut.results || [], mOut.results || [], bIn.results || []]) {
          for (const r of rows) {
            if (r.u) hideUid.add(String(r.u));
            if (r.d) hideDisc.add(String(r.d));
          }
        }
        if (myDiscord) {
          const bInD = await db.prepare("SELECT blocker_user_id AS u FROM user_blocks WHERE blocked_discord_id = ?").bind(myDiscord).all().catch(() => ({ results: [] }));
          for (const r of (bInD.results || [])) if (r.u) hideUid.add(String(r.u));
        }
        if (hideUid.size || hideDisc.size) {
          const bad = (u, d) =>
            (u && hideUid.has(String(u))) || (d && hideDisc.has(String(d)));
          results.users = results.users.filter((x) => !bad(x.uid, x.discord_id));
          results.playlists = results.playlists.filter((x) => !bad(x.uid, ""));
          results.wanted = results.wanted.filter((x) => !bad(x.author_uid, ""));
          results.suggestions = results.suggestions.filter((x) => !bad(x.author_uid, ""));
          results.community = results.community.filter((x) => !bad(x.author_uid, x.discord_id));
        }
      }
    } catch (_) {}

    // Search analytics: log the query + total hit count (best-effort only;
    // a logging failure must never break the search response itself).
    const totalHits = results.users.length + results.playlists.length +
      results.wanted.length + results.suggestions.length + results.community.length +
      (results.gallery || []).length;
    try {
      const logP = db.prepare(
        "INSERT INTO search_logs (q, results) VALUES (?, ?)"
      ).bind(qraw.slice(0, MAX_Q), totalHits).run();
      /* The log is pruned here rather than by whoever reads it: it is written
         on every search and it grew for ever, and the dashboard only ever
         shows the last thirty days. */
      pruneSearchLog(db);
      if (context.waitUntil) context.waitUntil(logP);
      else await logP;
    } catch (_) {}

    // Additive aliases: /api/search historically returns `results` (nested),
    // which index.html consumers rely on. global-search.js reads the same
    // groups at the TOP level (d.users/d.playlists/...). Expose both.
    return json({
      ok: true,
      q: qraw,
      results,
      tracks: results.tracks,
      users: results.users,
      playlists: results.playlists,
      wanted: results.wanted,
      suggestions: results.suggestions,
      community: results.community,
      gallery: results.gallery,
    });
  } catch (err) {
    return json({ error: String(err && err.message || err) }, 500);
  }
}
