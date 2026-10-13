// Contests & drops API.
// GET  /api/drops -> { ok, live[], upcoming[], past[] } (public).
// POST /api/drops { code, title, description, track_title, starts_at, ends_at }
//   -> owner-gated via OWNER_PASSCODE (same secret as /api/stats?code=).

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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

function splitRows(rows) {
  const now = new Date().toISOString();
  const live = [], upcoming = [], past = [];
  for (const r of rows) {
    const d = {
      id: r.id,
      title: r.title || "",
      description: r.description || "",
      track_title: r.track_title || "",
      starts_at: r.starts_at || "",
      ends_at: r.ends_at || "",
      created_at: r.created_at || "",
    };
    if (d.starts_at && d.starts_at > now) upcoming.push(d);
    else if (d.ends_at && d.ends_at < now) past.push(d);
    else live.push(d);
  }
  upcoming.sort((a, b) => String(a.starts_at).localeCompare(String(b.starts_at)));
  return { live, upcoming, past: past.slice(0, 5) };
}

export async function onRequestGet(context) {
  try {
    const db = context.env.wanted_vault;
    const rows = await db.prepare(
      "SELECT * FROM drops ORDER BY starts_at DESC LIMIT 25"
    ).all();
    const list = rows.results || [];
    let counts = {}, mine = {};
    try {
      const ids = list.map((r) => r.id);
      if (ids.length) {
        const ph = ids.map(() => "?").join(",");
        const c = await db.prepare(
          "SELECT drop_id, COUNT(*) AS n FROM event_rsvps WHERE drop_id IN (" + ph + ") GROUP BY drop_id"
        ).bind(...ids).all();
        for (const r of (c.results || [])) counts[r.drop_id] = r.n || 0;
      }
    } catch (_) {}
    try {
      const { getSessionUser } = await import("../_lib/auth.js");
      const me = await getSessionUser(db, context.request);
      if (me && me.uid && list.length) {
        const ids = list.map((r) => r.id);
        const ph = ids.map(() => "?").join(",");
        const m = await db.prepare(
          "SELECT drop_id FROM event_rsvps WHERE uid = ? AND drop_id IN (" + ph + ")"
        ).bind(me.uid, ...ids).all();
        for (const r of (m.results || [])) mine[r.drop_id] = true;
      }
    } catch (_) {}
    const split = splitRows(list);
    // Drop-live reminders: piggybacked on normal traffic (no cron worker).
    // When a drop went live within the last 6h and hasn't been announced,
    // notify all RSVP'd users once, then set the flag. Best-effort only.
    try {
      const now = Date.now();
      const fresh = split.live.filter((d) => {
        if (d.notified_live) return false;
        if (!d.starts_at) return false;
        const t = new Date(String(d.starts_at).replace(" ", "T") + "Z").getTime();
        return !isNaN(t) && t <= now && now - t < 6 * 3600 * 1000;
      });
      for (const d of fresh) {
        const rsvps = await db.prepare(
          "SELECT uid FROM event_rsvps WHERE drop_id = ? LIMIT 500"
        ).bind(d.id).all().catch(() => ({ results: [] }));
        const { createNotification } = await import("../_lib/notifications.js");
        for (const r of (rsvps.results || [])) {
          if (!r.uid) continue;
          try {
            const msg = '"' + String(d.title || "A drop").slice(0, 60) + '" is live now';
            await createNotification(db, context.env, r.uid, {
              type: "drop",
              actorName: "Staff",
              message: msg,
            });
          } catch (_) {}
        }
        await db.prepare("UPDATE drops SET notified_live = 1 WHERE id = ?").bind(d.id).run().catch(() => {});
      }
    } catch (_) {}
    const withRsvp = (arr) => arr.map((d) => ({
      ...d,
      rsvp_count: counts[d.id] || 0,
      rsvped: !!mine[d.id],
    }));
    return json({
      ok: true,
      live: withRsvp(split.live),
      upcoming: withRsvp(split.upcoming),
      past: withRsvp(split.past),
    });
  } catch (err) {
    return json({ ok: false, error: String((err && err.message) || err) }, 500);
  }
}

export async function onRequestPost(context) {
  try {
    const body = await context.request.json().catch(() => ({}));
    // RSVP actions are session-authed (any signed-in user).
    if (body.action === "rsvp" || body.action === "unrsvp") {
      const { getSessionUser } = await import("../_lib/auth.js");
      const { banRejection } = await import("../_lib/bans.js");
      const db = context.env.wanted_vault;
      const me = await getSessionUser(db, context.request);
      if (!me) return json({ ok: false, error: "not signed in" }, 401);
      try {
        const rej = await banRejection(db, me.uid);
        if (rej) return rej.response;
      } catch (_) {}
      const id = Number(body.id) || 0;
      if (!id) return json({ ok: false, error: "missing id" }, 400);
      if (body.action === "rsvp") {
        await db.prepare(
          "INSERT OR IGNORE INTO event_rsvps (drop_id, uid) VALUES (?, ?)"
        ).bind(id, me.uid).run();
      } else {
        await db.prepare(
          "DELETE FROM event_rsvps WHERE drop_id = ? AND uid = ?"
        ).bind(id, me.uid).run();
      }
      const c = await db.prepare(
        "SELECT COUNT(*) AS n FROM event_rsvps WHERE drop_id = ?"
      ).bind(id).first();
      return json({ ok: true, rsvp_count: c ? c.n : 0, rsvped: body.action === "rsvp" });
    }
    const secret = context.env.OWNER_PASSCODE || "";
    if (!secret || String(body.code || "") !== secret) {
      return json({ ok: false, error: "forbidden" }, 403);
    }
    const title = String(body.title || "").trim().slice(0, 120);
    const description = String(body.description || "").trim().slice(0, 500);
    const trackTitle = String(body.track_title || "").trim().slice(0, 140);
    const startsAt = String(body.starts_at || "").trim().slice(0, 30);
    const endsAt = String(body.ends_at || "").trim().slice(0, 30);
    if (!title || !startsAt) return json({ ok: false, error: "title + starts_at required" }, 400);

    const ins = await context.env.wanted_vault.prepare(
      "INSERT INTO drops (title, description, track_title, starts_at, ends_at) VALUES (?, ?, ?, ?, ?)"
    ).bind(title, description, trackTitle, startsAt, endsAt).run();
    return json({ ok: true, id: ins.meta && ins.meta.last_row_id ? Number(ins.meta.last_row_id) : 0 });
  } catch (err) {
    return json({ ok: false, error: String((err && err.message) || err) }, 500);
  }
}
