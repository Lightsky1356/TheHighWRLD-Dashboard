// WebSocket live connection proxy from the Pages site to the CommunityHub Durable Object.
// The DO performs the upgrade; this function forwards the authenticated identity.

import { getSessionUser } from "../_lib/auth.js";
import { hubStub } from "../_lib/realtime.js";

export async function onRequest(context) {
  const { request, env } = context;
  const upgrade = request.headers.get("Upgrade") || "";
  if (upgrade.toLowerCase() !== "websocket") {
    return new Response("Expected WebSocket", { status: 426, headers: { "Content-Type": "text/plain" } });
  }

  const stub = hubStub(env);
  if (!stub) {
    return new Response("Realtime hub is not bound", { status: 503, headers: { "Content-Type": "text/plain" } });
  }

  // Derive identity from the authenticated session cookie and forward it in the
  // WS query string so the hub knows who is typing / receiving notifications.
  const url = new URL(request.url);
  let uid = url.searchParams.get("uid") || "";
  let auth = url.searchParams.get("auth") === "1" ? 1 : 0;
  try {
    const db = env.wanted_vault;
    const session = db ? await getSessionUser(db, request) : null;
    if (session && session.uid) {
      uid = session.uid;
      auth = 1;
    }
  } catch (_) {}

  const pkey = url.searchParams.get("pkey") || "";

  const target = new URL(request.url);
  target.searchParams.set("uid", uid);
  target.searchParams.set("auth", auth ? "1" : "0");
  if (pkey) target.searchParams.set("pkey", pkey);
  const proxied = new Request(target.toString(), {
    method: request.method,
    headers: request.headers,
    body: request.method === "GET" ? undefined : request.body,
  });

  return stub.fetch(proxied);
}
