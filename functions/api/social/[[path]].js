import { getSessionUser } from "../../_lib/auth.js";
import { hubBroadcast, hubStub } from "../../_lib/realtime.js";
import { banRejection } from "../../_lib/bans.js";
/* The push is sent by _lib/notifications.js now, along with the row and the
   preference check, so that every notification type is delivered the same way
   and none of them can be delivered twice. */
import { createNotification } from "../../_lib/notifications.js";
import { rateLimit } from "../../_lib/rate-limit.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};
/* The reactions a message can carry.
 *
 * It used to be six, and the panel only ever offered three of them - so
 * the other three could not be given without going round the API. The
 * list is the whole set now, and the panel offers all of it.
 *
 * A reaction is a fixed set rather than free text, because it goes into
 * a column and it is drawn as a button. Anything else would be a
 * different kind of thing. */
const EMOJIS = ["❤️", "🔥", "😂", "😮", "👏", "💯", "👍", "👎", "🎉", "😢", "🤔", "🙏"];
const MAX_MESSAGE = 2000;
/* A group is a group rather than a broadcast list, so it stays small enough
   for the thread to be readable and for one send to reach everybody. */
const MAX_GROUP = 10;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

function partsOf(request) {
  return new URL(request.url).pathname.replace(/^\/api\/social\/?/, "").split("/").filter(Boolean);
}

function canonicalPair(a, b) {
  return a < b ? [a, b] : [b, a];
}

function uidOk(uid) {
  return /^[A-Za-z0-9_-]{4,64}$/.test(String(uid || ""));
}

async function actorFor(context) {
  const db = context.env.wanted_vault;
  const user = await getSessionUser(db, context.request);
  return user && uidOk(user.uid) ? user : null;
}

async function profile(db, uid) {
  return db.prepare(
    "SELECT u.uid, COALESCE(NULLIF(p.name,''), NULLIF(d.display_name,''), u.name, 'Member') AS name, " +
    "COALESCE(NULLIF(p.avatar,''), NULLIF(d.avatar,''), u.avatar, '') AS avatar " +
    "FROM users u LEFT JOIN user_profiles p ON p.site_uid = u.uid " +
    "LEFT JOIN discord_links d ON d.site_uid = u.uid WHERE u.uid = ?"
  ).bind(uid).first();
}

async function isBlocked(db, a, b) {
  const row = await db.prepare(
    "SELECT 1 FROM user_blocks WHERE (blocker_user_id = ? AND blocked_user_id = ?) " +
    "OR (blocker_user_id = ? AND blocked_user_id = ?) LIMIT 1"
  ).bind(a, b, b, a).first();
  return !!row;
}

async function areFriends(db, a, b) {
  const [x, y] = canonicalPair(a, b);
  return !!(await db.prepare(
    "SELECT 1 FROM social_friends WHERE uid_a = ? AND uid_b = ?"
  ).bind(x, y).first());
}

async function privacy(db, uid) {
  return (await db.prepare(
    "SELECT friend_requests, direct_messages, online_status, activity_status, " +
    "activity_listening, activity_playlists, activity_community " +
    "FROM user_social_settings WHERE uid = ?"
  ).bind(uid).first()) || {
    friend_requests: "everyone",
    direct_messages: "friends",
    online_status: "friends",
    activity_status: "friends",
    /* The three sharing settings for the friend activity feed. Off until
       the person says otherwise. */
    activity_listening: "nobody",
    activity_playlists: "nobody",
    activity_community: "nobody",
  };
}

/* Where a notification click should land. Only internal app routes are ever
   produced, and the client validates them again before navigating, so a push
   payload can never become an open redirect. */
const PUSH_URL_BY_TYPE = {
  dm_message: "social:conversation",
  friend_request: "social:requests",
  friend_accepted: "social:friends",
};

async function notify(db, env, recipientUid, actor, type, message, ctx) {
  /* The preference check, the INSERT and the device push all live in
     _lib/notifications.js now, so the social API and the other twelve writers
     cannot drift apart.

     This function used to send its own push here, after the shared helper had
     created the row. That is now a duplicate: the shared helper sends the push
     for every notification, so leaving this one in place would have delivered
     every direct message and friend request TWICE - two lock-screen
     notifications for one message.

     What this function keeps is the wording. The social API has always sent a
     summary naming the sender, and the shared helper's default is a generic
     "you have a new notification", so the summary is passed through as an
     override rather than being silently downgraded. */
  const created = await createNotification(db, env, recipientUid, {
    type,
    actorUid: actor.uid,
    actorName: actor.name || "Member",
    message,
    private: true,
    pushTitle: "TheHighWRLD",
    pushBody: message,
    /* One tag per message, so two DMs are two notifications rather than one
       replacing the other. Supplied as a function because the new row's id is
       only known once the insert has happened. */
    pushTag: function (id) { return "thw-" + type + "-" + id; },
    pushUrl: PUSH_URL_BY_TYPE[type] || null,
  }, ctx);
  if (!created) return;
}

async function notifyBestEffort(db, env, recipientUid, actor, type, message, ctx) {
  try {
    await notify(db, env, recipientUid, actor, type, message, ctx);
  } catch (err) {
    console.error("Social notification could not be created:", err);
  }
}

async function signalRefresh(env, recipientUid) {
  await hubBroadcast(env, {
    type: "social:refresh",
    private: true,
    recipientUid,
  });
}


/* The conversation, and whether this person is in it.
 *
 * Group conversations are answered by the members table alone. The pair of
 * columns on dm_conversations belongs to the one-to-one shape and means
 * nothing for a group, so nothing here reads them. */
async function conversationOf(db, conversationId, uid) {
  const row = await db.prepare(
    "SELECT c.id, c.kind, c.title, " +
    "(SELECT COUNT(*) FROM dm_conversation_members m WHERE m.conversation_id = c.id) AS member_count, " +
    "EXISTS(SELECT 1 FROM dm_conversation_members m WHERE m.conversation_id = c.id AND m.uid = ?) AS mine " +
    "FROM dm_conversations c WHERE c.id = ?"
  ).bind(uid, conversationId).first();
  if (!row || !Number(row.mine)) return null;
  return {
    id: row.id,
    kind: row.kind === "group" ? "group" : "dm",
    title: String(row.title || ""),
    memberCount: Number(row.member_count) || 0,
  };
}

/* Everyone else in the conversation. For a one-to-one this is one person; for
   a group it is the rest of it. */
async function memberUids(db, conversationId, uid) {
  const rows = await db.prepare(
    "SELECT uid FROM dm_conversation_members WHERE conversation_id = ? AND uid <> ? ORDER BY joined_at, uid LIMIT 50"
  ).bind(conversationId, uid).all();
  return (rows.results || []).map((r) => r.uid);
}

/* The names of a set of people, in one query. A group thread has to say which
   of the people in it wrote each line, so every sender's name is here. */
async function namesFor(db, uids) {
  const list = (uids || []).filter(uidOk).slice(0, 100);
  if (!list.length) return {};
  const q = list.map(() => "?").join(",");
  const rows = await db.prepare(
    "SELECT u.uid, COALESCE(NULLIF(p.name,''), NULLIF(d.display_name,''), u.name, 'Member') AS name " +
    "FROM users u LEFT JOIN user_profiles p ON p.site_uid = u.uid LEFT JOIN discord_links d ON d.site_uid = u.uid " +
    "WHERE u.uid IN (" + q + ")"
  ).bind(...list).all();
  const map = {};
  for (const row of rows.results || []) map[row.uid] = row.name;
  return map;
}

/* An event for everybody but me in a conversation. The Durable Object routes
   it to each name in recipientUids, so a group is one broadcast rather than
   one per person. */
async function fanoutToOthers(env, others, event) {
  if (!others.length) return;
  await hubBroadcast(env, Object.assign({}, event, { private: true, recipientUids: others }));
}

async function canMessage(db, senderUid, recipientUid) {
  if (!recipientUid || recipientUid === senderUid || await isBlocked(db, senderUid, recipientUid)) return false;
  const settings = await privacy(db, recipientUid);
  if (settings.direct_messages === "nobody") return false;
  return settings.direct_messages === "everyone" || await areFriends(db, senderUid, recipientUid);
}

async function getPresence(env, viewerUid, uids) {
  if (!uids.length) return { available: true, online: [] };
  const stub = hubStub(env);
  if (!stub) return { available: false, online: [] };
  if (typeof stub.socialPresence !== "function") return { available: false, online: [] };
  try {
    const result = await stub.socialPresence(viewerUid, uids.slice(0, 100));
    return { available: true, online: Array.isArray(result.online) ? result.online : [] };
  } catch (err) {
    console.error("Friend presence lookup failed:", err);
    return { available: false, online: [] };
  }
}

async function bootstrap(db, env, me) {
  const friendsResult = await db.prepare(
    "SELECT u.uid, COALESCE(NULLIF(p.name,''), NULLIF(d.display_name,''), u.name, 'Member') AS name, " +
    "COALESCE(NULLIF(p.avatar,''), NULLIF(d.avatar,''), u.avatar, '') AS avatar, " +
    "ps.last_seen, COALESCE(ss.online_status, 'friends') AS online_status, " +
    "COALESCE(ss.activity_status, 'friends') AS activity_status " +
    "FROM social_friends f JOIN users u ON u.uid = CASE WHEN f.uid_a = ? THEN f.uid_b ELSE f.uid_a END " +
    "LEFT JOIN user_profiles p ON p.site_uid = u.uid LEFT JOIN discord_links d ON d.site_uid = u.uid " +
    "LEFT JOIN presence_state ps ON ps.uid = u.uid LEFT JOIN user_social_settings ss ON ss.uid = u.uid " +
    "WHERE f.uid_a = ? OR f.uid_b = ? ORDER BY name COLLATE NOCASE LIMIT 100"
  ).bind(me.uid, me.uid, me.uid).all();
  const friendRows = friendsResult.results || [];
  const ids = friendRows.map((r) => r.uid);
  const [presence, requestsResult, conversationsResult] = await Promise.all([
    getPresence(env, me.uid, ids),
    db.prepare(
      "SELECT r.id, r.requester_uid, r.recipient_uid, r.created_at, " +
      "COALESCE(NULLIF(p1.name,''), NULLIF(d1.display_name,''), u1.name, 'Member') AS requester_name, " +
      "COALESCE(NULLIF(p1.avatar,''), NULLIF(d1.avatar,''), u1.avatar, '') AS requester_avatar, " +
      "COALESCE(NULLIF(p2.name,''), NULLIF(d2.display_name,''), u2.name, 'Member') AS recipient_name, " +
      "COALESCE(NULLIF(p2.avatar,''), NULLIF(d2.avatar,''), u2.avatar, '') AS recipient_avatar " +
      "FROM friend_requests r " +
      "JOIN users u1 ON u1.uid = r.requester_uid LEFT JOIN user_profiles p1 ON p1.site_uid = u1.uid LEFT JOIN discord_links d1 ON d1.site_uid = u1.uid " +
      "JOIN users u2 ON u2.uid = r.recipient_uid LEFT JOIN user_profiles p2 ON p2.site_uid = u2.uid LEFT JOIN discord_links d2 ON d2.site_uid = u2.uid " +
      "WHERE r.status = 'pending' AND (r.requester_uid = ? OR r.recipient_uid = ?) ORDER BY r.created_at DESC LIMIT 100"
    ).bind(me.uid, me.uid).all(),
    db.prepare(
      "SELECT c.id, c.kind, c.title, " +
      "(SELECT COUNT(*) FROM dm_conversation_members m2 WHERE m2.conversation_id = c.id) AS member_count, " +
      "(SELECT other.uid FROM dm_conversation_members other " +
      " WHERE other.conversation_id = c.id AND other.uid <> mine.uid LIMIT 1) AS other_uid, " +
      "c.last_message_at, m.body AS last_message, m.sender_uid AS last_sender_uid, " +
      "(SELECT COUNT(*) FROM dm_messages unread " +
      " WHERE unread.conversation_id = c.id AND unread.sender_uid <> ? " +
      " AND unread.id > mine.last_read_message_id AND unread.deleted_at IS NULL) AS unread " +
      "FROM dm_conversation_members mine " +
      "JOIN dm_conversations c ON c.id = mine.conversation_id " +
      "LEFT JOIN dm_messages m ON m.id = (SELECT MAX(m2.id) FROM dm_messages m2 WHERE m2.conversation_id = c.id) " +
      "WHERE mine.uid = ? ORDER BY c.last_message_at DESC LIMIT 60"
    ).bind(me.uid, me.uid).all(),
  ]);

  const online = new Set(presence.online);
  const friendIds = ids.filter((uid) => online.has(uid));
  /* The people whose activity is looked up: the friends, and the people in
     the one-to-one conversations. They are nearly always the same people, so
     this is one query rather than two - and one query is what the row budget
     can afford. */
  const convoRows = conversationsResult.results || [];
  /* The one-to-one rows carry the person on the other end; a group has no
     such person, and carries its title and size instead. Their profiles are
     fetched separately so a group is one row rather than one per member. */
  const otherUids = Array.from(new Set(convoRows.map((r) => r.other_uid).filter(uidOk)));
  const profilesByUid = new Map();
  if (otherUids.length) {
    const people = otherUids.map(() => "?").join(",");
    const profileRows = await db.prepare(
      "SELECT u.uid, COALESCE(NULLIF(p.name,''), NULLIF(d.display_name,''), u.name, 'Member') AS name, " +
      "COALESCE(NULLIF(p.avatar,''), NULLIF(d.avatar,''), u.avatar, '') AS avatar, " +
      "ps.last_seen, COALESCE(ss.online_status, 'friends') AS online_status " +
      "FROM users u LEFT JOIN user_profiles p ON p.site_uid = u.uid LEFT JOIN discord_links d ON d.site_uid = u.uid " +
      "LEFT JOIN presence_state ps ON ps.uid = u.uid LEFT JOIN user_social_settings ss ON ss.uid = u.uid " +
      "WHERE u.uid IN (" + people + ")"
    ).bind(...otherUids).all();
    for (const row of profileRows.results || []) profilesByUid.set(row.uid, row);
  }
  const statusIds = Array.from(new Set(ids.concat(otherUids))).filter(uidOk);
  /* What the rows say a person is up to is the song they are playing, and
   * only that. The activity table records every action the site has seen - a
   * vote, a favorite, a playlist, a password change - and a newer one of
   * those would otherwise stand where the music should be. So the query takes
   * the listen rows alone, and picks the newest of them per person. */
  const activityByUid = new Map();
  if (statusIds.length) {
    const q = statusIds.map(() => "?").join(",");
    const activities = await db.prepare(
      "SELECT uid, type, label, detail FROM (" +
      "SELECT uid, type, label, detail, ROW_NUMBER() OVER (PARTITION BY uid ORDER BY ts DESC) AS rn " +
      "FROM activity WHERE uid IN (" + q + ") AND type = 'listen') WHERE rn = 1"
    ).bind(...statusIds).all();
    for (const row of activities.results || []) {
      /* The words are for whoever is reading the row, not for the member who
         played the track - the account page keeps "You played ..." for their
         own history, and this says what they are doing right now. */
      const song = String(row.detail || "").trim() || String(row.label || "").replace(/^You played\s+/i, "");
      row.present = song ? "Listening To " + song : "";
      activityByUid.set(row.uid, row);
    }
  }
  const friends = friendRows.map((r) => ({
    uid: r.uid,
    name: r.name,
    avatar: r.avatar,
    online: friendIds.includes(r.uid) && r.online_status !== "nobody",
    lastActive: r.online_status === "nobody" ? "" : (r.last_seen || ""),
    activity: r.activity_status === "nobody" ? "" : (activityByUid.get(r.uid)?.present || ""),
  }));
  const requests = (requestsResult.results || []).map((r) => ({
    id: r.id,
    direction: r.recipient_uid === me.uid ? "incoming" : "outgoing",
    uid: r.recipient_uid === me.uid ? r.requester_uid : r.recipient_uid,
    name: r.recipient_uid === me.uid ? r.requester_name : r.recipient_name,
    avatar: r.recipient_uid === me.uid ? r.requester_avatar : r.recipient_avatar,
    createdAt: r.created_at,
  }));
  const conversations = convoRows.map((r) => {
    /* A group is named by its title and sized by its members. It has no
       person on the other end, so it carries no presence - the row says how
       many people are in it instead. */
    if (r.kind === "group") {
      return {
        id: r.id, kind: "group", uid: "",
        name: String(r.title || "").trim() || "Group chat", avatar: "",
        memberCount: Number(r.member_count) || 0,
        lastMessage: r.last_message || "", lastSenderUid: r.last_sender_uid || "",
        lastMessageAt: r.last_message_at, unread: Number(r.unread) || 0,
        online: false, lastActive: "", activity: "",
      };
    }
    const person = profilesByUid.get(r.other_uid) || {};
    /* Presence is for friends. A thread can be open with anybody the site
       lets you message, and none of those people has agreed to be followed
       around the site - so without the friendship this row says nothing
       about them: no last-seen, no song. Whether they are here right now
       was already gated the same way, one line below. */
    const sharesPresence = ids.includes(r.other_uid) && person.online_status !== "nobody";
    return {
      id: r.id, kind: "dm", uid: r.other_uid || "",
      name: person.name || "Member", avatar: person.avatar || "",
      memberCount: 2,
      lastMessage: r.last_message || "", lastSenderUid: r.last_sender_uid || "",
      lastMessageAt: r.last_message_at, unread: Number(r.unread) || 0,
      /* The presence, the same way the friends list has it: whether they are
         here now, and when they were last here. Without this the thread
         header said "Offline" to everybody, always. */
      online: friendIds.includes(r.other_uid) && person.online_status !== "nobody",
      lastActive: sharesPresence ? (person.last_seen || "") : "",
      /* The song they are playing - the same one the friends list says, and
         the only thing the presence ever claims. Friends only, for the same
         reason as the line above. */
      activity: sharesPresence ? (activityByUid.get(r.other_uid)?.present || "") : "",
    };
  });
  const unreadMessages = conversations.reduce((n, c) => n + c.unread, 0);
  return {
    ok: true,
    me: { uid: me.uid, name: me.name || "", avatar: me.avatar || "" },
    friends, requests, conversations,
    counts: { requests: requests.filter((r) => r.direction === "incoming").length, messages: unreadMessages },
    presenceAvailable: presence.available,
    /* The member's own settings, so the client knows what it is sharing
       without asking for them separately. It is the member's own row, and
       the reader is the member. */
    settings: await privacy(db, me.uid),
  };
}

async function searchUsers(db, me, query) {
  const q = String(query || "").trim().replace(/[%_\\]/g, "").slice(0, 40);
  if (q.length < 2) return json({ ok: true, users: [] });
  const like = "%" + q + "%";
  const rows = await db.prepare(
    "SELECT u.uid, COALESCE(NULLIF(p.name,''), NULLIF(d.display_name,''), u.name, 'Member') AS name, " +
    "COALESCE(NULLIF(p.avatar,''), NULLIF(d.avatar,''), u.avatar, '') AS avatar " +
    "FROM users u LEFT JOIN user_profiles p ON p.site_uid = u.uid LEFT JOIN discord_links d ON d.site_uid = u.uid " +
    "WHERE u.uid <> ? AND (u.name LIKE ? OR p.name LIKE ? OR d.display_name LIKE ?) " +
    "AND NOT EXISTS (SELECT 1 FROM user_blocks b WHERE " +
    "(b.blocker_user_id = ? AND b.blocked_user_id = u.uid) OR (b.blocker_user_id = u.uid AND b.blocked_user_id = ?)) " +
    "ORDER BY name COLLATE NOCASE LIMIT 20"
  ).bind(me.uid, like, like, like, me.uid, me.uid).all();
  const users = [];
  for (const row of rows.results || []) {
    const status = await areFriends(db, me.uid, row.uid);
    const [incoming, outgoing] = await Promise.all([
      db.prepare("SELECT id FROM friend_requests WHERE requester_uid = ? AND recipient_uid = ? AND status = 'pending'").bind(row.uid, me.uid).first(),
      db.prepare("SELECT id FROM friend_requests WHERE requester_uid = ? AND recipient_uid = ? AND status = 'pending'").bind(me.uid, row.uid).first(),
    ]);
    users.push({ ...row, relationship: status ? "friends" : incoming ? "incoming" : outgoing ? "outgoing" : "none" });
  }
  return json({ ok: true, users });
}

async function sendFriendRequest(context, db, me, body) {
  const targetUid = String(body.uid || "");
  if (!uidOk(targetUid) || targetUid === me.uid) return json({ error: "invalid_target" }, 400);
  if (!(await profile(db, targetUid))) return json({ error: "user_not_found" }, 404);
  if (await isBlocked(db, me.uid, targetUid)) return json({ error: "blocked" }, 403);
  if (await areFriends(db, me.uid, targetUid)) return json({ error: "already_friends" }, 409);
  const incoming = await db.prepare(
    "SELECT id FROM friend_requests WHERE requester_uid = ? AND recipient_uid = ? AND status = 'pending'"
  ).bind(targetUid, me.uid).first();
  if (incoming) return json({ error: "incoming_request", requestId: incoming.id }, 409);
  const settings = await privacy(db, targetUid);
  if (settings.friend_requests === "nobody") return json({ error: "requests_not_allowed" }, 403);
  if (settings.friend_requests === "followers") {
    const follows = await db.prepare(
      "SELECT 1 FROM follows WHERE follower_uid = ? AND followed_uid = ?"
    ).bind(me.uid, targetUid).first();
    if (!follows) return json({ error: "follow_required" }, 403);
  }
  if (!(await rateLimit(db, me.uid, "friend_request", 15, 3600000))) return json({ error: "rate_limited" }, 429);
  try {
    await db.prepare(
      "INSERT INTO friend_requests (requester_uid, recipient_uid) VALUES (?, ?)"
    ).bind(me.uid, targetUid).run();
  } catch (err) {
    if (/unique/i.test(String(err && err.message || err))) return json({ error: "request_pending" }, 409);
    throw err;
  }
  await notifyBestEffort(db, context.env, targetUid, me, "friend_request", (me.name || "Someone") + " sent you a friend request", context);
  return json({ ok: true, status: "outgoing" }, 201);
}

async function handleRequestAction(context, db, me, requestId, action) {
  const id = Number(requestId);
  if (!Number.isInteger(id) || id < 1) return json({ error: "invalid_request" }, 400);
  const row = await db.prepare(
    "SELECT id, requester_uid, recipient_uid, status FROM friend_requests WHERE id = ?"
  ).bind(id).first();
  if (!row || row.status !== "pending") return json({ error: "request_not_found" }, 404);
  if ((action === "accept" || action === "decline") && row.recipient_uid !== me.uid) return json({ error: "forbidden" }, 403);
  if (action === "cancel" && row.requester_uid !== me.uid) return json({ error: "forbidden" }, 403);
  if (action !== "accept" && action !== "decline" && action !== "cancel") return json({ error: "invalid_action" }, 400);
  if (action === "accept" && await isBlocked(db, me.uid, row.requester_uid)) return json({ error: "blocked" }, 403);
  const status = action === "accept" ? "accepted" : action === "decline" ? "declined" : "cancelled";
  const changed = await db.prepare(
    "UPDATE friend_requests SET status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ? AND status = 'pending'"
  ).bind(status, id).run();
  if (!Number(changed.meta && changed.meta.changes)) return json({ error: "request_not_pending" }, 409);
  if (action === "accept") {
    const [a, b] = canonicalPair(row.requester_uid, row.recipient_uid);
    await db.prepare("INSERT OR IGNORE INTO social_friends (uid_a, uid_b) VALUES (?, ?)").bind(a, b).run();
    await notifyBestEffort(db, context.env, row.requester_uid, me, "friend_accepted", (me.name || "Someone") + " accepted your friend request", context);
  } else {
    await signalRefresh(context.env, row.requester_uid);
  }
  return json({ ok: true, status });
}

async function removeFriend(context, db, me, uid) {
  if (!uidOk(uid) || uid === me.uid) return json({ error: "invalid_target" }, 400);
  if (!(await areFriends(db, me.uid, uid))) return json({ error: "not_friends" }, 404);
  const [a, b] = canonicalPair(me.uid, uid);
  await db.prepare("DELETE FROM social_friends WHERE uid_a = ? AND uid_b = ?").bind(a, b).run();
  await signalRefresh(context.env, uid);
  await signalRefresh(context.env, me.uid);
  return json({ ok: true });
}

async function openConversation(db, me, body) {
  const targetUid = String(body.uid || "");
  if (!uidOk(targetUid) || targetUid === me.uid) return json({ error: "invalid_target" }, 400);
  if (!(await profile(db, targetUid))) return json({ error: "user_not_found" }, 404);
  if (await isBlocked(db, me.uid, targetUid)) return json({ error: "blocked" }, 403);
  if (!(await canMessage(db, me.uid, targetUid))) return json({ error: "messages_not_allowed" }, 403);
  const [a, b] = canonicalPair(me.uid, targetUid);
  let conversation = await db.prepare(
    "SELECT id FROM dm_conversations WHERE uid_a = ? AND uid_b = ?"
  ).bind(a, b).first();
  if (!conversation) {
    const id = crypto.randomUUID();
    try {
      await db.prepare("INSERT INTO dm_conversations (id, uid_a, uid_b) VALUES (?, ?, ?)").bind(id, a, b).run();
      conversation = { id };
    } catch (err) {
      if (!/unique/i.test(String(err && err.message || err))) throw err;
      conversation = await db.prepare("SELECT id FROM dm_conversations WHERE uid_a = ? AND uid_b = ?").bind(a, b).first();
    }
  }
  if (!conversation) throw new Error("Could not create conversation");
  await db.prepare("INSERT OR IGNORE INTO dm_conversation_members (conversation_id, uid) VALUES (?, ?), (?, ?)")
    .bind(conversation.id, a, conversation.id, b).run();
  return json({ ok: true, conversationId: conversation.id });
}

/* A group chat: a name, and the people to put in it.
 *
 * Everyone picked has to be somebody this person can already message - the
 * same rule a one-to-one obeys - so a group cannot be used to reach a person
 * who has said they do not want messages, or somebody who has blocked the
 * sender. The one-to-one path above is untouched: it opens the pair you have,
 * it never converts into a group. */
async function createGroupConversation(context, db, me, body) {
  const wanted = Array.isArray(body.uids) ? body.uids : [];
  const uids = [];
  wanted.forEach(function (raw) {
    const uid = String(raw || "");
    if (uidOk(uid) && uid !== me.uid && uids.indexOf(uid) === -1) uids.push(uid);
  });
  if (!uids.length) return json({ error: "invalid_members" }, 400);
  if (uids.length > MAX_GROUP) return json({ error: "too_many_members", max: MAX_GROUP }, 400);
  const title = String(body.title || "").replace(/\u0000/g, "").trim().slice(0, 40);
  if (!title) return json({ error: "invalid_title" }, 400);
  for (const uid of uids) {
    if (!(await profile(db, uid))) return json({ error: "user_not_found", uid }, 404);
    if (await isBlocked(db, me.uid, uid)) return json({ error: "blocked", uid }, 403);
    if (!(await canMessage(db, me.uid, uid))) return json({ error: "messages_not_allowed", uid }, 403);
  }
  if (!(await rateLimit(db, me.uid, "dm_group", 10, 3600000))) return json({ error: "rate_limited" }, 429);
  const id = crypto.randomUUID();
  /* The pair of columns is the one-to-one shape and a group has no pair, but
     they are NOT NULL and SQLite cannot drop them. They hold a pair derived
     from the group's own id: ordered, colliding with nothing real. */
  try {
    await db.prepare(
      "INSERT INTO dm_conversations (id, uid_a, uid_b, kind, title, created_by) VALUES (?, ?, ?, 'group', ?, ?)"
    ).bind(id, "group:" + id, "group;" + id, title, me.uid).run();
  } catch (err) {
    if (!/unique/i.test(String(err && err.message || err))) throw err;
    return json({ error: "conversation_exists" }, 409);
  }
  const members = [me.uid].concat(uids);
  try {
    const values = members.map(function () { return "(?, ?)"; }).join(", ");
    const binds = [];
    members.forEach(function (uid) { binds.push(id, uid); });
    await db.prepare(
      "INSERT OR IGNORE INTO dm_conversation_members (conversation_id, uid) VALUES " + values
    ).bind(...binds).run();
  } catch (err) {
    /* Half a group is worse than no group: take the row back out rather than
       leave a conversation only some of its people can see. */
    await db.prepare("DELETE FROM dm_conversations WHERE id = ?").bind(id).run();
    throw err;
  }
  const label = (me.name || "Someone") + " added you to \u201C" + title + "\u201D";
  for (const uid of uids) {
    await notifyBestEffort(db, context.env, uid, me, "dm_message", label, context);
  }
  await fanoutToOthers(context.env, uids, { type: "social:refresh" });
  return json({ ok: true, conversationId: id, kind: "group", title, members: members }, 201);
}

async function listMessages(db, me, conversationId, url) {
  const conversation = await conversationOf(db, conversationId, me.uid);
  if (!conversation) return json({ error: "conversation_not_found" }, 404);
  const others = await memberUids(db, conversationId, me.uid);
  const before = Math.max(0, Number(url.searchParams.get("before")) || 0);
  const rows = await db.prepare(
    "SELECT m.id, m.conversation_id, m.sender_uid, m.body, m.reply_to_id, m.created_at, m.edited_at, m.deleted_at, " +
    "COALESCE((SELECT json_group_array(json_object('emoji', x.emoji, 'count', x.count, 'mine', x.mine)) " +
    "FROM (SELECT emoji, COUNT(*) AS count, MAX(CASE WHEN uid = ? THEN 1 ELSE 0 END) AS mine " +
    "FROM dm_message_reactions WHERE message_id = m.id GROUP BY emoji) x), '[]') AS reactions, " +
    "(SELECT body FROM dm_messages parent WHERE parent.id = m.reply_to_id AND parent.conversation_id = m.conversation_id) AS reply_body, " +
    "(SELECT sender_uid FROM dm_messages parent WHERE parent.id = m.reply_to_id AND parent.conversation_id = m.conversation_id) AS reply_sender_uid " +
    "FROM dm_messages m WHERE m.conversation_id = ? AND (? = 0 OR m.id < ?) " +
    "ORDER BY m.id DESC LIMIT 50"
  ).bind(me.uid, conversationId, before, before).all();
  /* A one-to-one is blocked or allowed by the one person in it. A group was
     allowed by everybody when it was made, and each of them can still stop
     messages from a particular person by blocking them - which is delivery,
     not permission to type. */
  const blocked = conversation.kind === "group" ? false
    : (others.length ? await isBlocked(db, me.uid, others[0]) : true);
  const canSend = conversation.kind === "group" ? others.length > 0
    : (!blocked && others.length > 0 && await canMessage(db, me.uid, others[0]));
  return json({
    ok: true,
    conversation,
    messages: (rows.results || []).reverse().map((m) => ({
      id: m.id, senderUid: m.sender_uid, body: m.deleted_at ? "" : m.body,
      replyToId: m.reply_to_id || null, replyBody: m.reply_body || "",
      replySenderUid: m.reply_sender_uid || "", createdAt: m.created_at,
      editedAt: m.edited_at || null, deleted: !!m.deleted_at,
      reactions: JSON.parse(m.reactions || "[]"),
    })),
    /* Who said what. A group has to name its senders; a one-to-one already
       knows, but the map comes back either way so the client has one path. */
    senders: await namesFor(db, others),
    otherUid: others[0] || "", others, blocked, canSend,
  });
}

async function sendMessage(context, db, me, conversationId, body) {
  const conversation = await conversationOf(db, conversationId, me.uid);
  if (!conversation) return json({ error: "conversation_not_found" }, 404);
  const others = await memberUids(db, conversationId, me.uid);
  if (!others.length) return json({ error: "conversation_not_found" }, 404);
  /* A one-to-one has to be allowed by the person on the other end of it. A
     group was allowed by everyone in it when it was made, and each of them is
     still asked below whether this particular sender reaches them. */
  if (conversation.kind !== "group" && !(await canMessage(db, me.uid, others[0]))) {
    return json({ error: "messages_not_allowed" }, 403);
  }
  const text = String(body.body || "").replace(/\u0000/g, "").trim();
  if (!text || text.length > MAX_MESSAGE) return json({ error: "invalid_message", maxLength: MAX_MESSAGE }, 400);
  if (!(await rateLimit(db, me.uid, "dm_send", 30, 60000))) return json({ error: "rate_limited" }, 429);
  const replyTo = body.replyToId == null ? null : Number(body.replyToId);
  if (replyTo != null) {
    if (!Number.isInteger(replyTo) || replyTo < 1) return json({ error: "invalid_reply" }, 400);
    const parent = await db.prepare(
      "SELECT 1 FROM dm_messages WHERE id = ? AND conversation_id = ?"
    ).bind(replyTo, conversationId).first();
    if (!parent) return json({ error: "reply_not_found" }, 404);
  }
  const inserted = await db.prepare(
    "INSERT INTO dm_messages (conversation_id, sender_uid, body, reply_to_id) VALUES (?, ?, ?, ?)"
  ).bind(conversationId, me.uid, text, replyTo).run();
  const id = Number(inserted.meta && inserted.meta.last_row_id) || 0;
  await db.prepare(
    "UPDATE dm_conversations SET last_message_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?"
  ).bind(conversationId).run();
  /* Who actually gets it. In a one-to-one that is the one person; in a group
     it is everyone who has not blocked the sender and still takes messages. */
  const reached = [];
  for (const uid of others) {
    if (conversation.kind !== "group" || await canMessage(db, me.uid, uid)) reached.push(uid);
  }
  const label = conversation.kind === "group"
    ? (me.name || "Someone") + " sent a message in \u201C" + (conversation.title || "a group") + "\u201D"
    : (me.name || "Someone") + " sent you a message";
  for (const uid of reached) {
    await notifyBestEffort(db, context.env, uid, me, "dm_message", label, context);
  }
  await fanoutToOthers(context.env, reached, {
    type: "social:message",
    conversationId,
    messageId: id,
  });
  await hubBroadcast(context.env, {
    type: "social:message",
    private: true,
    recipientUid: me.uid,
    conversationId,
    messageId: id,
  });
  const row = await db.prepare(
    "SELECT id, sender_uid, body, reply_to_id, created_at FROM dm_messages WHERE id = ?"
  ).bind(id).first();
  return json({
    ok: true,
    message: { id: row.id, senderUid: row.sender_uid, body: row.body, replyToId: row.reply_to_id, createdAt: row.created_at },
  }, 201);
}

async function markRead(db, me, conversationId) {
  const conversation = await conversationOf(db, conversationId, me.uid);
  if (!conversation) return json({ error: "conversation_not_found" }, 404);
  await db.prepare(
    "UPDATE dm_conversation_members SET last_read_message_id = " +
    "MAX(last_read_message_id, COALESCE((SELECT MAX(id) FROM dm_messages WHERE conversation_id = ?), 0)) " +
    "WHERE conversation_id = ? AND uid = ?"
  ).bind(conversationId, conversationId, me.uid).run();
  return json({ ok: true });
}

async function typing(context, db, me, conversationId, body) {
  const conversation = await conversationOf(db, conversationId, me.uid);
  if (!conversation) return json({ error: "conversation_not_found" }, 404);
  const others = await memberUids(db, conversationId, me.uid);
  if (conversation.kind !== "group" && others.length && await isBlocked(db, me.uid, others[0])) {
    return json({ error: "blocked" }, 403);
  }
  /* The typing limit. See the client for why it is a limit and not a
     once-per-burst. This is the server's own bound, in case a client does
     not keep to it. */
  if (body.typing !== true) {
    /* The event that stops it is never withheld - it is the one that clears
       the indicator on the other end, and holding it back would leave
       "is typing…" on the screen for good. */
  } else if (!(await rateLimit(db, me.uid, "dm_typing", 40, 60000))) {
    return json({ error: "rate_limited" }, 429);
  }
  await fanoutToOthers(context.env, others, {
    type: "social:typing",
    conversationId,
    user: { uid: me.uid, name: me.name || "Member" },
    typing: body.typing === true,
    expiresAt: Date.now() + 3000,
  });
  return json({ ok: true });
}

async function mutateMessage(context, db, me, messageId, method, body) {
  const id = Number(messageId);
  if (!Number.isInteger(id) || id < 1) return json({ error: "invalid_message" }, 400);
  const row = await db.prepare(
    "SELECT id, conversation_id, sender_uid, body FROM dm_messages WHERE id = ?"
  ).bind(id).first();
  const conversation = row && await conversationOf(db, row.conversation_id, me.uid);
  if (!conversation) return json({ error: "message_not_found" }, 404);
  if (row.sender_uid !== me.uid) return json({ error: "forbidden" }, 403);
  const others = await memberUids(db, row.conversation_id, me.uid);
  if (method === "PATCH") {
    const text = String(body.body || "").replace(/\u0000/g, "").trim();
    if (!text || text.length > MAX_MESSAGE) return json({ error: "invalid_message", maxLength: MAX_MESSAGE }, 400);
    await db.prepare(
      "UPDATE dm_messages SET body = ?, edited_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ? AND sender_uid = ? AND deleted_at IS NULL"
    ).bind(text, id, me.uid).run();
  } else {
    await db.prepare(
      "UPDATE dm_messages SET body = '', deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ? AND sender_uid = ? AND deleted_at IS NULL"
    ).bind(id, me.uid).run();
  }
  await fanoutToOthers(context.env, others, {
    type: "social:message",
    conversationId: row.conversation_id,
    messageId: id,
  });
  return json({ ok: true });
}

async function reactToMessage(context, db, me, messageId, body) {
  const id = Number(messageId);
  const emoji = String(body.emoji || "");
  if (!Number.isInteger(id) || id < 1 || !EMOJIS.includes(emoji)) return json({ error: "invalid_reaction" }, 400);
  const message = await db.prepare(
    "SELECT conversation_id FROM dm_messages WHERE id = ? AND deleted_at IS NULL"
  ).bind(id).first();
  const conversation = message && await conversationOf(db, message.conversation_id, me.uid);
  if (!conversation) return json({ error: "message_not_found" }, 404);
  const others = await memberUids(db, message.conversation_id, me.uid);
  if (conversation.kind !== "group" && others.length && await isBlocked(db, me.uid, others[0])) {
    return json({ error: "blocked" }, 403);
  }
  if (!(await rateLimit(db, me.uid, "dm_reaction", 60, 60000))) return json({ error: "rate_limited" }, 429);
  const existing = await db.prepare(
    "SELECT 1 FROM dm_message_reactions WHERE message_id = ? AND uid = ? AND emoji = ?"
  ).bind(id, me.uid, emoji).first();
  if (existing) {
    await db.prepare(
      "DELETE FROM dm_message_reactions WHERE message_id = ? AND uid = ? AND emoji = ?"
    ).bind(id, me.uid, emoji).run();
  } else {
    await db.prepare(
      "INSERT OR IGNORE INTO dm_message_reactions (message_id, uid, emoji) VALUES (?, ?, ?)"
    ).bind(id, me.uid, emoji).run();
  }
  await fanoutToOthers(context.env, others, {
    type: "social:message",
    conversationId: message.conversation_id,
    messageId: id,
  });
  return json({ ok: true, reactions: await reactionCounts(db, id, me.uid) });
}

async function reactionCounts(db, messageId, uid) {
  const rows = await db.prepare(
    "SELECT emoji, COUNT(*) AS count, MAX(CASE WHEN uid = ? THEN 1 ELSE 0 END) AS mine " +
    "FROM dm_message_reactions WHERE message_id = ? GROUP BY emoji"
  ).bind(uid, messageId).all();
  return rows.results || [];
}

async function settingsRequest(context, db, me, method, body) {
  if (method === "GET") {
    return json({ ok: true, settings: await privacy(db, me.uid) });
  }
  const allowed = {
    friend_requests: ["everyone", "followers", "nobody"],
    direct_messages: ["everyone", "friends", "nobody"],
    online_status: ["everyone", "friends", "nobody"],
    activity_status: ["everyone", "friends", "nobody"],
    /* The three sharing settings for the friend activity feed. There are
       only two states: off, or shared with friends. The feed is a feed of
       what your friends are up to, so there is no "everybody" to offer. */
    activity_listening: ["nobody", "friends"],
    activity_playlists: ["nobody", "friends"],
    activity_community: ["nobody", "friends"],
  };
  const current = await privacy(db, me.uid);
  const next = {};
  for (const [key, values] of Object.entries(allowed)) {
    const value = body[key] == null ? current[key] : String(body[key]);
    if (!values.includes(value)) return json({ error: "invalid_setting", field: key }, 400);
    next[key] = value;
  }
  /* The three sharing settings live in columns the newest migration adds.
     *
     * A deploy and a migration do not happen at the same moment, so the write
     * falls back to the columns that are certainly there if the new ones are
     * not. The other privacy settings still save - which is the difference
     * between a person changing who can message them and the whole panel
     * failing with a server error. */
  try {
    await db.prepare(
      "INSERT INTO user_social_settings (uid, friend_requests, direct_messages, online_status, activity_status, " +
      "activity_listening, activity_playlists, activity_community) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(uid) DO UPDATE SET friend_requests=excluded.friend_requests, " +
      "direct_messages=excluded.direct_messages, online_status=excluded.online_status, " +
      "activity_status=excluded.activity_status, activity_listening=excluded.activity_listening, " +
      "activity_playlists=excluded.activity_playlists, activity_community=excluded.activity_community, " +
      "updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')"
    ).bind(
      me.uid, next.friend_requests, next.direct_messages, next.online_status, next.activity_status,
      next.activity_listening, next.activity_playlists, next.activity_community
    ).run();
  } catch (_) {
    await db.prepare(
      "INSERT INTO user_social_settings (uid, friend_requests, direct_messages, online_status, activity_status) " +
      "VALUES (?, ?, ?, ?, ?) ON CONFLICT(uid) DO UPDATE SET friend_requests=excluded.friend_requests, " +
      "direct_messages=excluded.direct_messages, online_status=excluded.online_status, " +
      "activity_status=excluded.activity_status, " +
      "updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')"
    ).bind(me.uid, next.friend_requests, next.direct_messages, next.online_status, next.activity_status).run();
  }
  const friends = await db.prepare(
    "SELECT CASE WHEN uid_a = ? THEN uid_b ELSE uid_a END AS uid " +
    "FROM social_friends WHERE uid_a = ? OR uid_b = ?"
  ).bind(me.uid, me.uid, me.uid).all();
  await Promise.all((friends.results || []).map((friend) => signalRefresh(context.env, friend.uid)));
  return json({ ok: true, settings: next });
}

export async function onRequest(context) {
  const { request } = context;
  const method = request.method;
  if (method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const db = context.env.wanted_vault;
  try {
    const me = await actorFor(context);
    if (!me) return json({ ok: false, error: "sign_in_required" }, 401);
    if (method !== "GET") {
      const rejected = await banRejection(db, me.uid);
      if (rejected) return rejected.response;
    }
    const parts = partsOf(request);
    const url = new URL(request.url);
    if (parts.length === 1 && parts[0] === "bootstrap" && method === "GET") return json(await bootstrap(db, context.env, me));
    if (parts.length === 1 && parts[0] === "search" && method === "GET") return searchUsers(db, me, url.searchParams.get("q"));
    if (parts.length === 1 && parts[0] === "settings" && (method === "GET" || method === "POST")) {
      return settingsRequest(context, db, me, method, method === "GET" ? {} : await request.json());
    }
    if (parts.length === 1 && parts[0] === "requests" && method === "GET") return json(await bootstrap(db, context.env, me));
    if (parts.length === 1 && parts[0] === "requests" && method === "POST") return sendFriendRequest(context, db, me, await request.json());
    if (parts.length === 2 && parts[0] === "requests" && method === "PATCH") {
      const body = await request.json();
      return handleRequestAction(context, db, me, parts[1], String(body.action || ""));
    }
    if (parts.length === 2 && parts[0] === "friends" && method === "DELETE") return removeFriend(context, db, me, parts[1]);
    if (parts.length === 1 && parts[0] === "conversations" && method === "POST") {
      /* One person opens a one-to-one; a list of people makes a group. The
         shape of the body is what says which, so a group never has to be a
         second endpoint that a one-to-one could fall into by mistake. */
      const body = await request.json();
      return Array.isArray(body.uids) ? createGroupConversation(context, db, me, body) : openConversation(db, me, body);
    }
    if (parts.length === 3 && parts[0] === "conversations" && parts[2] === "messages" && method === "GET") {
      return listMessages(db, me, parts[1], url);
    }
    if (parts.length === 3 && parts[0] === "conversations" && parts[2] === "messages" && method === "POST") {
      return sendMessage(context, db, me, parts[1], await request.json());
    }
    if (parts.length === 3 && parts[0] === "conversations" && parts[2] === "read" && method === "POST") return markRead(db, me, parts[1]);
    if (parts.length === 3 && parts[0] === "conversations" && parts[2] === "typing" && method === "POST") {
      return typing(context, db, me, parts[1], await request.json());
    }
    if (parts.length === 2 && parts[0] === "messages" && method === "PATCH") return mutateMessage(context, db, me, parts[1], method, await request.json());
    if (parts.length === 2 && parts[0] === "messages" && method === "DELETE") return mutateMessage(context, db, me, parts[1], method, {});
    if (parts.length === 3 && parts[0] === "messages" && parts[2] === "reactions" && method === "POST") {
      return reactToMessage(context, db, me, parts[1], await request.json());
    }
    return json({ error: "not_found" }, 404);
  } catch (err) {
    console.error("Social API request failed:", err);
    return json({ ok: false, error: "social_request_failed" }, 500);
  }
}
