// Realtime helpers shared by Pages Functions.

// Resolve the CommunityHub Durable Object stub from the binding.
export function hubStub(env) {
  const ns = env && env.COMMUNITY_HUB;
  if (!ns) return null;
  try {
    if (typeof ns.getByName === "function") return ns.getByName("community");
    return ns.get(ns.idFromName("community"));
  } catch (err) {
    try {
      return ns.get(ns.idFromName("community"));
    } catch (_) {
      return null;
    }
  }
}

// Fan a live event out to every connected WebSocket via the hub.
export async function hubBroadcast(env, event) {
  const stub = hubStub(env);
  if (!stub || !event) return;
  try {
    if (typeof stub.broadcast === "function") {
      await stub.broadcast(event);
      return;
    }
    await stub.fetch(
      new Request("https://community-hub.internal/broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(event),
      })
    );
  } catch (err) {
    console.log(JSON.stringify({ level: "warn", msg: "hubBroadcast failed", error: String(err && err.message ? err.message : err) }));
  }
}

export function uidOk(uid) {
  return /^[A-Za-z0-9_-]{4,64}$/.test(String(uid || ""));
}

// Resolve site uid from authenticated session first; legacy `?user=` fallback
// is only used for the wanted-vault endpoints that predate sessions.
export async function resolveSiteUid(db, request, bodyUser) {
  try {
    const { getSessionUser } = await import("./auth.js");
    const session = await getSessionUser(db, request);
    if (session && session.uid && uidOk(session.uid)) return session.uid;
  } catch (_) {}
  const fromBody = String(bodyUser || "").slice(0, 64);
  if (uidOk(fromBody)) {
    const link = await db.prepare("SELECT site_uid FROM discord_links WHERE site_uid = ?").bind(fromBody).first();
    if (link) return fromBody;
    return fromBody;
  }
  return "";
}
