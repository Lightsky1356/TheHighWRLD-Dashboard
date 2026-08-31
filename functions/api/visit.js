const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function clamp(v, n) {
  return String(v || "").replace(/[^\x20-\x7E]/g, "").slice(0, n);
}

export async function onRequestPost(context) {
  try {
    const body = await context.request.json().catch(() => ({}));
    const env = context.env;
    const uid = clamp(body.uid, 40) || "anon";
    const page = clamp(body.page, 40);
    const ua = clamp(body.ua, 300);
    const ip = context.request.headers.get("CF-Connecting-IP") || "";
    const country = context.request.headers.get("CF-IPCountry") || "";
    await env.wanted_vault.prepare(
      "INSERT INTO analytics_visits (uid, page, ua, ip, country, ts) VALUES (?, ?, ?, ?, ?, ?)"
    ).bind(uid, page, ua, ip, country, new Date().toISOString()).run();
    return json({ ok: true });
  } catch (err) {
    return json({ error: String(err && err.message || err) }, 500);
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
