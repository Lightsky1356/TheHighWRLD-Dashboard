// WebSocket live connection proxy from the Pages site to the CommunityHub Durable Object.
// The DO performs the upgrade; this function forwards the authenticated identity.

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

  const target = new URL(request.url);
  // The hub validates the session cookie itself; client uid/auth query
  // parameters must not grant an authenticated identity.
  target.searchParams.delete("uid");
  target.searchParams.delete("auth");
  const proxied = new Request(target.toString(), {
    method: request.method,
    headers: request.headers,
    body: request.method === "GET" ? undefined : request.body,
  });

  return stub.fetch(proxied);
}
