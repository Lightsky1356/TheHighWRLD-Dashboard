// Site announcements. GET is public (latest 5). POST is owner-gated via
// OWNER_PASSCODE (same secret as /api/stats?code= and drops).

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

export async function onRequestGet(context) {
  try {
    const rows = await context.env.wanted_vault.prepare(
      "SELECT id, title, message, created_at FROM announcements ORDER BY id DESC LIMIT 5"
    ).all();
    return json({
      ok: true,
      announcements: (rows.results || []).map((r) => ({
        id: "a" + r.id,
        type: "announcement",
        actor: "Staff",
        message: (r.title ? r.title + " — " : "") + (r.message || ""),
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
