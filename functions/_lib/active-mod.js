/* Active moderation for the surfaces that need more than a review flag.
 *
 * `moderateContent` only records a flag for a human. Here the AI verdict is
 * the primary judge: every submission is reviewed when AI_MOD_ENDPOINT and
 * AI_MOD_KEY are configured, and a high-severity, high-confidence verdict
 * removes the content immediately. Everything short of that becomes a normal
 * pending flag, exactly like before. Nothing here throws at a caller.
 *
 * AI is still env-gated on purpose. With no endpoint configured this module
 * falls back to the shared rules engine and behaves like the old pipeline.
 */

import { evaluateRules, aiVerdict } from "./automod.js";
import { hubBroadcast } from "./realtime.js";

const DEFAULT_THRESHOLD = 0.9;

function thresholdFor(env) {
  const n = Number(env && env.AI_MOD_THRESHOLD);
  return isFinite(n) && n > 0 && n <= 1 ? n : DEFAULT_THRESHOLD;
}

/* Decide what to do with one submission. Returns:
 *   { action: "allow" | "flag" | "remove", category, severity, confidence,
 *     ai, detail }
 * Never writes content itself - the caller owns its own rows and events.
 */
export async function activeReview(db, env, { targetType, targetId, uid, text, author, recentCount }) {
  try {
    const finding = evaluateRules({ text, uid, recentCount });
    let ai = null;
    try {
      ai = await aiVerdict(env, { text, author, kind: targetType });
    } catch (_) {
      ai = null;
    }

    let action = "allow";
    let final = null;

    if (ai) {
      const threshold = thresholdFor(env);
      if (ai.severity === "high" && ai.confidence >= threshold) {
        final = {
          category: ai.category, confidence: ai.confidence, severity: "high",
          detail: "AI: " + ai.category + " - auto-removed (" + Math.round(ai.confidence * 100) + "%)",
        };
        action = "remove";
      } else if (ai.severity === "high" || ai.severity === "medium") {
        final = {
          category: ai.category, confidence: ai.confidence, severity: ai.severity,
          detail: "AI: " + ai.category + " - below auto-action threshold",
        };
        action = "flag";
      } else if (ai.severity === "low" && ai.confidence >= 0.9 && (!finding || finding.confidence < 0.7)) {
        /* A confident AI clear overrules a weak rules hit, but never a hard one. */
        return { action: "allow", category: "clean", severity: "low", confidence: ai.confidence, ai };
      }
    }

    if (!final && finding) {
      final = finding;
      action = "flag";
    }
    if (!final) {
      return { action: "allow", category: "clean", severity: "low", confidence: 0, ai };
    }

    /* One audit row per decision. Auto-removals are recorded as actioned with
       the AI verdict attached so staff can see what happened and why. */
    const now = new Date().toISOString();
    const auto = action === "remove";
    const ins = await db.prepare(
      "INSERT INTO automod_flags (target_type, target_id, uid, category, confidence, severity, recommended_action, detail, ai_verdict, status, reviewed_at, reviewed_by) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(
      String(targetType || "post").slice(0, 20),
      String(targetId || "").slice(0, 40),
      String(uid || "").slice(0, 40),
      String(final.category || "unclassified").slice(0, 40),
      Number(final.confidence) || 0,
      String(final.severity || "medium").slice(0, 10),
      auto ? "remove" : "review",
      String(final.detail || "").slice(0, 200),
      ai ? JSON.stringify(ai).slice(0, 500) : "",
      auto ? "actioned" : "pending",
      auto ? now : null,
      auto ? "ai" : ""
    ).run().catch(() => null);

    const flagId = ins && ins.meta && ins.meta.last_row_id ? Number(ins.meta.last_row_id) : 0;
    if (auto) {
      try {
        await hubBroadcast(env, { type: "automod:reviewed", flagId, action: "remove", status: "actioned" });
      } catch (_) {}
    }
    return {
      action, flagId, category: final.category, severity: final.severity,
      confidence: final.confidence, ai, detail: final.detail,
    };
  } catch (_) {
    return { action: "allow", category: "clean", severity: "low", confidence: 0 };
  }
}

/* Tell the author what happened, without failing the surrounding request. */
export async function notifyModeration(db, env, uid, message, href, data) {
  if (!uid) return;
  try {
    await db.prepare(
      "INSERT INTO notifications (uid, type, message, href, post_id, data, actor) VALUES (?, 'moderation', ?, ?, ?, ?, 'Automated moderation')"
    ).bind(uid, String(message).slice(0, 200), String(href || "").slice(0, 200),
      String(data || "").slice(0, 80), String(data || "").slice(0, 40)).run();
  } catch (_) {}
}

/* The same removal shapes the staff queue uses, driven by an AI verdict.
   Kept here so an auto-action is identical to a human choosing "remove". */
export async function removeContent(db, env, targetType, targetId) {
  const t = Number(targetId) || 0;
  if (!t) return false;
  const type = String(targetType || "").toLowerCase();
  try {
    if (type === "reply") {
      const r = await db.prepare("SELECT id, post_id FROM community_replies WHERE id = ?").bind(t).first().catch(() => null);
      await db.prepare("UPDATE community_replies SET parent_id = NULL WHERE parent_id = ?").bind(t).run().catch(() => null);
      await db.prepare("DELETE FROM community_reactions WHERE reply_id = ?").bind(t).run().catch(() => null);
      await db.prepare("DELETE FROM community_notifications WHERE reply_id = ?").bind(t).run().catch(() => null);
      await db.prepare("DELETE FROM community_replies WHERE id = ?").bind(t).run().catch(() => null);
      await hubBroadcast(env, { type: "reply:deleted", replyId: t, postId: r ? r.post_id : null, conversationId: "post-" + (r ? r.post_id : 0) });
    } else if (type === "post") {
      const kids = await db.prepare("SELECT id FROM community_replies WHERE post_id = ?").bind(t).all().catch(() => null);
      for (const k of (kids && kids.results ? kids.results : [])) {
        await db.prepare("DELETE FROM community_reactions WHERE reply_id = ?").bind(k.id).run().catch(() => null);
        await hubBroadcast(env, { type: "reply:deleted", replyId: k.id, postId: t, conversationId: "post-" + t });
      }
      await db.prepare("DELETE FROM community_replies WHERE post_id = ?").bind(t).run().catch(() => null);
      await db.prepare("DELETE FROM community_reactions WHERE post_id = ?").bind(t).run().catch(() => null);
      await db.prepare("DELETE FROM community_notifications WHERE post_id = ?").bind(t).run().catch(() => null);
      await db.prepare("DELETE FROM community_posts WHERE id = ?").bind(t).run().catch(() => null);
      await hubBroadcast(env, { type: "post:deleted", postId: t });
    } else if (type === "suggestion") {
      await db.prepare("DELETE FROM suggestion_votes WHERE suggestion_id = ?").bind(t).run().catch(() => null);
      await db.prepare("DELETE FROM suggestion_comments WHERE suggestion_id = ?").bind(t).run().catch(() => null);
      await db.prepare("DELETE FROM notifications WHERE post_id = ?").bind(String(t)).run().catch(() => null);
      await db.prepare("DELETE FROM suggestions_v2 WHERE id = ?").bind(t).run().catch(() => null);
      await hubBroadcast(env, { type: "suggestion:deleted", suggestionId: t });
    } else if (type === "suggestion_comment") {
      const c = await db.prepare("SELECT suggestion_id FROM suggestion_comments WHERE id = ?").bind(t).first().catch(() => null);
      if (!c) return false;
      await db.prepare("UPDATE suggestion_comments SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), body = '' WHERE id = ?").bind(t).run().catch(() => null);
      await hubBroadcast(env, { type: "suggestion:comment", suggestionId: c.suggestion_id });
    } else if (type === "wanted") {
      await db.prepare("DELETE FROM wanted_posts WHERE id = ?").bind(t).run().catch(() => null);
      await hubBroadcast(env, { type: "wanted:deleted", postId: t });
    } else if (type === "wanted_reply") {
      const r = await db.prepare("SELECT track_id FROM replies WHERE id = ?").bind(t).first().catch(() => null);
      await db.prepare("UPDATE replies SET parent_id = NULL WHERE parent_id = ?").bind(t).run().catch(() => null);
      await db.prepare("DELETE FROM notifications WHERE reply_id = ?").bind(t).run().catch(() => null);
      await db.prepare("DELETE FROM reply_votes WHERE reply_id = ?").bind(t).run().catch(() => null);
      await db.prepare("DELETE FROM replies WHERE id = ?").bind(t).run().catch(() => null);
      await hubBroadcast(env, { type: "reply:deleted", replyId: t, postId: null, conversationId: r ? r.track_id : null });
    } else if (type === "dm_message") {
      const m = await db.prepare("SELECT conversation_id FROM dm_messages WHERE id = ?").bind(t).first().catch(() => null);
      if (!m) return false;
      await db.prepare(
        "UPDATE dm_messages SET body = '', sticker = '', track_title = '', track_artist = '', deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?"
      ).bind(t).run().catch(() => null);
      await db.prepare("UPDATE dm_attachments SET data = NULL WHERE message_id = ?").bind(t).run().catch(() => null);
      await db.prepare("DELETE FROM dm_message_reactions WHERE message_id = ?").bind(t).run().catch(() => null);
      await hubBroadcast(env, { type: "social:message", conversationId: m.conversation_id, messageId: t });
    } else {
      return false;
    }
    return true;
  } catch (_) {
    return false;
  }
}
