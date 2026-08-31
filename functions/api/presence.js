// Live online presence for TheHighWRLD Dashboard.
//
// The source of truth for "who is online right now" is the CommunityHub
// Durable Object (ephemeral WebSocket heartbeats). This endpoint proxies
// to it so the frontend can fetch the count / a user's live status on load,
// before any WebSocket events arrive. Durable "last seen" for authenticated
// users is read from D1 as a fallback for users currently offline.

import { getSessionUser } from "../_lib/auth.js";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function hubOf(env) {
  const ns = env && env.COMMUNITY_HUB;
  if (!ns) return null;
  try {
    return typeof ns.getByName === "function" ? ns.getByName("community") : ns.get(ns.idFromName("community"));
  } catch {
    try { return ns.get(ns.idFromName("community")); } catch { return null; }
  }
}

// Public-safe error if the binding is missing.
function noHub() {
  return json({ ok: false, error: "presence hub not bound" }, 503);
}

export async function onRequestGet(context) {
  const { env, request } = context;
  const url = new URL(request.url);
  const stub = hubOf(env);
  if (!stub) return noHub();

  const checkUid = url.searchParams.get("user") || "";

  // Single-user lookups are scoped to the session unless the requester asks
  // for a specific public profile uid (their own or a public profile view).
  let viewerUid = "";
  try {
    const db = env.wanted_vault;
    const session = db ? await getSessionUser(db, request) : null;
    if (session && session.uid) viewerUid = session.uid;
  } catch (_) {}

  try {
    if (checkUid) {
      const pres = await stub.fetch(new Request(stubUrl(url, "?user=" + encodeURIComponent(checkUid))));
      const p = await pres.json();
      let extra = {};
      if (env.wanted_vault) {
        try {
          const row = await env.wanted_vault.prepare(
            "SELECT display_name, avatar FROM discord_links WHERE site_uid = ?"
          ).bind(checkUid).first();
          extra.name = (row && row.display_name) || "";
          extra.avatar = (row && row.avatar) || "";
        } catch (_) {}
        if (!p.online) {
          try {
            const last = await env.wanted_vault.prepare(
              "SELECT status, last_seen FROM presence_state WHERE uid = ?"
            ).bind(checkUid).first();
            if (last) { extra.lastStatus = last.status; extra.lastSeen = last.last_seen; }
          } catch (_) {}
        }
      }
      return json({ ok: true, online: !!p.online, uid: checkUid, ...extra });
    }

    const pres = await stub.fetch(new Request(stubUrl(url)));
    const p = await pres.json();
    // Only expose the count + public display names (privacy: no IPs/tokens/emails).
    const users = (p.users || []).map((u) => ({ type: u.type, name: u.name || "" }));
    return json({ ok: true, online: p.online, users });
  } catch (err) {
    return json({ ok: false, error: String(err && err.message || err) }, 500);
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

function stubUrl(url, extra) {
  const base = "https://community-hub.internal/presence" + (extra || "");
  void url;
  return base;
}
