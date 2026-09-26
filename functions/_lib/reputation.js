// Trust & reputation (Phase 6C).
//
// PRIVACY CONTRACT — this module deliberately stores NO device or network
// identity. Nothing here reads or records IP addresses, user agents, device
// IDs, canvas/WebGL fingerprints or cookies beyond the existing session.
// Every signal is first-party moderation history the site already owns:
// account age, own posting activity, strikes, bans, upheld/dismissed reports,
// appeal outcomes and pending automod flags.
//
// Reputation only ever adjusts *rate limits* and shows the user their standing.
// It never bans, never hides content and never mutates moderation decisions.

const CACHE_TTL_MS = 15 * 60 * 1000;

// Per-tier, per-scope action budgets inside a rolling fixed window.
export const LIMITS = {
  post: { windowSec: 600, trusted: 12, standard: 6, new: 2, restricted: 1 },
  reply: { windowSec: 600, trusted: 30, standard: 15, new: 5, restricted: 3 },
  report: { windowSec: 3600, trusted: 20, standard: 10, new: 5, restricted: 3 },
};

const NEW_ACCOUNT_DAYS = 14;

function nowIso() {
  return new Date().toISOString();
}

function daysBetween(aIso, bIso) {
  const a = Date.parse(aIso);
  const b = Date.parse(bIso);
  if (isNaN(a) || isNaN(b)) return null;
  return Math.max(0, (b - a) / 86400000);
}

async function one(db, sql, ...binds) {
  try {
    return await db.prepare(sql).bind(...binds).first();
  } catch (_) {
    return null;
  }
}

// Recomputes the score from source tables. Safe to call on a cache miss.
export async function computeReputation(db, uid) {
  const id = String(uid || "").slice(0, 40);
  if (!id) return null;
  const now = nowIso();
  const s = {
    account_age_days: 0,
    posts: 0,
    replies: 0,
    active_strikes: 0,
    total_strikes: 0,
    revoked_strikes: 0,
    bans_total: 0,
    ban_active: 0,
    reports_upheld: 0,
    false_reports: 0,
    automod_pending: 0,
    appeals_upheld: 0,
  };

  const u = await one(db, "SELECT created_at FROM users WHERE uid = ?", id);
  const age = u && u.created_at ? daysBetween(u.created_at, now) : null;
  s.account_age_days = age == null ? null : Math.floor(age);

  const posts = await one(db, "SELECT COUNT(*) AS n FROM community_posts WHERE author_uid = ?", id);
  s.posts = posts ? Number(posts.n) : 0;
  const replies = await one(db, "SELECT COUNT(*) AS n FROM community_replies WHERE author_uid = ?", id);
  s.replies = replies ? Number(replies.n) : 0;

  const st = await one(db,
    "SELECT COUNT(*) AS total, " +
    "SUM(CASE WHEN revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?) THEN 1 ELSE 0 END) AS active, " +
    "SUM(CASE WHEN revoked_at IS NOT NULL THEN 1 ELSE 0 END) AS revoked " +
    "FROM strikes WHERE user_id = ?", now, id);
  s.total_strikes = st ? Number(st.total) || 0 : 0;
  s.active_strikes = st ? Number(st.active) || 0 : 0;
  s.revoked_strikes = st ? Number(st.revoked) || 0 : 0;

  const bn = await one(db,
    "SELECT COUNT(*) AS total, " +
    "SUM(CASE WHEN revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?) THEN 1 ELSE 0 END) AS active " +
    "FROM bans WHERE user_id = ?", now, id);
  s.bans_total = bn ? Number(bn.total) || 0 : 0;
  s.ban_active = bn ? Number(bn.active) || 0 : 0;

  // Reports upheld against this user's content (posts + replies).
  const upPosts = await one(db,
    "SELECT COUNT(*) AS n FROM reports r JOIN community_posts p ON p.id = CAST(r.target_id AS INTEGER) " +
    "WHERE r.status = 'RESOLVED' AND UPPER(r.target_type) = 'POST' AND p.author_uid = ?", id);
  const upReplies = await one(db,
    "SELECT COUNT(*) AS n FROM reports r JOIN community_replies c ON c.id = CAST(r.target_id AS INTEGER) " +
    "WHERE r.status = 'RESOLVED' AND UPPER(r.target_type) = 'REPLY' AND c.author_uid = ?", id);
  const upDirect = await one(db,
    "SELECT COUNT(*) AS n FROM reports WHERE status = 'RESOLVED' AND UPPER(target_type) IN ('USER','PROFILE') " +
    "AND (target_id = ? OR target_id = 'u:' || ? OR target_id = 'p:' || ?)", id, id, id);
  s.reports_upheld = (upPosts ? Number(upPosts.n) : 0) + (upReplies ? Number(upReplies.n) : 0) +
    (upDirect ? Number(upDirect.n) : 0);

  // Reports this user filed that staff dismissed (false positives).
  const fr = await one(db,
    "SELECT COUNT(*) AS n FROM reports r JOIN discord_links d ON d.discord_id = r.reporter_discord_id " +
    "WHERE r.status = 'DISMISSED' AND d.site_uid = ?", id);
  s.false_reports = fr ? Number(fr.n) : 0;

  const fl = await one(db, "SELECT COUNT(*) AS n FROM automod_flags WHERE uid = ? AND status = 'pending'", id);
  s.automod_pending = fl ? Number(fl.n) : 0;

  const ap = await one(db, "SELECT COUNT(*) AS n FROM ban_appeals WHERE user_id = ? AND status = 'approved'", id);
  s.appeals_upheld = ap ? Number(ap.n) : 0;

  // Weighted score. Enforcement weight is heavier for negative signals so a
  // high activity count can never outvote a strike or an upheld report.
  // Bans that staff overturned on appeal are not held against the member.
  const wrongfulBans = s.bans_total > 0 && s.appeals_upheld >= s.bans_total;
  let score = 50;
  score += Math.min(15, Math.floor((s.account_age_days || 0) / 30) * 3);
  score += Math.min(10, Math.floor((s.posts + s.replies) / 25));
  score -= s.active_strikes * 18;
  score -= (s.total_strikes - s.active_strikes) * 4;
  score -= s.revoked_strikes * 2;
  if (!wrongfulBans) {
    score -= s.ban_active ? 45 : 0;
    score -= s.bans_total * 12;
  }
  score -= s.reports_upheld * 14;
  // Dismissed reports are capped: a few bad calls lower standing and slow the
  // member down, but reporting mistakes alone must not lock anyone out.
  score -= Math.min(4, s.false_reports) * 10;
  score -= s.automod_pending * 8;
  score += Math.min(8, s.appeals_upheld * 4);
  if (s.account_age_days != null && s.account_age_days < NEW_ACCOUNT_DAYS) score -= 5;
  score = Math.max(0, Math.min(100, Math.round(score)));

  const tier = (s.ban_active || s.active_strikes >= 2 || score < 25)
    ? "restricted"
    : (s.account_age_days != null && s.account_age_days < NEW_ACCOUNT_DAYS)
      ? "new"
      : score >= 75 ? "trusted" : "standard";

  return { uid: id, score, tier, signals: s, computed_at: now };
}

// Cached read; recomputes when stale or missing. Never throws.
export async function getReputation(db, uid) {
  const id = String(uid || "").slice(0, 40);
  if (!id) return null;
  try {
    const row = await one(db, "SELECT * FROM user_reputation WHERE uid = ?", id);
    if (row && row.computed_at) {
      const age = Date.now() - Date.parse(row.computed_at);
      if (!isNaN(age) && age < CACHE_TTL_MS) {
        let signals = {};
        try { signals = JSON.parse(row.signals || "{}"); } catch (_) { signals = {}; }
        return { uid: id, score: Number(row.score) || 0, tier: row.tier || "standard", signals, computed_at: row.computed_at, cached: true };
      }
    }
  } catch (_) {}
  const fresh = await computeReputation(db, id);
  if (!fresh) return null;
  try {
    await db.prepare(
      "INSERT INTO user_reputation (uid, score, tier, signals, computed_at) VALUES (?, ?, ?, ?, ?) " +
      "ON CONFLICT(uid) DO UPDATE SET score = excluded.score, tier = excluded.tier, " +
      "signals = excluded.signals, computed_at = excluded.computed_at"
    ).bind(id, fresh.score, fresh.tier, JSON.stringify(fresh.signals), fresh.computed_at).run();
  } catch (_) {}
  return { ...fresh, cached: false };
}

// Fixed-window counter. Returns { allowed, limit, used, retryAfterSec }.
// A DB failure fails OPEN (allow) so a counter outage never blocks posting;
// ban enforcement in _lib/bans.js remains the hard gate.
export async function rateLimit(db, scope, uid, opts) {
  const cfg = LIMITS[scope];
  const id = String(uid || "").slice(0, 40);
  if (!cfg || !id) return { allowed: true, limit: 0, used: 0, retryAfterSec: 0 };
  if (opts && opts.exempt) return { allowed: true, limit: cfg.standard, used: 0, retryAfterSec: 0, exempt: true };

  let tier = "standard";
  if (opts && opts.tier) tier = opts.tier;
  else {
    const rep = await getReputation(db, id);
    tier = rep ? rep.tier : "standard";
  }
  const limit = Number(cfg[tier] != null ? cfg[tier] : cfg.standard);

  const windowSec = cfg.windowSec;
  const bucket = String(Math.floor(Date.now() / 1000 / windowSec));
  const key = scope + "|" + id + "|" + bucket;
  const now = nowIso();
  try {
    await db.prepare(
      "INSERT INTO moderation_rate_counters (key, scope, uid, bucket, count, window_start) VALUES (?, ?, ?, ?, 1, ?) " +
      "ON CONFLICT(key) DO UPDATE SET count = count + 1"
    ).bind(key, scope, id, bucket, now).run();
    const row = await one(db, "SELECT count FROM moderation_rate_counters WHERE key = ?", key);
    const used = row ? Number(row.count) || 0 : 1;
    if (used > limit) {
      const startMs = Number(bucket) * windowSec * 1000;
      const retryAfterSec = Math.max(1, Math.ceil((startMs + windowSec * 1000 - Date.now()) / 1000));
      return { allowed: false, limit, used, retryAfterSec, tier };
    }
    return { allowed: true, limit, used, retryAfterSec: 0, tier };
  } catch (_) {
    return { allowed: true, limit, used: 0, retryAfterSec: 0, tier, failOpen: true };
  }
}

// Housekeeping: counters and stale reputation rows are ephemeral caches.
export async function pruneCaches(db) {
  const cutoff = new Date(Date.now() - 7 * 86400000).toISOString();
  try { await db.prepare("DELETE FROM moderation_rate_counters WHERE window_start < ?").bind(cutoff).run(); } catch (_) {}
  try { await db.prepare("DELETE FROM user_reputation WHERE computed_at < ?").bind(cutoff).run(); } catch (_) {}
}

export const NEW_ACCOUNT_THRESHOLD_DAYS = NEW_ACCOUNT_DAYS;
