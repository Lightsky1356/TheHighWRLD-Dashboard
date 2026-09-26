// Automated moderation core (Phase 6B): rules engine + optional AI hook.
// Staged policy: low -> allow (no record); medium -> flag for review;
// high -> flag urgent; critical/severe ALWAYS needs a human (never auto-ban).
// AI runs server-side only, env-gated (AI_MOD_ENDPOINT + AI_MOD_KEY), with
// graceful fallback to the rules verdict on failure/timeout/malformed output.

const LINK_RE = /https?:\/\/[^\s)]+/gi;
const MENTION_RE = /(?:^|\W)@([A-Za-z0-9_]{3,32})/g;

function countLinks(text) {
  try {
    const m = String(text || "").match(LINK_RE);
    return m ? m.length : 0;
  } catch (_) {
    return 0;
  }
}

function capsRatio(text) {
  try {
    const letters = String(text || "").replace(/[^A-Za-z]/g, "");
    if (letters.length < 20) return 0;
    const upper = letters.replace(/[^A-Z]/g, "").length;
    return upper / letters.length;
  } catch (_) {
    return 0;
  }
}

function countMentions(text) {
  try {
    const m = String(text || "").match(MENTION_RE);
    return m ? m.length : 0;
  } catch (_) {
    return 0;
  }
}

// Pure rules evaluation. Returns null (allow) or a finding object. No I/O.
export function evaluateRules({ text, uid, recentCount }) {
  const t = String(text || "");
  const len = t.length;
  if (!len) return null;
  const links = countLinks(t);
  const caps = capsRatio(t);
  const mentions = countMentions(t);

  // High: link spam.
  if (links >= 3) {
    return {
      category: "spam", confidence: 0.85, severity: "high",
      recommended_action: "review", detail: links + " links in one post",
    };
  }
  // High: flooding (many posts in a short window — caller supplies count).
  if (recentCount != null && recentCount >= 5) {
    return {
      category: "flooding", confidence: 0.8, severity: "high",
      recommended_action: "review", detail: recentCount + " posts in 10 minutes",
    };
  }
  // Medium: mass mentions.
  if (mentions >= 10) {
    return {
      category: "mass_mention", confidence: 0.65, severity: "medium",
      recommended_action: "review", detail: mentions + " mentions in one post",
    };
  }
  // Medium: shouting (long all-caps post).
  if (caps >= 0.8 && len >= 60) {
    return {
      category: "shouting", confidence: 0.6, severity: "medium",
      recommended_action: "review", detail: Math.round(caps * 100) + "% uppercase",
    };
  }
  // Medium: link + short low-effort body (classic spam shape).
  if (links >= 1 && len < 60) {
    return {
      category: "spam", confidence: 0.6, severity: "medium",
      recommended_action: "review", detail: "link with very short body",
    };
  }
  return null;
}

// Optional server-side AI verdict. Returns null when unconfigured or on any
// failure — the caller keeps the rules verdict. Never throws.
export async function aiVerdict(env, { text, author, kind }) {
  const endpoint = env.AI_MOD_ENDPOINT || "";
  const key = env.AI_MOD_KEY || "";
  if (!endpoint || !key) return null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => { try { ctrl.abort(); } catch (_) {} }, 8000);
    let res;
    try {
      res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
        body: JSON.stringify({
          content: String(text || "").slice(0, 2000),
          author: String(author || "").slice(0, 40),
          kind: String(kind || "post"),
          task: "classify: return JSON {category, confidence (0-1), severity (low|medium|high), recommended_action}",
        }),
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res || !res.ok) return null;
    const d = await res.json().catch(() => null);
    if (!d || typeof d !== "object") return null;
    const conf = Number(d.confidence);
    const sev = String(d.severity || "").toLowerCase();
    if (isNaN(conf) || conf < 0 || conf > 1) return null;
    if (sev !== "low" && sev !== "medium" && sev !== "high") return null;
    return {
      category: String(d.category || "unclassified").slice(0, 40),
      confidence: conf,
      severity: sev,
      recommended_action: "review",
    };
  } catch (_) {
    return null;
  }
}

// Full pipeline for one piece of content. Records medium+ findings, returns
// the stored flag row (or null when allowed). Never throws, never blocks.
export async function moderateContent(db, env, { targetType, targetId, uid, text, author, recentCount }) {
  try {
    const finding = evaluateRules({ text, uid, recentCount });
    if (!finding) return null;
    let ai = null;
    try {
      ai = await aiVerdict(env, { text, author, kind: targetType });
    } catch (_) {
      ai = null;
    }
    // AI may upgrade/downgrade within non-severe bounds; severe stays human.
    let final = finding;
    let aiJson = "";
    if (ai) {
      aiJson = JSON.stringify(ai).slice(0, 500);
      if (ai.severity === "high" && finding.severity !== "high") {
        final = { ...finding, severity: "high", detail: finding.detail + " · AI concurs" };
      } else if (ai.severity === "low" && ai.confidence >= 0.9 && finding.confidence < 0.7) {
        return null; // High-confidence AI clear overrules a weak rules hit.
      }
    }
    const ins = await db.prepare(
      "INSERT INTO automod_flags (target_type, target_id, uid, category, confidence, severity, recommended_action, detail, ai_verdict, status) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')"
    ).bind(
      String(targetType || "post").slice(0, 20), String(targetId || "").slice(0, 40),
      String(uid || "").slice(0, 40), final.category, final.confidence, final.severity,
      final.recommended_action, String(final.detail || "").slice(0, 200), aiJson
    ).run().catch(() => null);
    const id = ins && ins.meta && ins.meta.last_row_id ? Number(ins.meta.last_row_id) : 0;
    return { id, ...final };
  } catch (_) {
    return null;
  }
}
