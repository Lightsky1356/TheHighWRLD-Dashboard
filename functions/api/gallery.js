// Fan Art / Community Gallery API.
// Images are client-resized (max 1600px JPEG) and stored as D1 blobs with
// strict validation: allowlist MIME, magic bytes, 800KB raw cap, rate limit.
// Uploads require a linked Discord account and publish immediately - inserted
// 'approved', not 'pending'. Nothing waits on a human before it is visible.
// Owners can still reject a live item, and automod can still action a flag;
// the caption ruleset only records an advisory flag.
//
// GET  /api/gallery?page=&limit=        -> published items (no blobs)
// GET  /api/gallery?id=<id>             -> raw image bytes (cached)
// GET  /api/gallery?mine=1              -> own submissions (session)
// GET  /api/gallery?pending=1&code=...  -> moderation queue (owner; empty unless
//                                          something was seeded 'pending')
// POST /api/gallery { action, ... }     -> submit|delete|moderate
//
// Reporting an upload is NOT one of these actions. It goes through the shared
// report panel (/api/reports with target_type GALLERY), which is where every
// other surface files reports too. This endpoint used to accept its own
// `report` action; it wrote target_type 'gallery' in lower case while every
// staff-side filter matches the upper-case VALID_TYPES, and recorded no reporter
// identity at all, so the rows it produced were invisible in the moderation
// queue. Removed rather than left as a second, quieter way to file a report.

import { getSessionUser } from "../_lib/auth.js";
import { banRejection } from "../_lib/bans.js";
import { evaluateSurfaceRules, recordRuleFlags } from "../_lib/submissionRules.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const MAX_RAW = 819200; // 800KB
const PAGE_CAP = 24;

const MIME_OK = {
  "image/jpeg": [0xff, 0xd8, 0xff],
  "image/png": [0x89, 0x50, 0x4e, 0x47],
  "image/gif": [0x47, 0x49, 0x46, 0x38],
  "image/webp": null, // checked as RIFF....WEBP below
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

function magicOk(bytes, mime) {
  try {
    if (mime === "image/webp") {
      return bytes.length > 12 &&
        bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
        bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
    }
    const sig = MIME_OK[mime];
    if (!sig) return false;
    for (let i = 0; i < sig.length; i++) if (bytes[i] !== sig[i]) return false;
    return true;
  } catch (_) {
    return false;
  }
}

function b64ToBytes(b64) {
  const bin = atob(String(b64 || ""));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestGet(context) {
  try {
    const db = context.env.wanted_vault;
    const url = new URL(context.request.url);

    const id = Number(url.searchParams.get("id")) || 0;
    if (id > 0) {
      const secret = context.env.OWNER_PASSCODE || "";
      const asOwner = secret && url.searchParams.get("code") === secret;
      const row = await db.prepare(
        "SELECT data, mime FROM gallery_items WHERE id = ?" + (asOwner ? "" : " AND status = 'approved'")
      ).bind(id).first();
      if (!row || !row.data) return new Response("not found", { status: 404 });
      /* D1 hands a BLOB back as a plain Array of byte values, not as binary.
         Handing that array straight to `new Response()` stringifies it, so the
         client received "255,216,255,224,..." as a ~1.2MB text body served with
         Content-Type: image/jpeg. The status was 200 and the header looked
         right, so nothing upstream noticed - but the bytes were ASCII, and no
         browser can decode them. That is why uploaded art rendered as a broken
         image on every device while the listing, the caption and the author all
         looked perfectly fine.

         Normalised here rather than at the call site, and defensively across
         all three shapes, because which one arrives is a D1 detail rather than
         something the rest of this file should have to reason about. */
      const bytes = Array.isArray(row.data)
        ? new Uint8Array(row.data)
        : row.data instanceof ArrayBuffer
          ? new Uint8Array(row.data)
          : row.data instanceof Uint8Array
            ? row.data
            : new Uint8Array(row.data);
      return new Response(bytes, {
        status: 200,
        headers: {
          "Content-Type": row.mime || "image/jpeg",
          "Cache-Control": "public, max-age=31536000, immutable",
          ...CORS,
        },
      });
    }

    if (url.searchParams.get("mine") === "1") {
      const me = await getSessionUser(db, context.request);
      if (!me) return json({ ok: false, error: "not signed in" }, 401);
      const rows = await db.prepare(
        "SELECT id, user_name, avatar, title, caption, mime, size, status, created_at, spoiler " +
        "FROM gallery_items WHERE uid = ? ORDER BY id DESC LIMIT 50"
      ).bind(me.uid).all();
      return json({ ok: true, items: rows.results || [] });
    }

    /* Community snapshot - real counts from the approved gallery. */
    if (url.searchParams.get("community") === "1") {
      try {
        const pieces = await db.prepare("SELECT COUNT(*) AS n FROM gallery_items WHERE status = 'approved'").first();
        const artists = await db.prepare("SELECT COUNT(DISTINCT uid) AS n FROM gallery_items WHERE status = 'approved'").first();
        const newest = await db.prepare(
          "SELECT title, created_at FROM gallery_items WHERE status = 'approved' ORDER BY id DESC LIMIT 1"
        ).first();
        return json({
          ok: true,
          pieces: pieces ? pieces.n : 0,
          artists: artists ? artists.n : 0,
          newest: newest || null,
        });
      } catch (_) {
        return json({ ok: true, pieces: 0, artists: 0, newest: null });
      }
    }

    /* Comments on one artwork - the gallery's community chat. */
    const commentItem = Number(url.searchParams.get("comments") || 0) || 0;
    if (commentItem) {
      try {
        const rows = await db.prepare(
          "SELECT id, uid, author_name, author_avatar, body, created_at, deleted_at " +
          "FROM gallery_comments WHERE item_id = ? ORDER BY id ASC LIMIT 200"
        ).bind(commentItem).all();
        return json({ ok: true, comments: rows.results || [] });
      } catch (_) {
        return json({ ok: true, comments: [] });
      }
    }

    /* One item as JSON - the lightbox uses this instead of refetching pages. */
    const itemParam = Number(url.searchParams.get("item") || 0) || 0;
    if (itemParam) {
      const row = await db.prepare(
        "SELECT id, uid, user_name, avatar, title, caption, mime, size, created_at, spoiler " +
        "FROM gallery_items WHERE id = ? AND status = 'approved'"
      ).bind(itemParam).first();
      if (!row) return json({ ok: false, error: "not found" }, 404);
      return json({ ok: true, item: row });
    }

    if (url.searchParams.get("pending") === "1") {
      const secret = context.env.OWNER_PASSCODE || "";
      if (!secret || url.searchParams.get("code") !== secret) {
        return json({ ok: false, error: "forbidden" }, 403);
      }
      const rows = await db.prepare(
        "SELECT id, uid, user_name, avatar, title, caption, mime, size, status, created_at, spoiler " +
        "FROM gallery_items WHERE status = 'pending' ORDER BY id ASC LIMIT 50"
      ).all();
      return json({ ok: true, items: rows.results || [] });
    }

    const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
    const limit = Math.max(1, Math.min(PAGE_CAP, Number(url.searchParams.get("limit")) || 12));
    const rows = await db.prepare(
      "SELECT id, uid, user_name, avatar, title, caption, mime, size, created_at, spoiler " +
      "FROM gallery_items WHERE status = 'approved' ORDER BY id DESC LIMIT ? OFFSET ?"
    ).bind(limit, (page - 1) * limit).all();
    const total = await db.prepare(
      "SELECT COUNT(*) AS n FROM gallery_items WHERE status = 'approved'"
    ).first();
    return json({ ok: true, page, items: rows.results || [], total: total ? total.n : 0 });
  } catch (err) {
    return json({ ok: false, error: String((err && err.message) || err) }, 500);
  }
}

export async function onRequestPost(context) {
  try {
    const db = context.env.wanted_vault;
    const body = await context.request.json().catch(() => ({}));
    const action = String(body.action || "");

    if (action === "submit") {
      const me = await getSessionUser(db, context.request);
      if (!me) return json({ ok: false, error: "not signed in" }, 401);
      try {
        const rej = await banRejection(db, me.uid);
        if (rej) return rej.response;
      } catch (_) {}
      /* Uploading requires a LINKED Discord account, not just a session.
         Checked against the same discord_links row the Wanted Vault reads, so
         "linked" means the same thing here as it does everywhere else - that
         table is the only place that answer comes from.

         After the ban check on purpose: a banned user should be told they are
         banned, not sent off to link an account first.

         This is the enforcement. The client-side gate in gallery.js only avoids
         making someone pick and resize an image before being turned away, and it
         is trivially bypassed, so it cannot be the thing that actually holds the
         line. */
      try {
        const link = await db.prepare(
          "SELECT discord_id FROM discord_links WHERE site_uid = ?"
        ).bind(me.uid).first();
        if (!link || !link.discord_id) {
          return json({ ok: false, error: "link Discord to upload artwork" }, 403);
        }
      } catch (err) {
        return json({ ok: false, error: "could not verify your Discord link" }, 500);
      }
      const title = String(body.title || "").trim().slice(0, 80) || "Untitled";
      const caption = String(body.caption || "").trim().slice(0, 300);
      const mime = String(body.mime || "");
      /* Spoiler flag, stored as an integer to match the rest of the schema.
         Coerced rather than trusted: anything truthy the client sends becomes 1
         and everything else 0, so a stray string cannot end up in the column. */
      const spoiler = body.spoiler ? 1 : 0;
      if (!MIME_OK[mime] && mime !== "image/webp") {
        return json({ ok: false, error: "unsupported image type" }, 400);
      }
      let bytes;
      try {
        bytes = b64ToBytes(body.data);
      } catch (_) {
        return json({ ok: false, error: "bad image data" }, 400);
      }
      if (!bytes.length || bytes.length > MAX_RAW) {
        return json({ ok: false, error: "image too large (800KB max after resize)" }, 400);
      }
      if (!magicOk(bytes, mime)) {
        return json({ ok: false, error: "file is not a valid image" }, 400);
      }
      try {
        const recent = await db.prepare(
          "SELECT COUNT(*) AS n FROM gallery_items WHERE uid = ? AND created_at >= datetime('now', '-1 day')"
        ).bind(me.uid).first();
        if (recent && recent.n >= 10) return json({ ok: false, error: "daily limit reached" }, 429);
      } catch (_) {}
      const ins = await db.prepare(
        "INSERT INTO gallery_items (uid, user_name, avatar, title, caption, mime, size, data, status, spoiler) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'approved', ?)"
      ).bind(me.uid, (me.name || "Guest").slice(0, 40), (me.avatar || "").slice(0, 300),
        title, caption, mime, bytes.length, bytes.buffer, spoiler).run();
      const itemId = ins.meta && ins.meta.last_row_id ? Number(ins.meta.last_row_id) : 0;
      // Uploads publish immediately - 'approved' on insert, so the item is live
      // for everyone the moment it is stored rather than waiting on a human.
      //
      // This was the only surface out of the four that actually held posting
      // back. Community posts and replies have no status column at all, and
      // suggestions_v2 / wanted_posts default to 'new' / 'wanted' with their
      // public reads only filtering by status when a filter is explicitly asked
      // for - so all three were already publishing straight away. The caption
      // ruleset and automod only ever record a flag; neither can reject.
      //
      // The flag below is therefore advisory, and stays that way: it tells the
      // author what the automated pass noticed, and gives staff something to
      // act on, but it no longer decides whether anyone sees the upload. An
      // owner can still reject a live item, and automod can still action a flag.
      let ruleFlag = null;
      const violations = evaluateSurfaceRules("gallery", { title, caption });
      if (violations.length) {
        ruleFlag = await recordRuleFlags(db, { surface: "gallery", targetId: itemId, uid: me.uid, violations });
        if (ruleFlag) {
          try {
            await db.prepare(
              "INSERT INTO notifications (uid, type, message, href, post_id, data, actor) VALUES (?, 'moderation', ?, ?, ?, ?, 'Automated moderation')"
            ).bind(me.uid, "Your upload is live and was flagged for staff review (" + ruleFlag.codes.join(", ") + ")",
              "gallery:" + itemId, String(itemId), ruleFlag.severity).run();
          } catch (_) {}
        }
      }
      return json({ ok: true, id: itemId, flagged: ruleFlag });
    }

    if (action === "delete") {
      const me = await getSessionUser(db, context.request);
      if (!me) return json({ ok: false, error: "not signed in" }, 401);
      try {
        const rej = await banRejection(db, me.uid);
        if (rej) return rej.response;
      } catch (_) {}
      const id = Number(body.id) || 0;
      if (!id) return json({ ok: false, error: "missing id" }, 400);
      const row = await db.prepare("SELECT uid FROM gallery_items WHERE id = ?").bind(id).first();
      if (!row) return json({ ok: false, error: "not found" }, 404);
      const secret = context.env.OWNER_PASSCODE || "";
      const isOwner = secret && String(body.code || "") === secret;
      if (String(row.uid || "") !== String(me.uid) && !isOwner) {
        return json({ ok: false, error: "forbidden" }, 403);
      }
      await db.prepare("DELETE FROM gallery_items WHERE id = ?").bind(id).run();
      return json({ ok: true });
    }

    if (action === "commentCreate") {
      const me = await getSessionUser(db, context.request);
      if (!me) return json({ ok: false, error: "not signed in" }, 401);
      try {
        const rej = await banRejection(db, me.uid);
        if (rej) return rej.response;
      } catch (_) {}
      const itemId = Number(body.id) || 0;
      const text = String(body.body || "").trim().slice(0, 500);
      if (!itemId) return json({ ok: false, error: "missing id" }, 400);
      if (!text) return json({ ok: false, error: "a message is required" }, 400);
      const item = await db.prepare(
        "SELECT id FROM gallery_items WHERE id = ? AND status = 'approved'"
      ).bind(itemId).first();
      if (!item) return json({ ok: false, error: "not found" }, 404);
      try {
        const recent = await db.prepare(
          "SELECT COUNT(*) AS n FROM gallery_comments WHERE uid = ? AND created_at >= datetime('now','-10 minutes')"
        ).bind(me.uid).first();
        if (recent && Number(recent.n) >= 10) {
          return json({ ok: false, error: "slow down a little" }, 429);
        }
      } catch (_) {}
      var who = null;
      try {
        who = await db.prepare(
          "SELECT COALESCE(NULLIF(p.name,''),NULLIF(d.display_name,''),u.name,'Member') AS name, " +
          "COALESCE(NULLIF(p.avatar,''),NULLIF(d.avatar,''),u.avatar,'') AS avatar " +
          "FROM users u LEFT JOIN user_profiles p ON p.site_uid = u.uid " +
          "LEFT JOIN discord_links d ON d.site_uid = u.uid WHERE u.uid = ?"
        ).bind(me.uid).first();
      } catch (_) {}
      let ins;
      try {
        ins = await db.prepare(
          "INSERT INTO gallery_comments (item_id, uid, author_name, author_avatar, body) VALUES (?, ?, ?, ?, ?)"
        ).bind(itemId, me.uid, (who && who.name) || "Member", (who && who.avatar) || "", text).run();
      } catch (_) {
        return json({ ok: false, error: "comments are not ready yet" }, 503);
      }
      return json({ ok: true, id: ins.meta && ins.meta.last_row_id ? Number(ins.meta.last_row_id) : 0 });
    }

    if (action === "commentDelete") {
      const me = await getSessionUser(db, context.request);
      if (!me) return json({ ok: false, error: "not signed in" }, 401);
      const cid = Number(body.id) || 0;
      if (!cid) return json({ ok: false, error: "missing id" }, 400);
      const row = await db.prepare("SELECT uid FROM gallery_comments WHERE id = ?").bind(cid).first().catch(() => null);
      if (!row) return json({ ok: false, error: "not found" }, 404);
      const secret = context.env.OWNER_PASSCODE || "";
      const isOwner = secret && String(body.code || "") === secret;
      if (String(row.uid || "") !== String(me.uid) && !isOwner) {
        return json({ ok: false, error: "forbidden" }, 403);
      }
      await db.prepare(
        "UPDATE gallery_comments SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), body = '' WHERE id = ?"
      ).bind(cid).run().catch(() => null);
      return json({ ok: true });
    }

    if (action === "setSpoiler") {
      /* Only the member who uploaded the art (or the owner) can change its
         spoiler flag. Identity comes from the session, never the client. */
      const me = await getSessionUser(db, context.request);
      if (!me) return json({ ok: false, error: "not signed in" }, 401);
      const id = Number(body.id) || 0;
      if (!id) return json({ ok: false, error: "missing id" }, 400);
      const row = await db.prepare("SELECT uid FROM gallery_items WHERE id = ?").bind(id).first();
      if (!row) return json({ ok: false, error: "not found" }, 404);
      const secret = context.env.OWNER_PASSCODE || "";
      const isOwner = secret && String(body.code || "") === secret;
      if (String(row.uid || "") !== String(me.uid) && !isOwner) {
        return json({ ok: false, error: "forbidden" }, 403);
      }
      const spoiler = body.spoiler ? 1 : 0;
      await db.prepare("UPDATE gallery_items SET spoiler = ? WHERE id = ?").bind(spoiler, id).run();
      return json({ ok: true, spoiler });
    }

    if (action === "moderate") {
      const secret = context.env.OWNER_PASSCODE || "";
      if (!secret || String(body.code || "") !== secret) {
        return json({ ok: false, error: "forbidden" }, 403);
      }
      const id = Number(body.id) || 0;
      const status = String(body.status || "");
      if (!id || (status !== "approved" && status !== "rejected")) {
        return json({ ok: false, error: "bad id/status" }, 400);
      }
      if (status === "rejected") {
        await db.prepare("UPDATE gallery_items SET status = 'rejected', data = NULL WHERE id = ?").bind(id).run();
      } else {
        await db.prepare("UPDATE gallery_items SET status = 'approved' WHERE id = ?").bind(id).run();
      }
      return json({ ok: true });
    }

    return json({ ok: false, error: "unknown action" }, 400);
  } catch (err) {
    return json({ ok: false, error: String((err && err.message) || err) }, 500);
  }
}
