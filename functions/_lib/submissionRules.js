// Submission rules for the three user-generated surfaces: Suggestions, the
// Wanted Vault, and the Gallery.
//
// Policy (matches the automod stance in _lib/automod.js): rules FLAG for human
// review, they never auto-reject and never auto-ban. A violation records a
// pending automod_flags row and notifies the author; the author still sees their
// own submission, and a staff member decides in the automod queue.
//
// The rule TEXT here is the single source of truth: the API serves it to
// submission-rules-ui.js, so what the tabs display is exactly what is enforced.
// Rules marked automated:true are machine-checked on submit/edit; the rest are
// review-only (a human decides) and are displayed so people know the standard.

const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/;
const URL_RE = /\b(?:https?:\/\/|www\.)\S+/i;
const BARE_DOMAIN_RE = /\b[\w-]+\.(?:com|net|org|io|gg|co|me|xyz|link|top|shop|store|video)\b\S*/i;
const PHONE_RE = /(?:\+?\d[\s().-]?){9,}\d/;
const DISCORD_RE = /\b(?:discord\.gg\/|discord\.com\/invite|\bdsc\b|dmd me|dm me|add me (?:on|in)|my (?:discord|ig|insta|tiktok|twitch|yt) (?:is|=|:) )/i;
const HANDLE_RE = /(?:^|\W)@[A-Za-z0-9_]{3,32}/;
const OFF_PLATFORM_RE = /\b(?:telegram|telegram me|whatsapp|signal app|onlyfans|cashapp|cash app|venmo|patreon|ko-?fi)\b/i;
const REPEAT_CHAR_RE = /(.)\1{5,}/;
const PROMO_RE = /\b(?:use code|code \w+ ?% ?off|discount code|promo code|follow me (?:on|at)|sub (?:to|for) me|check out my|link in (?:my )?bio)\b/i;
const WATERMARK_RE = /\b(?:watermark|©|\(c\)\s?\d{4})\b/i;
const TRADE_RE = /\b(?:free download|download (?:it )?(?:here|link)|link in bio|buy (?:me )?(?:the )?(?:album|track|mp3)|spotify playlist|selling|dm for|click (?:the )?link|external link|boost (?:it|my)|promo code)\b|\btrade\b[^.!?\n]{0,30}\bfor\b|\btrading\b/i;
const ABUSIVE_RE = /\b(?:kys|kill yourself|go die|you should die|you deserve to die|hang yourself|n-word|terrorist)\b/i;
const SHORT_BODY = 25;

function text(...parts) {
  return parts.map((p) => String(p == null ? "" : p)).join("\n");
}

function has(re, s) {
  try { return re.test(s); } catch (_) { return false; }
}

// Contact details and off-platform handles: the single highest-value rule on
// all three tabs, because they move users into unmoderated DMs.
function contactViolation(s) {
  if (has(EMAIL_RE, s)) return "email address";
  if (has(PHONE_RE, s)) return "phone number";
  if (has(DISCORD_RE, s)) return "Discord/off-platform invite";
  if (has(OFF_PLATFORM_RE, s)) return "off-platform payment/messaging app";
  if (has(HANDLE_RE, s)) return "social handle";
  return null;
}

function linkViolation(s) {
  if (has(URL_RE, s)) return "link";
  if (has(BARE_DOMAIN_RE, s)) return "bare domain";
  return null;
}

// ---- shared across all three surfaces -------------------------------------
const COMMON = [
  {
    code: "contact_info", severity: "high", automated: true,
    text: "No email addresses, phone numbers, or off-platform handles (Discord, Instagram, TikTok, Telegram, Cash App, and similar).",
  },
  {
    code: "external_links", severity: "medium", automated: true,
    text: "No links to download pages, streams, or other sites.",
  },
  {
    code: "abusive", severity: "high", automated: true,
    text: "No harassment, slurs, or hateful content aimed at anyone.",
  },
  {
    code: "shouting", severity: "medium", automated: true,
    text: "Don't write in all caps.",
  },
  {
    code: "repetition", severity: "low", automated: true,
    text: "No repeated-character or repeated-keyword filler.",
  },
];

// ---- per-surface rules ----------------------------------------------------
const SURFACES = {
  suggestions: {
    title: "Suggestions",
    targetType: "suggestion",
    intro: "Suggestions are for fixes and ideas that improve the site. Staff read every one; a linked Discord account is required to post.",
    requirements: [
      "One idea per suggestion — post separate ideas separately.",
      "Describe the problem specifically so it can be acted on.",
      "Search the board first; add a vote to an existing suggestion instead of reposting it.",
      "Don't request leaked or unreleased audio.",
    ],
    rules: [
      ...COMMON,
      { code: "be_specific", severity: "low", automated: true, text: "Give a real description, not just a title." },
      { code: "not_a_track_request", severity: "low", automated: false, text: "Song requests belong in the Wanted Vault, not here." },
      { code: "not_a_support_ticket", severity: "low", automated: false, text: "Bug reports go to support, not here — this board is for site features." },
    ],
  },
  wanted: {
    title: "Wanted Vault",
    targetType: "wanted",
    intro: "The vault tracks unreleased Juice WRLD material — sessions, snippets, and anything not on streaming. Request what is missing, and discuss individual tracks in the threads.",
    requirements: [
      "Juice WRLD only — the vault is for his unreleased and session material.",
      "Title the post with the track name.",
      "Search the vault before posting; vote the existing entry instead of duplicating it.",
      "A linked Discord account is required to post a request or comment.",
    ],
    rules: [
      ...COMMON,
      { code: "no_trade_pitches", severity: "high", automated: true, text: "No download links, trade offers, playlist drops, or selling in the discussion." },
      { code: "juice_wrld_only", severity: "medium", automated: false, text: "Requests must be for Juice WRLD material, not other artists." },
      { code: "be_specific", severity: "low", automated: true, text: "Say which session, era, or source the track comes from." },
      { code: "no_scam_threads", severity: "high", automated: false, text: "No trading, selling, or free-download offers in the discussion." },
    ],
  },
  gallery: {
    title: "Gallery",
    targetType: "gallery",
    intro: "Fan art and community images. Every upload is reviewed by staff before it appears, so nothing is published instantly.",
    requirements: [
      "Upload art you made yourself, or credit the original artist in the caption.",
      "Credit is required for fan art of the artist.",
      "JPEG, PNG, GIF, or WebP. Images are resized in the browser and must land under 800KB.",
      "No NSFW, graphic, or shocking imagery.",
    ],
    limits: [
      "Up to 10 submissions per day.",
      "800KB maximum per image after the browser resize.",
      "Files are checked by type, not by extension.",
    ],
    rules: [
      ...COMMON,
      { code: "own_or_credited", severity: "high", automated: false, text: "Only upload art you made, or credit the original artist in the caption." },
      { code: "no_nsfw", severity: "high", automated: false, text: "No NSFW, graphic, or shocking imagery." },
      { code: "no_watermarks_or_handles", severity: "medium", automated: true, text: "No watermarks, promo codes, or social handles in the caption." },
      { code: "no_impersonation", severity: "high", automated: false, text: "Nothing that impersonates the artist, staff, or another member." },
    ],
  },
};

export const SURFACE_KEYS = Object.keys(SURFACES);

// Description block for the automod queue, so a reviewer sees which ruleset
// fired without opening the code.
export function ruleSetSummary(surface) {
  const s = SURFACES[surface];
  if (!s) return "";
  return s.title + " rules: " + s.rules.map((r) => r.code).join(", ");
}

// Machine-check a submission. Returns [{code, severity, detail}] — empty when
// the submission is clean. Pure: no I/O, no throwing, so it is unit-testable.
export function evaluateSurfaceRules(surface, fields) {
  const s = SURFACES[surface];
  if (!s) return [];
  const f = fields || {};
  const body = text(f.title, f.description, f.caption, f.altName, f.era);
  const out = [];
  const add = (code) => {
    const rule = s.rules.find((r) => r.code === code);
    if (!rule || !rule.automated) return;
    out.push({ code, severity: rule.severity, detail: rule.text });
  };

  const contact = contactViolation(body);
  if (contact) {
    for (const r of s.rules) {
      if (r.code !== "contact_info") continue;
      out.push({ code: "contact_info", severity: r.severity, detail: "Contains " + contact });
    }
  }
  if (linkViolation(body)) add("external_links");
  if (has(ABUSIVE_RE, body)) add("abusive");
  if (has(REPEAT_CHAR_RE, body)) add("repetition");

  const letters = body.replace(/[^A-Za-z]/g, "");
  if (letters.length >= 20) {
    const caps = letters.replace(/[^A-Z]/g, "").length / letters.length;
    if (caps >= 0.8) add("shouting");
  }

  if (surface === "wanted") {
    if (has(TRADE_RE, body)) add("no_trade_pitches");
  }

  if (surface === "gallery") {
    if (has(PROMO_RE, body) || has(WATERMARK_RE, body)) add("no_watermarks_or_handles");
  }

  // Vague one-liners are poor suggestions/requests even when nothing else fires.
  // Only real strings count: a missing or non-string field must not stringify
  // to "undefined"/"[object Object]" and trip the length check. (Callers pass
  // strings already; this keeps the helper honest on its own.)
  const descRaw = f.description != null ? f.description : f.caption;
  const desc = typeof descRaw === "string" ? descRaw.trim() : "";
  if (desc && desc.length < SHORT_BODY) add("be_specific");

  // De-dup codes while keeping first-seen order.
  const seen = new Set();
  return out.filter((v) => (seen.has(v.code) ? false : (seen.add(v.code), true)));
}

// Record a surface-rule violation into the same automod queue the rest of the
// site uses, so staff review everything in one place. status 'pending' +
// recommended_action 'review'; nothing is actioned automatically.
//
// Follows the staged policy documented in _lib/automod.js: low -> allow with no
// record, medium/high -> flag. Without this, a plain title-only wanted request
// ("add this song") would write a queue row for every submission and the queue
// would stop being worth reading.
export async function recordRuleFlags(db, { surface, targetId, uid, violations }) {
  const s = SURFACES[surface];
  const list = (violations || []).filter((v) => v && v.code);
  if (!s || !list.length) return null;
  const severity = list.some((v) => v.severity === "high") ? "high"
    : list.some((v) => v.severity === "medium") ? "medium" : "low";
  if (severity === "low") return null;
  const detail = list.map((v) => v.code + ": " + v.detail).join(" | ").slice(0, 200);
  try {
    const ins = await db.prepare(
      "INSERT INTO automod_flags (target_type, target_id, uid, category, confidence, severity, recommended_action, detail, ai_verdict, status) " +
      "VALUES (?, ?, ?, ?, ?, ?, 'review', ?, '', 'pending')"
    ).bind(s.targetType, String(targetId || "").slice(0, 40), String(uid || "").slice(0, 40),
      s.targetType + "_rule", 0.9, severity, detail).run();
    return { id: ins && ins.meta ? Number(ins.meta.last_row_id) : 0, severity, codes: list.map((v) => v.code) };
  } catch (_) {
    return null;
  }
}

// Payload for /api/submission-rules: the displayed rules and requirements,
// straight from the same definitions the enforcement path uses.
export function publicRuleSet() {
  const out = {};
  for (const key of SURFACE_KEYS) {
    const s = SURFACES[key];
    out[key] = {
      title: s.title,
      intro: s.intro,
      requirements: s.requirements,
      limits: s.limits || [],
      rules: s.rules.map((r) => ({ code: r.code, text: r.text, severity: r.severity, automated: !!r.automated })),
    };
  }
  return out;
}
