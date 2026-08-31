/**
 * TheHighWRLD Community Hub — standalone Worker hosting the realtime Durable Object.
 *
 * Responsibilities (all ephemeral except D1 writes):
 *  - Accept public WebSocket connections on /api/realtime (Pages proxy forwards the
 *    upgrade here).
 *  - Fan out reply/reaction/notification events to connected clients instantly.
 *  - Track in-memory typing state (NEVER written to D1) with an expiry alarm so a
 *    stuck "…is typing" can never persist.
 *  - Heartbeat + automatic close cleanup.
 *
 * Persistent data (posts, replies, reactions, notifications) is always read/written
 * through D1 by the Pages Functions (`functions/api/community/*`) — this Worker only
 * moves live events.
 */

import { DurableObject } from "cloudflare:workers";

const TYPING_TTL_MS = 3000;
const TYPING_ALARM_MS = 2000;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function safeSend(ws, payload) {
  try {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === 1)) {
      ws.send(typeof payload === "string" ? payload : JSON.stringify(payload));
    }
  } catch (err) {
    console.log(JSON.stringify({ level: "warn", msg: "ws send failed", error: String(err) }));
  }
}

function parseJson(raw) {
  try {
    return JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw));
  } catch {
    return null;
  }
}

const PRESENCE_TTL_MS = 45000;      // mark offline if no heartbeat within this window
const PRESENCE_ALARM_MS = 20000;    // how often we sweep for stale presence

export class CommunityHub extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.typing = new Map(); // uid -> { name, conversationId, until }
    this.presence = new Map(); // presenceKey -> { type:'auth'|'anon', name, lastSeen, sockets:Set }
    try {
      this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    } catch (err) {
      console.log(JSON.stringify({ level: "warn", msg: "autoResponse unavailable", error: String(err) }));
    }
  }

  // Called by the Pages Functions REST layer to push a live event to all sockets.
  async broadcast(event) {
    this.fanout(event);
    return { ok: true };
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (request.headers.get("Upgrade") === "websocket") {
      return this.acceptClient(request);
    }

    const path = url.pathname.replace(/\/+$/, "");
    if (request.method === "POST" && (path === "/broadcast" || path.endsWith("/broadcast"))) {
      const event = await request.json().catch(() => null);
      if (!event || typeof event !== "object") return json({ error: "invalid event" }, 400);
      this.fanout(event);
      return json({ ok: true });
    }
    if (request.method === "GET" && (path === "/health" || path.endsWith("/health"))) {
      return json({ ok: true, sockets: this.ctx.getWebSockets().length, typing: this.typing.size });
    }
    if (request.method === "GET" && (path === "/presence" || path.endsWith("/presence"))) {
      const checkUid = String(url.searchParams.get("user") || "").slice(0, 64);
      if (checkUid) {
        return json({ ok: true, uid: checkUid, online: this.presence.has("u:" + checkUid) });
      }
      return json({ ok: true, online: this.presenceOnlineCount(), users: this.presenceSnapshot() });
    }
    if (request.method === "POST" && (path === "/presence" || path.endsWith("/presence"))) {
      // Internal: invoked on auth presence transitions to persist durable state.
      const body = await request.json().catch(() => null);
      if (!body || typeof body !== "object") return json({ error: "invalid body" }, 400);
      await this.persistTransition(body.uid, body.status).catch(() => {});
      return json({ ok: true });
    }
    return json({ error: "not found" }, 404);
  }

  acceptClient(request) {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const url = new URL(request.url);
    const uid = String(url.searchParams.get("uid") || "").slice(0, 64);
    const auth = url.searchParams.get("auth") === "1";
    const pkey = String(url.searchParams.get("pkey") || "").slice(0, 96);
    const conversationId = String(url.searchParams.get("conversationId") || "community").slice(0, 200);
    this.ctx.acceptWebSocket(server, [uid || "anon"]);
    server.serializeAttachment({
      uid: uid || "",
      auth: auth ? 1 : 0,
      pkey: pkey || "",
      name: "",
      conversationId,
      connectedAt: Date.now(),
    });
    // A fresh connection is itself an active presence signal.
    if (this.registerPresence({ uid, auth, pkey }, server)) this.syncDurablePresence();
    safeSend(server, {
      type: "connected",
      ts: Date.now(),
      typing: this.typingSnapshot(conversationId),
      presence: { online: this.presenceOnlineCount(), users: this.presenceSnapshot() },
    });
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, message) {
    if (message === "ping") {
      safeSend(ws, "pong");
      return;
    }
    const msg = parseJson(message);
    if (!msg || typeof msg.type !== "string") return;

    const att = ws.deserializeAttachment() || {};
    const conversationId = String(msg.conversationId || att.conversationId || "community").slice(0, 200);

    if (msg.type === "hello") {
      const uid = String(msg.uid || att.uid || "").slice(0, 64);
      const auth = att.auth === 1 || msg.auth === true || msg.auth === 1;
      const pkey = String(msg.pkey || att.pkey || "").slice(0, 96) || uid;
      let name = "";
      if (uid && this.env.wanted_vault && auth) {
        try {
          const link = await this.env.wanted_vault
            .prepare("SELECT display_name, avatar FROM discord_links WHERE site_uid = ?")
            .bind(uid)
            .first();
          name = (link && link.display_name) || "";
        } catch (err) {
          console.log(JSON.stringify({ level: "warn", msg: "hello lookup failed", error: String(err) }));
        }
      }
      ws.serializeAttachment({ uid, auth: auth ? 1 : 0, pkey, name, conversationId, connectedAt: att.connectedAt || Date.now() });
      safeSend(ws, { type: "hello:ok", uid, name, typing: this.typingSnapshot(conversationId) });
      if (this.registerPresence({ uid, auth, pkey, name }, ws)) this.syncDurablePresence();
      return;
    }

    if (msg.type === "heartbeat" || msg.type === "presence:heartbeat") {
      // Refresh ephemeral liveness (NEVER writes to D1 here).
      this.touchPresence(att);
      safeSend(ws, { type: "heartbeat:ok", ts: Date.now() });
      return;
    }

    if (msg.type === "presence:leave") {
      this.unregisterPresence(att, ws);
      return;
    }

    if (msg.type === "typing:start" || msg.type === "typing_start") {
      const uid = att.uid || "";
      const name = att.name || "";
      if (!uid || !name) return;
      this.typing.set(uid, { name, conversationId, until: Date.now() + TYPING_TTL_MS });
      await this.ensureTypingAlarm();
      this.fanout(
        { type: "typing:start", conversationId, userId: uid, userName: name, typing: this.typingSnapshot(conversationId) },
        uid
      );
      return;
    }

    if (msg.type === "typing:stop" || msg.type === "typing_stop") {
      const uid = att.uid || "";
      const prev = this.typing.get(uid);
      this.typing.delete(uid);
      const cid = msg.conversationId || (prev && prev.conversationId) || att.conversationId || "community";
      this.fanout(
        { type: "typing:stop", conversationId: cid, userId: uid, userName: att.name || (prev && prev.name) || "", typing: this.typingSnapshot(cid) },
        uid
      );
      return;
    }
  }

  async webSocketClose(ws, code, reason) {
    const att = ws.deserializeAttachment() || {};
    if (att.uid && this.typing.has(att.uid)) {
      const prev = this.typing.get(att.uid);
      this.typing.delete(att.uid);
      const cid = (prev && prev.conversationId) || att.conversationId || "community";
      this.fanout({
        type: "typing:stop",
        conversationId: cid,
        userId: att.uid,
        userName: att.name || (prev && prev.name) || "",
        typing: this.typingSnapshot(cid),
      });
    }
    this.unregisterPresence(att, ws);
    try {
      ws.close(code, reason);
    } catch (_) {}
  }

  async webSocketError(ws) {
    const att = ws.deserializeAttachment() || {};
    this.unregisterPresence(att, ws);
    try {
      ws.close(1011, "WebSocket error");
    } catch (_) {}
  }

  async alarm() {
    const now = Date.now();
    const expiredTyping = [];
    for (const [uid, info] of this.typing) {
      if (info.until <= now) expiredTyping.push([uid, info]);
    }
    for (const [uid, info] of expiredTyping) {
      this.typing.delete(uid);
      this.fanout({
        type: "typing:stop",
        conversationId: info.conversationId,
        userId: uid,
        userName: info.name,
        typing: this.typingSnapshot(info.conversationId),
      });
    }
    const stalePresence = [];
    for (const [key, info] of this.presence) {
      if (now - info.lastSeen > PRESENCE_TTL_MS) stalePresence.push(key);
    }
    for (const key of stalePresence) {
      this.presence.delete(key);
      this.onPresenceChanged();
    }
    const needsAlarm = this.typing.size > 0 || this.presence.size > 0;
    if (needsAlarm) {
      await this.ctx.storage.setAlarm(Date.now() + TYPING_ALARM_MS);
    }
  }

  async ensureTypingAlarm() {
    try {
      const existing = await this.ctx.storage.getAlarm();
      if (existing == null) await this.ctx.storage.setAlarm(Date.now() + TYPING_ALARM_MS);
    } catch (_) {}
  }

  typingSnapshot(conversationId) {
    const now = Date.now();
    const out = [];
    for (const [uid, info] of this.typing) {
      if (info.until <= now) continue;
      if (conversationId && info.conversationId !== conversationId) continue;
      out.push({ userId: uid, userName: info.name, conversationId: info.conversationId });
    }
    return out;
  }

  // ------------------------------------------------------------------
  // Online presence (ephemeral, in-memory; never a per-heartbeat D1 write)
  // ------------------------------------------------------------------

  presenceKeyFor(uid, auth, pkey) {
    if (auth && uid) return "u:" + uid;
    return "g:" + (pkey || uid || "anon");
  }

  /** Register a presence entry (idempotent per socket). Returns true if newly online. */
  registerPresence({ uid, auth, pkey, name }, ws) {
    const key = this.presenceKeyFor(uid, auth, pkey);
    let entry = this.presence.get(key);
    const wasOnline = !!entry;
    const now = Date.now();
    if (!entry) {
      entry = { type: auth ? "auth" : "anon", name: name || "", lastSeen: now, sockets: new Set() };
      this.presence.set(key, entry);
    }
    entry.lastSeen = Math.max(entry.lastSeen || 0, now);
    if (name && name !== entry.name) {
      entry.name = name;
      this.onPresenceChanged(); // name became known → republish snapshot
    }
    if (ws) entry.sockets.add(ws);
    if (!wasOnline) this.onPresenceChanged();
    return !wasOnline;
  }

  touchPresence(att) {
    const key = this.presenceKeyFor(att.uid, att.auth === 1, att.pkey);
    const entry = this.presence.get(key);
    if (entry) {
      entry.lastSeen = Date.now();
      return;
    }
    // A heartbeat for a key we don't have yet (e.g. hello was skipped) — register anonymously.
    this.registerPresence({ uid: att.uid, auth: att.auth === 1, pkey: att.pkey, name: att.name || "" }, null);
  }

  unregisterPresence(att, ws) {
    if (!att) return;
    const key = this.presenceKeyFor(att.uid, att.auth === 1, att.pkey);
    const entry = this.presence.get(key);
    if (!entry) return;
    if (ws && entry.sockets) entry.sockets.delete(ws);
    if (!entry.sockets || entry.sockets.size === 0) {
      this.presence.delete(key);
      this.onPresenceChanged();
    }
  }

  presenceOnlineCount() {
    return this.presence.size;
  }

  presenceSnapshot() {
    const now = Date.now();
    const out = [];
    for (const [key, info] of this.presence) {
      if (now - info.lastSeen > PRESENCE_TTL_MS) continue;
      out.push({ id: key, type: info.type, name: info.name || "", lastSeen: info.lastSeen });
    }
    return out;
  }

  onPresenceChanged() {
    this.fanout({ type: "presence:update", presence: { online: this.presenceOnlineCount(), users: this.presenceSnapshot() } });
    this.ensureAlarm();
  }

  /** Durable "last seen" only on auth transitions — never per heartbeat. */
  async syncDurablePresence() {
    if (!this.env.wanted_vault) return;
    try {
      for (const [key, info] of this.presence) {
        if (key.startsWith("u:")) {
          await this.env.wanted_vault
            .prepare("INSERT INTO presence_state (uid, status, last_seen, updated_at) VALUES (?, 'online', ?, ?) ON CONFLICT(uid) DO UPDATE SET status='online', last_seen=excluded.last_seen, updated_at=excluded.updated_at")
            .bind(key.slice(2), new Date(info.lastSeen).toISOString(), new Date().toISOString()).run();
        }
      }
    } catch (err) {
      // presence_state may not exist yet on old DBs — ignore, presence is still live.
      console.log(JSON.stringify({ level: "warn", msg: "presence persist failed", error: String(err && err.message || err) }));
    }
  }

  async persistTransition(uid, status) {
    if (!uid || !this.env.wanted_vault) return;
    try {
      await this.env.wanted_vault
        .prepare("INSERT INTO presence_state (uid, status, last_seen, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(uid) DO UPDATE SET status=excluded.status, last_seen=excluded.last_seen, updated_at=excluded.updated_at")
        .bind(String(uid).slice(0, 64), status === "online" ? "online" : "offline", new Date().toISOString(), new Date().toISOString()).run();
    } catch (err) {
      console.log(JSON.stringify({ level: "warn", msg: "presence transition failed", error: String(err && err.message || err) }));
    }
  }

  async ensureAlarm() {
    try {
      const existing = await this.ctx.storage.getAlarm();
      if (existing == null) await this.ctx.storage.setAlarm(Date.now() + TYPING_ALARM_MS);
    } catch (_) {}
  }

  fanout(event, exceptUid) {
    const payload = JSON.stringify(event);
    const sockets = this.ctx.getWebSockets();
    for (const ws of sockets) {
      const att = ws.deserializeAttachment() || {};
      // Never echo a user's own typing back to them.
      if (exceptUid && att.uid === exceptUid && String(event.type || "").startsWith("typing:")) continue;
      // Notifications are recipient-scoped.
      if (event.type === "notification:created" && event.recipientUid && att.uid !== event.recipientUid) continue;
      safeSend(ws, payload);
    }
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const stub = getHub(env);

    if (url.pathname === "/api/realtime" || url.pathname === "/websocket") {
      return stub.fetch(request);
    }
    if (url.pathname === "/broadcast" && request.method === "POST") {
      return stub.fetch(request);
    }
    if (url.pathname === "/presence") {
      return stub.fetch(request);
    }
    if (url.pathname === "/health") {
      return json({ ok: true, service: "thehighwrld-community-hub" });
    }
    return json({ error: "not found" }, 404);
  },
};

function getHub(env) {
  const ns = env.COMMUNITY_HUB;
  if (!ns) return null;
  try {
    return typeof ns.getByName === "function" ? ns.getByName("community") : ns.get(ns.idFromName("community"));
  } catch {
    return ns.get(ns.idFromName("community"));
  }
}
