// Site announcements. GET is public (latest 5). POST is owner-gated via
// OWNER_PASSCODE (same secret as /api/stats?code= and drops).

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestGet(context) {
  try {
    const url = new URL(context.request.url);
    // The owner's manage list needs every announcement, not just the newest five,
    // so they can correct something they posted a while ago. Gated on the same
    // OWNER_PASSCODE as posting, because this list exposes the full history.
    const manage = url.searchParams.get("manage") === "1";
    if (manage) {
      const secret = context.env.OWNER_PASSCODE || "";
      const given = url.searchParams.get("code") || "";
      if (!secret || given !== secret) {
        return json({ ok: false, error: "forbidden" }, 403);
      }
    }
    const rows = await context.env.wanted_vault.prepare(
      "SELECT id, title, message, created_at, rev FROM announcements ORDER BY id DESC" +
        (manage ? "" : " LIMIT 5")
    ).all();
    return json({
      ok: true,
      announcements: (rows.results || []).map((r) => ({
        id: "a" + r.id,
        type: "announcement",
        actor: "Staff",
        // Three message-ish fields, deliberately. `message` is the composed form
        // the notification bell renders: one line, so the title has to be folded
        // in. announcement-banner.js shows the title as its own heading and the
        // body under it, and needs them apart - using `message` there printed the
        // title twice. `body` is the stored text on its own so neither consumer
        // has to reconstruct the other by stripping a prefix.
        message: (r.title ? r.title + " — " : "") + (r.message || ""),
        title: r.title || "",
        body: r.message || "",
        // What the banner remembers as "already seen". Keyed on the revision as
        // well as the id, so an edit the owner marked as worth re-noticing comes
        // back for people who dismissed the earlier version. Kept separate from
        // `id`, which the bell uses for its own de-duplication and must not
        // change shape.
        seenKey: "a" + r.id + "r" + (Number(r.rev) || 1),
        rev: Number(r.rev) || 1,
        post_id: null,
        reply_id: null,
        read: true,
        ts: r.created_at || "",
      })),
    });
  } catch (err) {
    return json({ ok: false, error: String((err && err.message) || err) }, 500);
  }
}

export async function onRequestPost(context) {
  try {
    const secret = context.env.OWNER_PASSCODE || "";
    const body = await context.request.json().catch(() => ({}));
    if (!secret || String(body.code || "") !== secret) {
      return json({ ok: false, error: "forbidden" }, 403);
    }
    const title = String(body.title || "").trim().slice(0, 120);
    const message = String(body.message || "").trim().slice(0, 500);
    if (!message) return json({ ok: false, error: "message required" }, 400);
    const ins = await context.env.wanted_vault.prepare(
      "INSERT INTO announcements (title, message) VALUES (?, ?)"
    ).bind(title, message).run();
    return json({ ok: true, id: ins.meta && ins.meta.last_row_id ? Number(ins.meta.last_row_id) : 0 });
  } catch (err) {
    return json({ ok: false, error: String((err && err.message) || err) }, 500);
  }
}

/* Ids reach here as the string form the API hands out ("a7"), so they are parsed
   back to an integer before touching SQL. Rejecting anything non-numeric is the
   point: bound straight into a statement it would be an injection route, and
   Number("a7") is NaN rather than a sneaky default, so the check cannot pass by
   accident. */
function parseId(raw) {
  const m = String(raw == null ? "" : raw).match(/^a(\d+)$/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

function ownerOf(context, body) {
  const secret = context.env.OWNER_PASSCODE || "";
  return !!secret && String((body && body.code) || "") === secret;
}

/* Correct an announcement that has already gone out.
 *
 * The id and created_at are left alone, so a correction keeps its original
 * position in the listing rather than jumping to the top and reading as a brand
 * new notice.
 *
 * `notify` is the owner's explicit choice about who should see the change. With
 * it, `rev` is bumped and the banner's "already seen" key changes, so everyone
 * who dismissed the earlier version gets it again. Without it, `rev` is left
 * where it is and the edit stays quiet for anyone who has already read it - which
 * is what you want for a typo fix, and not what you want when the announcement
 * itself was wrong. Only the owner knows which it is, so both are offered rather
 * than one guessed at. */
export async function onRequestPut(context) {
  try {
    const body = await context.request.json().catch(() => ({}));
    if (!ownerOf(context, body)) return json({ ok: false, error: "forbidden" }, 403);

    const id = parseId(body.id);
    if (id === null) return json({ ok: false, error: "bad id" }, 400);

    const title = String(body.title || "").trim().slice(0, 120);
    const message = String(body.message || "").trim().slice(0, 500);
    if (!message) return json({ ok: false, error: "message required" }, 400);

    const notify = body.notify === true || body.notify === "1" || body.notify === 1;
    const res = await context.env.wanted_vault
      .prepare(
        notify
          ? "UPDATE announcements SET title = ?, message = ?, rev = rev + 1 WHERE id = ?"
          : "UPDATE announcements SET title = ?, message = ? WHERE id = ?"
      )
      .bind(title, message, id)
      .run();

    const changed = res && res.meta && typeof res.meta.changes === "number" ? res.meta.changes : 0;
    if (!changed) return json({ ok: false, error: "not found" }, 404);
    return json({ ok: true, id, notified: notify });
  } catch (err) {
    return json({ ok: false, error: String((err && err.message) || err) }, 500);
  }
}

/* Remove an announcement outright. Separate from editing because the two are not
   equivalent: an edit can be quiet, but a delete takes the notice off the site
   entirely, so it is its own action with its own button rather than something
   reached by clearing the fields. */
export async function onRequestDelete(context) {
  try {
    const body = await context.request.json().catch(() => ({}));
    if (!ownerOf(context, body)) return json({ ok: false, error: "forbidden" }, 403);

    const id = parseId(body.id);
    if (id === null) return json({ ok: false, error: "bad id" }, 400);

    const res = await context.env.wanted_vault
      .prepare("DELETE FROM announcements WHERE id = ?")
      .bind(id)
      .run();
    const changed = res && res.meta && typeof res.meta.changes === "number" ? res.meta.changes : 0;
    if (!changed) return json({ ok: false, error: "not found" }, 404);
    return json({ ok: true, id });
  } catch (err) {
    return json({ ok: false, error: String((err && err.message) || err) }, 500);
  }
}
