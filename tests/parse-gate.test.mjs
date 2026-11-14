// PARSE GATE
//
// This exists because sw.js shipped six times with a syntax error inside its
// PRECACHE array - stray "(" characters injected by a token-bump helper of mine.
// The worker could not parse, register() rejected, no worker ever activated, and
// navigator.serviceWorker.ready stayed pending forever. The push panel then showed
// "the offline app is still starting" on the phone, at a 5 second timeout and then
// again at 30.
//
// The whole test suite was green throughout. crypto, push-api and notifications all
// passed while the service worker could not be parsed by the runtime, because no
// test parsed it. The run-all.mjs header even lists "serviceWorker.ready never
// settling" as a bug worth testing for, while nothing checked that sw.js is valid
// JavaScript.
//
// So: parse every script the page and the worker load, offline, with no server and
// no network. A file that does not parse fails the build here rather than on a
// user's phone.

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// sw.js first and separately: it is loaded by the browser, not by the page, and it
// is the one file whose failure is invisible from the UI.
const SW = join(ROOT, "sw.js");

function parses(file) {
  try {
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
    return { ok: true };
  } catch (e) {
    const msg = String((e.stderr || "") + (e.stdout || "")).split("\n").slice(0, 4).join(" ").trim();
    return { ok: false, msg };
  }
}

let failures = 0;

/* ---- 1. the service worker ---- */
if (!existsSync(SW)) {
  console.log("  FAIL  sw.js is missing");
  failures++;
} else {
  const r = parses(SW);
  if (r.ok) {
    console.log("  PASS  sw.js parses");
  } else {
    console.log("  FAIL  sw.js does not parse: " + r.msg);
    failures++;
  }

  // A parseable worker can still be a worker whose PRECACHE array is malformed by a
  // string edit - "(./foo.js'," parses as a parenthesised expression only in some
  // contexts and is almost always a mistake inside an array literal. Catch it here,
  // where the message can be specific, rather than letting it break registration.
  const src = readFileSync(SW, "utf8");
  const s = src.indexOf("const PRECACHE = [");
  const e = src.indexOf("];", s);
  const bad = s === -1 ? [] : [...src.slice(s, e).matchAll(/^\s*\(+'/gm)];
  if (bad.length) {
    console.log(`  FAIL  sw.js PRECACHE has ${bad.length} malformed entr(y/ies) - a "(" before the quote`);
    failures++;
  } else {
    console.log("  PASS  sw.js PRECACHE entries are well-formed");
  }
}

/* ---- 2. every script the page loads ---- */
const html = readFileSync(join(ROOT, "index.html"), "utf8");
const refs = new Set();
for (const m of html.matchAll(/<script[^>]*\ssrc=["']([^"']+)["']/gi)) {
  refs.add(m[1].replace(/^\.\//, "").split("?")[0]);
}
for (const m of html.matchAll(/<link[^>]*\srel=["']?stylesheet["']?[^>]*href=["']([^"']+)["']/gi)) {
  refs.add(m[1].replace(/^\.\//, "").split("?")[0]);
}
// social.css is injected at runtime by social-panel.js, so it is never in the HTML
refs.add("social.css");

const js = [...refs].filter((f) => f.endsWith(".js") && existsSync(join(ROOT, f))).sort();
let jsBad = 0;
for (const f of js) {
  const r = parses(join(ROOT, f));
  if (!r.ok) {
    console.log("  FAIL  " + f + " does not parse: " + r.msg);
    jsBad++;
  }
}
if (jsBad === 0) console.log(`  PASS  ${js.length} page scripts parse`);
failures += jsBad;

/* ---- 3. index.html has not lost an element boundary ----
 *
 * Added after a surgical edit to the About page ate the `<div ` in front of
 * `id="page-section-partner"`. The page still parsed, every script still
 * executed, and every count-based check still passed - but the partner section's
 * opening tag became an empty <div></div>, so its attributes rendered as visible
 * text on the page and its contents, including a second copy of the nav bar,
 * were hoisted into the About page.
 *
 * It survived three commits because the page was rendering unstyled at the time,
 * so it was invisible, and because the browser check that would have caught it
 * could not run.
 *
 * A JS parse gate cannot see this class of bug. It is an HTML structure problem,
 * and it is cheap to check, so it is checked. */
const boundary = /(?<!<div )id="page-section-[a-z]+" class="app-page"/g;
const leaked = [...html.matchAll(boundary)].map((m) => m[0]);
if (leaked.length) {
  for (const l of leaked) console.log("  FAIL  element boundary lost, attributes will render as text: " + l);
  failures += leaked.length;
} else {
  console.log("  PASS  every page section keeps its opening tag");
}

/* ---- 4. the About tab split did not bury any page section ----
 *
 * The guard above catches a lost opening tag. This catches the other failure the
 * same edit produced, which is quieter still.
 *
 * Wrapping the About body meant the body's own trailing `</div>` - the one closing
 * .abp-page - ended up inside the new wrapper, so that close was consumed by the
 * wrapper instead. Two divs were then left open: page-section-about never closed,
 * and so page-section-partner and page-section-roadmap became its children.
 *
 * switchAppPage() shows its target with `display: block !important` and hides
 * every other `.app-page`. A section nested inside another one cannot be shown,
 * because its ancestor is display:none no matter what is set on the child. So
 * both pages rendered as a blank panel with the nav bar visible and no error in
 * any console - which is exactly what was reported.
 *
 * Content counts cannot see this, so the About block is compared against the
 * commit before any tab work, and every page section is checked for being a
 * top-level element. */
const BASELINE_REV = "870ebbe";
let structureFailures = 0;
const structureFail = (m) => { console.log("  FAIL  " + m); structureFailures++; };
const structureOk = (m) => console.log("  PASS  " + m);

const aboutBlockOf = (src) => {
  const s = src.indexOf('<div class="abp-page">');
  if (s < 0) return null;
  const e = src.indexOf('id="page-section-partner"', s);
  return e < 0 ? null : src.slice(s, e);
};

/* Reading the baseline needs that object in the local clone, and actions/checkout
 * defaults to fetch-depth 1, where it is not. `git show` then fails with "invalid
 * object name", and because the read was unguarded that exception took the whole
 * gate - and with it the deploy - down. The object is fetched if it is missing; if
 * even that fails the comparison is skipped loudly rather than failing a deploy
 * over a limitation of the environment rather than a defect in the page. */
const readBaselineIndex = () => {
  const read = () =>
    execFileSync("git", ["show", `${BASELINE_REV}:index.html`], {
      maxBuffer: 64 * 1024 * 1024,
    }).toString("utf8");
  try {
    return { html: read(), ok: true };
  } catch (_) {
    for (const args of [["fetch", "--deepen", "200"], ["fetch", "origin", BASELINE_REV, "--depth=1"]]) {
      try { execFileSync("git", args, { stdio: "ignore" }); } catch (__) {}
    }
    try {
      return { html: read(), ok: true };
    } catch (e) {
      const last = String(e.stderr || e.message || e).trim().split(/\r?\n/).pop();
      return { html: null, ok: false, error: last };
    }
  }
};

const curAbout = aboutBlockOf(html);
const baseline = readBaselineIndex();
const baseAbout = baseline.ok ? aboutBlockOf(baseline.html) : null;

if (!curAbout || (baseline.ok && !baseAbout)) {
  structureFail("could not isolate the About block (needs '<div class=\"abp-page\">' then page-section-partner)");
} else if (!baseline.ok) {
  console.log(`  SKIP  About content comparison - ${BASELINE_REV} is not in this clone`);
  console.log(`        ${baseline.error}`);
  console.log("        Checkout with fetch-depth: 0 for this guard to run here.");
} else {
  /* The About block must match the baseline exactly.

     It used not to. The Info tab added two sections and four jump links, and
     this guard existed to prove that edit had not eaten or duplicated anything
     else while doing it. The tab is gone, so every delta is zero and the check
     is now a plain "the About page is unchanged" - a stronger guarantee than the
     old one, because a future edit that adds or removes any of these patterns
     has to move the number here rather than quietly reshaping the page. */
  const expectedDelta = [
    ['<section class="abp-sec"', 0],
    ['class="abp-social"', 0],
    ['releases/download/v1\\.0\\.1', 0],
    ['class="abp-card-top abp-link"', 0],
  ];
  let contentOk = true;
  for (const [pat, delta] of expectedDelta) {
    const re = new RegExp(pat, "g");
    const base = (baseAbout.match(re) || []).length;
    const cur = (curAbout.match(re) || []).length;
    if (cur !== base + delta) {
      structureFail(`About content ${pat} is ${cur}, expected ${base + delta} (baseline ${base})`);
      contentOk = false;
    }
  }
  if (contentOk) structureOk(`About block keeps its content (${expectedDelta.length} patterns vs ${BASELINE_REV})`);
}

/* A duplicate id makes getElementById return the first match, so the second copy
   silently stops being wired to its tab or its script. */
const idCounts = new Map();
for (const mm of html.matchAll(/id="([a-z][a-z0-9-]*)"/g)) {
  idCounts.set(mm[1], (idCounts.get(mm[1]) || 0) + 1);
}
const dupes = [...idCounts.entries()].filter(([, n]) => n > 1);
if (dupes.length) {
  for (const [id, n] of dupes) structureFail(`id "${id}" appears ${n} times`);
} else {
  structureOk(`${idCounts.size} ids, all unique`);
}

/* ---- the notification preferences panel is wired to the server it talks to ----
 *
 * The panel, the account page's list of switches and the server's allowlist all
 * name the same nine categories. Any of them drifting apart is a switch that
 * saves nothing, or a setting that is stored and never shown - and neither
 * shows up as an error. The page just quietly does the wrong thing.
 *
 * The strings are checked too, because a new key that only exists in English
 * is a new key that reads in English for two thirds of the people who use the
 * site. */
{
  const accountJs = readFileSync(join(ROOT, "account.js"), "utf8");
  const settingsApi = readFileSync(join(ROOT, "functions/api/notification-settings.js"), "utf8");
  const i18nSrc = readFileSync(join(ROOT, "i18n.js"), "utf8");

  const fieldsM = /var NOTIF_PREF_FIELDS = \[([\s\S]*?)\];/.exec(accountJs);
  const pairs = fieldsM
    ? [...fieldsM[1].matchAll(/\["([a-z_]+)",\s*"([A-Za-z0-9_]+)"\]/g)].map((x) => ({ key: x[1], id: x[2] }))
    : [];
  const colsM = /const COLUMNS = \[([\s\S]*?)\];/.exec(settingsApi);
  const apiKeys = colsM ? [...colsM[1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]) : [];
  const jsKeys = pairs.map((p) => p.key);

  // The switch ids in the page, minus the save button and the result line,
  // which share the prefix but are not switches.
  const pageIds = [...html.matchAll(/id="(notifPref[A-Za-z]+)"/g)]
    .map((x) => x[1])
    .filter((id) => !/^notifPrefs(SaveBtn|Result)$/.test(id));
  const jsIds = pairs.map((p) => p.id);

  if (!fieldsM) structureFail("the account page has no NOTIF_PREF_FIELDS list");
  else if (!colsM) structureFail("the notification settings API has no COLUMNS allowlist");
  else {
    if (jsKeys.length !== 9) structureFail(`the account page lists ${jsKeys.length} categories, expected 9`);
    else structureOk("the account page lists nine notification categories");
    if (apiKeys.length !== jsKeys.length) {
      structureFail(`the server allows ${apiKeys.length} categories and the page shows ${jsKeys.length}`);
    } else {
      const drift = jsKeys.filter((k) => !apiKeys.includes(k)).concat(apiKeys.filter((k) => !jsKeys.includes(k)));
      if (drift.length) structureFail(`the page and the server name different categories: ${drift.join(", ")}`);
      else structureOk("the page and the server name the same nine categories");
    }
    const missingIds = jsIds.filter((id) => !pageIds.includes(id));
    const strayIds = pageIds.filter((id) => !jsIds.includes(id));
    if (missingIds.length) structureFail(`switches with no id in the page: ${missingIds.join(", ")}`);
    if (strayIds.length) structureFail(`switches in the page that nothing is wired to: ${strayIds.join(", ")}`);
    if (!missingIds.length && !strayIds.length) structureOk("every switch in the page is wired to a category");
  }

  if (!/id="notifPrefsSaveBtn"/.test(html)) structureFail("the panel has no save button");
  if (!/getElementById\("notifPrefsSaveBtn"\)/.test(accountJs)) structureFail("the save button is never bound");
  if (!/\/api\/notification-settings/.test(accountJs)) structureFail("the panel never talks to the settings endpoint");
  if (!/id="notifPrefsResult"/.test(html)) structureFail("the panel has no result line");

  /* A read that fails must not leave the switches in a state that would
   * silently mute everything.
   *
   * The server's default for every category is ON, so the page must ship them
   * on: the read then corrects them to whatever is actually stored. Shipping
   * them off means a failed read - or a save pressed before the read lands -
   * turns nine categories off and says so with a cheerful "Settings saved". */
  const notifLib = readFileSync(join(ROOT, "functions/_lib/notifications.js"), "utf8");
  const defaultsM = /const defaults = \{([\s\S]*?)\};/.exec(notifLib);
  const serverDefaults = defaultsM
    ? Object.fromEntries([...defaultsM[1].matchAll(/([a-z_]+):\s*([01])/g)].map((x) => [x[1], Number(x[2])]))
    : {};
  const offByDefault = Object.entries(serverDefaults)
    .filter(([, v]) => v === 0)
    .map(([k]) => k);
  if (offByDefault.length) {
    structureFail(`the server defaults these categories off, so the page must not ship them on: ${offByDefault.join(", ")}`);
  } else if (defaultsM) {
    const unchecked = [];
    for (const id of pageIds) {
      const m = new RegExp('id="' + id + '"[^>]*').exec(html);
      if (!m || !/ checked/.test(m[0])) unchecked.push(id);
    }
    if (unchecked.length) {
      structureFail(`switches that ship off, although the server's default is on: ${unchecked.join(", ")}`);
    } else {
      structureOk("every switch ships on, which is the server's default");
    }
  }

  const NEW_KEYS = [
    "notifPrefsSub", "notifGroupEvents", "notifGroupDelivery",
    "notifReplies", "notifRepliesSub", "notifWantedReplies", "notifWantedRepliesSub",
    "notifMentions", "notifMentionsSub", "notifUpvotes", "notifUpvotesSub",
    "notifDirectMessages", "notifDirectMessagesSub", "notifFriendRequests",
    "notifFriendRequestsSub", "notifInSite", "notifInSiteSub", "notifPush",
    "notifPushSub", "notifPreviews", "notifPreviewsSub", "notifPrefsFailed",
  ];
  const langBlocks = [];
  const langStarts = [...i18nSrc.matchAll(/^ {2}([a-z]{2}(?:-[a-z]{2})?): \{/gm)];
  for (let i = 0; i < langStarts.length; i++) {
    const from = i18nSrc.indexOf("{", langStarts[i].index);
    let depth = 0, end = from;
    for (let j = from; j < i18nSrc.length; j++) {
      if (i18nSrc[j] === "{") depth++;
      else if (i18nSrc[j] === "}") { depth--; if (depth === 0) { end = j; break; } }
    }
    langBlocks.push(i18nSrc.slice(langStarts[i].index, end));
  }
  const gaps = [];
  for (const b of langBlocks) {
    for (const k of NEW_KEYS) {
      if (!new RegExp("(?:^|[\\s{,])" + k + ":").test(b)) gaps.push(k);
    }
  }
  if (gaps.length) structureFail(`${gaps.length} notification strings are missing from some languages`);
  else structureOk(`all ${NEW_KEYS.length} notification strings are in all ${langBlocks.length} languages`);

  const used = new Set([...html.matchAll(/data-i18n="(notif[A-Za-z]+)"/g)].map((x) => x[1]));
  const unused = NEW_KEYS.filter((k) => !used.has(k) && k !== "notifPrefsFailed");
  if (unused.length) structureFail(`notification strings nothing on the page uses: ${unused.join(", ")}`);
  else structureOk("every notification string on the page is used by the page");
}

/* ---- every theme ends up with the gradients the site uses ----
 *
 * A theme that leaves a gradient variable undefined does not merely lose a
 * colour: the rule that uses it keeps every other declaration, including
 * color:#201000, which is near-black. The Owner Dashboard's Unlock button was
 * therefore near-black text with no background on a near-black panel, on
 * twenty-eight of the thirty-two themes - a button that looked like a hole in
 * the page, and was reported as a passcode that would not work.
 *
 * The fallback rule has to stay, and it has to be zero-specificity so a theme
 * that does define its own gradient keeps it. */
{
  const themesCss = readFileSync(join(ROOT, "themes.css"), "utf8");
  const themeBlocks = [...themesCss.matchAll(/html\[data-theme=([a-z0-9-]+)\]\s*\{([\s\S]*?)\}/g)];

  const gradUsed = new Set();
  for (const f of ["account.css", "style.css", "player-settings.css", "themes.css", "social.css"]) {
    const src = readFileSync(join(ROOT, f), "utf8");
    for (const m of src.matchAll(/var\((--ac-grad-[a-z]+)/g)) gradUsed.add(m[1]);
  }

  const fallbackM = /html:where\(\[data-theme\]\)\s*\{([\s\S]*?)\}/.exec(themesCss);
  if (!fallbackM) {
    structureFail("themes.css has no zero-specificity fallback for the gradient variables");
  } else {
    const fallback = fallbackM[1];
    const stillMissing = [];
    for (const [, name, body] of themeBlocks) {
      for (const v of gradUsed) {
        const defined = new RegExp(v.replace(/-/g, "\\-") + "\\s*:").test(body);
        const covered = new RegExp(v.replace(/-/g, "\\-") + "\\s*:").test(fallback);
        if (!defined && !covered) stillMissing.push(name + ":" + v);
      }
    }
    if (stillMissing.length) {
      structureFail(`${stillMissing.length} themes would end up with no gradient at all: ${stillMissing.slice(0, 6).join(", ")}`);
    } else {
      structureOk(`every one of the ${themeBlocks.length} themes ends up with all ${gradUsed.size} gradients`);
    }
  }
}

/* ---- every theme is on every list that has to agree ----
 *
 * A theme is named in four places: the THEMES table in account.js (the name a
 * member sees), the picker markup in index.html - the settings page, which is
 * the only picker now that the footer's copy is gone - the CSS block that
 * draws it, and the server's allowlist that decides whether a save sticks.
 * Missing from any one of them, a theme still half works, which is worse
 * than not shipping: it can be applied and then cannot be named, or cannot
 * be saved, or renders as the default palette with no error anywhere.
 *
 * The seasonal eight carry a fifth detail - a SEASONAL entry saying when they
 * are offered - and that table is checked against the ids the picker actually
 * marks data-seasonal, so a season added to one file and not the other fails
 * here rather than in July. */
{
  const acct = readFileSync(join(ROOT, "account.js"), "utf8");
  const apiSrc = readFileSync(join(ROOT, "functions", "api", "account", "index.js"), "utf8");
  const page = readFileSync(join(ROOT, "index.html"), "utf8");
  const themesCss = readFileSync(join(ROOT, "themes.css"), "utf8");

  const idsIn = (src, re) => [...src.matchAll(re)].map((m) => m[1]);

  const themesBlock = /var THEMES = \[([\s\S]*?)\n  \];/.exec(acct);
  const themeIds = themesBlock ? idsIn(themesBlock[1], /\["([a-z0-9-]+)"/g) : [];
  const allowBlock = /KNOWN_THEMES = \[([\s\S]*?)\];/.exec(apiSrc);
  const allowIds = allowBlock ? idsIn(allowBlock[1], /"([a-z0-9-]+)"/g) : [];
  const seasonalBlock = /var SEASONAL = \[([\s\S]*?)\n  \];/.exec(acct);
  const seasonalIds = seasonalBlock ? idsIn(seasonalBlock[1], /id: "([a-z0-9-]+)"/g) : [];

  if (!themeIds.length) {
    structureFail("account.js THEMES could not be read, nothing else here can be trusted");
  } else {
    const missingAllow = themeIds.filter((id) => !allowIds.includes(id));
    const strayAllow = allowIds.filter((id) => !themeIds.includes(id));
    if (!allowBlock) structureFail("the server's KNOWN_THEMES allowlist could not be read");
    else if (missingAllow.length || strayAllow.length) {
      structureFail(`THEMES and the server allowlist disagree: ${[...missingAllow, ...strayAllow].slice(0, 6).join(", ")}`);
    } else {
      structureOk(`the server accepts exactly the ${themeIds.length} themes the picker offers`);
    }

    const cssless = themeIds.filter((id) => !new RegExp("html\\[data-theme=" + id.replace(/-/g, "\\-") + "\\]\\s*\\{").test(themesCss));
    if (cssless.length) structureFail(`themes with no CSS block of their own: ${cssless.join(", ")}`);
    else structureOk(`all ${themeIds.length} themes have a CSS block`);

    /* The picker, by extracting the <select> and looking inside it - a bare
       search for value="default" would also match the mode picker. */
    const pickerOptions = (id) => {
      const m = new RegExp('<select id="' + id + '"[^>]*>([\\s\\S]*?)</select>').exec(page);
      return m ? new Set(idsIn(m[1], /<option value="([a-z0-9-]+)"/g)) : null;
    };
    const optionless = [];
    for (const id of themeIds) {
      for (const picker of ["setTheme"]) {
        const opts = pickerOptions(picker);
        if (!opts) { structureFail(`index.html has no #${picker} select`); break; }
        if (!opts.has(id)) optionless.push(`${id} not in #${picker}`);
      }
    }
    if (optionless.length) structureFail(`themes missing from a picker: ${optionless.slice(0, 6).join(", ")}`);
    else structureOk(`all ${themeIds.length} themes are offered by the picker`);

    if (!seasonalBlock) structureFail("account.js SEASONAL table could not be read");
    else {
      const unknown = seasonalIds.filter((id) => !themeIds.includes(id));
      const unseasoned = themeIds.filter((id) => {
        const marked = idsIn(page, new RegExp('data-seasonal="' + id.replace(/-/g, "\\-") + '"', "g"));
        return seasonalIds.includes(id) ? marked.length !== 1 : marked.length !== 0;
      });
      if (unknown.length) structureFail(`seasonal themes not in THEMES: ${unknown.join(", ")}`);
      else if (unseasoned.length) structureFail(`data-seasonal and SEASONAL disagree: ${unseasoned.join(", ")}`);
      else structureOk(`${seasonalIds.length} seasonal themes, each marked in the picker and in SEASONAL`);
    }
  }
}

/* ---- the seasonal ⓘ panel and the Community Themes page are wired end to end ----
 *
 * The seasonal panel keeps its markup. Community Themes was promoted from a
 * popup to a real page where members submit their own themes, so seven files
 * now carry this feature: the page section, the two assets (js + css), the
 * sw precache, the account hooks, the server actions, and the migration.
 * Each part is invisible on its own - an unbound entry or an unfilled gallery
 * still opens and shows an empty box with no error - so the wiring is checked
 * as a whole: the menu opens the page, the page's ids exist, the JS reaches
 * exactly those ids, the server takes signed-in members and validated hex
 * colors only, and the gallery never leaks who wears what. */
{
  const page = readFileSync(join(ROOT, "index.html"), "utf8");
  const acct = readFileSync(join(ROOT, "account.js"), "utf8");
  const ctJs = readFileSync(join(ROOT, "community-themes.js"), "utf8");
  const ctCss = readFileSync(join(ROOT, "community-themes.css"), "utf8");
  const swJs = readFileSync(join(ROOT, "sw.js"), "utf8");
  const apiSrc = readFileSync(join(ROOT, "functions", "api", "account", "index.js"), "utf8");
  const migration = readFileSync(join(ROOT, "migrations", "0052_member_themes.sql"), "utf8");

  const need = ["seasonalThemesModal", "seasonal-themes-list"];
  const absent = need.filter((id) => !page.includes('id="' + id + '"'));
  if (absent.length) structureFail(`markup missing for: ${absent.join(", ")}`);
  else structureOk("the seasonal panel and its list container are in the page");

  /* The seasonal list also lives as its own foldable block under the
     Appearance grid in Account Settings. Both hosts are filled by one loop in
     account.js and the fold choice is remembered, so a member does not have
     to re-fold what they folded last visit. */
  const blockNeed = ["seasonalBlock", "seasonalFold", "seasonal-themes-block"];
  const blockAbsent = blockNeed.filter((id) => !page.includes('id="' + id + '"'));
  if (blockAbsent.length) structureFail(`seasonal block markup missing: ${blockAbsent.join(", ")}`);
  else if (!page.includes('aria-controls="seasonal-themes-block"'))
    structureFail("the seasonal fold button does not point at its list");
  else structureOk("the seasonal block sits in the Appearance grid with its fold button");

  const themesCss = readFileSync(join(ROOT, "themes.css"), "utf8");
  if (!acct.includes("#seasonal-themes-list, #seasonal-themes-block") ||
      !acct.includes("thwSeasonalBlock")) {
    structureFail("account.js does not fill both seasonal hosts or persist the fold");
  } else if (!themesCss.includes(".seasonal-block.folded #seasonal-themes-block{display:none}")) {
    structureFail("themes.css has no folded state for the seasonal block");
  } else {
    structureOk("both seasonal hosts are filled from one loop, and the fold is styled");
  }

  /* Every seasonal row carries a history ⓘ - the card is a wrapper span so
     the story can open even on a row whose wear button is disabled - and a
     decal layer (effects.js) paints the worn season: snow at Christmas and
     friends. A settings switch remembers if a member would rather sit
     quietly. The ⓘ is no longer an inline reveal: it opens a panel
     (#seasonalHistoryModal) that carries the holiday's picture, its season
     and its story, with the art precached by the service worker. */
  const effects = readFileSync(join(ROOT, "effects.js"), "utf8");
  const fxNeed = ["id=\"seasonalFxRow\"", "id=\"seasonalFxToggle\"", "effects.js?v=thw-v"];
  const fxAbsent = fxNeed.filter((x) => !page.includes(x));
  if (fxAbsent.length) structureFail(`effects markup/tokens missing: ${fxAbsent.join(", ")}`);
  else if (!swJs.includes("'./effects.js?v=thw-v")) structureFail("the service worker does not precache effects.js");
  else if (!effects.includes("christmas") || !effects.includes("thw-fx-toggle") || !effects.includes("thw-fx"))
    structureFail("effects.js does not carry the seasonal glyph table or the toggle hook");
  else if (!themesCss.includes(".thw-fx{") || !themesCss.includes("@keyframes thw-fx-fall"))
    structureFail("themes.css has no falling animation for the decals");
  else if (!acct.includes("thwThemeFx") || !acct.includes("entry.history"))
    structureFail("account.js does not remember the effects choice or hand the rows their history");
  else if (!themesCss.includes(".thw-theme-hist") || !themesCss.includes(".thw-hist-modal") ||
    !themesCss.includes(".thw-hist-art") || !themesCss.includes(".thw-hist-wear[hidden]"))
    structureFail("themes.css has no panel styling for the history ⓘ or its hidden wear button");
  else if (themesCss.includes(".thw-theme-history") || themesCss.includes("hist-open"))
    structureFail("themes.css still styles the removed inline history reveal");
  else if (!page.includes('id="seasonalHistoryModal"') || !page.includes('id="holidayArt"') ||
    !page.includes('id="holidayHistory"') || !page.includes('id="holidayWear"'))
    structureFail("index.html has no holiday panel markup behind the modal");
  else if (!swJs.includes("./holiday-art/")) structureFail("the service worker does not precache the holiday art");
  else if (!themesCss.includes(".thw-hist-credit") || !page.includes('id="holidayCredit"'))
    structureFail("the holiday photo credit line has no markup or no styling");
  else if (!acct.includes("openHolidayPanel") || !acct.includes('holiday-art/" + id + ".jpg"') ||
    !acct.includes("seasonalHistoryModal") || !acct.includes("PHOTO_CREDITS"))
    structureFail("account.js does not open the holiday panel, point the art at holiday-art/ or credit the photos");
  else structureOk("each row's ⓘ opens a picture panel with its story, and effects.js paints the worn season");

  const btnCount = (page.match(/class="thw-theme-info"/g) || []).length;
  if (btnCount !== 1) structureFail(`expected the info button in the picker, found ${btnCount}`);
  else structureOk("the theme picker carries the seasonal info button");

  /* The popup is gone twice over: no markup left in the page, no handler left
     in account.js - a surviving half would open into a void. */
  if (!page.includes('id="page-section-community-themes" class="app-page"')) {
    structureFail("the Community Themes page section is missing (it is a page now, not a popup)");
  } else if (!page.includes('<div class="ct-mount"></div>')) {
    structureFail("the Community Themes page section has no mount for its script");
  } else if (/communityThemesModal|community-themes-list|thwOpenCommunityThemes/.test(page + acct)) {
    structureFail("the deleted Community Themes popup is still wired somewhere");
  } else {
    structureOk("the Community Themes page replaced the popup, with no popup wiring left");
  }

  /* The menu entry opens the page the way its siblings (Suggestions, Wanted
     Vault) do: real switchAppPage pages, desktop dropdown and mobile popup. */
  const entryOk = (/switchAppPage\(&#39;community-themes&#39;\)" id="nav-comm-themes"/.test(page) &&
    /switchAppPage\(&#39;community-themes&#39;\)" class="mobile-popup-item"/.test(page));
  if (!entryOk) structureFail("a Community Themes menu entry does not open the page");
  else structureOk("the Community Themes menu entry opens the page (desktop and mobile)");

  if (!page.includes('<script src="./community-themes.js?v=thw-v') ||
      !page.includes('community-themes.css?v=thw-v')) {
    structureFail("index.html does not load the Community Themes page assets");
  } else if (!swJs.includes("'./community-themes.js?v=thw-v") ||
             !swJs.includes("'./community-themes.css?v=thw-v")) {
    structureFail("the service worker does not precache the Community Themes assets");
  } else {
    structureOk("the Community Themes assets are tagged in the page and precached");
  }

  /* What a signed-out visitor is told, and the rules the instant publish
     leans on - these are read from the script that draws the page. */
  const rules = ["Colors only", "Kind names and descriptions", "Be yourself",
    "Original work", "Twenty per member", "The owner can remove"];
  const missingRules = rules.filter((r) => !ctJs.includes(r));
  if (missingRules.length) structureFail(`the rules card is missing: ${missingRules.join(", ")}`);
  else if (!ctJs.includes("Sign in to submit a theme")) {
    structureFail("the submit form does not tell a signed-out visitor to sign in");
  } else structureOk("the page carries the rules and the sign-in gate");

  /* account.js hooks: the page wears through the picker's own change path,
     generated stylesheets are fetched wherever a u- slug can appear, and a
     member theme's real name is what the toast reads. */
  if (!/window\.thwWearTheme\s*=\s*wearFromList/.test(acct)) {
    structureFail("account.js does not expose the shared wear path for the page");
  } else if ((acct.match(/ensureMemberThemeCss\(theme\)/g) || []).length < 3 ||
             !/ensureMemberThemeCss\(v\)/.test(acct)) {
    structureFail("member-theme stylesheets are not fetched on every theme-apply path");
  } else if (!/#setTheme option\[value/.test(acct)) {
    structureFail("a member theme's name is not read from its picker option");
  } else {
    structureOk("account.js wears, fetches CSS for, and names member themes");
  }

  /* The page script: every server action, client-side hex validation that
     mirrors the server's, and one picker group member themes land in. */
  const actions = ["submitTheme", "memberThemes", "themeStats", "removeTheme"];
  const missingActions = actions.filter((a) => !ctJs.includes('action: "' + a + '"'));
  if (missingActions.length) structureFail(`the page never calls: ${missingActions.join(", ")}`);
  else if (!/var HEX_OK = \/\^#\[0-9a-fA-F\]\{6\}\$\//.test(ctJs)) {
    structureFail("the builder does not validate hex values the server's way");
  } else if (!/"data-member-group"/.test(ctJs) || !/group\.label = "Community"/.test(ctJs)) {
    structureFail("member themes have no Community group in the pickers");
  } else if (!ctJs.includes('.replace(/&/g, AMP + "amp;")')) {
    structureFail("esc() no longer escapes an ampersand first");
  } else {
    structureOk("the page script draws, validates, and submits the theme");
  }

  if (!/#page-section-community-themes/.test(ctCss) ||
      !/\.ct-theme-row\s*\{/.test(ctCss) || !/\.ct-stat-bar\s*\{/.test(ctCss)) {
    structureFail("the Community Themes stylesheet is missing its page chrome");
  } else structureOk("the Community Themes stylesheet styles the page");

  /* The server's side: five validated slots, the u- namespace, a CSS template
     the site owns, and reads/writes that stay on the right side of the gate. */
  const slots = /const MEMBER_THEME_SLOTS = \[([^\]]+)\]/.exec(apiSrc);
  if (!slots || slots[1].split(",").filter((s) => s.trim()).length !== 5) {
    structureFail("the server does not define exactly five member theme slots");
  } else if (!/const HEX_SHAPED_RE = \/\^#\[0-9a-fA-F\]\{6\}\$\//.test(apiSrc) ||
             !/for \(const slot of MEMBER_THEME_SLOTS\)/.test(apiSrc)) {
    structureFail("submitTheme does not validate every slot through the strict hex shape");
  } else {
    structureOk("the server validates all five slots as strict hex");
  }

  if (!/const MEMBER_SLUG_RE = \/\^u-\[a-z0-9-\]\{2,40\}\$\//.test(apiSrc)) {
    structureFail("member slugs do not live in the u- namespace");
  } else structureOk("member slugs live in the u- namespace");

  /* The generated stylesheet is the only CSS a member theme gets: built from
     the site's own template out of validated colors - no url() into it. */
  const tpl = /function memberThemeCss\(([\s\S]*?)\n\}/.exec(apiSrc);
  if (!tpl) structureFail("the server does not own the member CSS generation");
  else if (/url\(/.test(tpl[0])) structureFail("the member CSS template could carry a url()");
  else if (!/html\[data-theme=/.test(tpl[0])) structureFail("the member CSS template does not scope to its slug");
  else structureOk("member CSS is generated from the site's color-only template");

  /* Ordering: the two reads are public (a guest browses the gallery and pulls
     a stylesheet), every write sits after the sign-in gate, and the gallery
     response exposes authorship as an owned boolean - never the uid itself. */
  const iPost = apiSrc.indexOf("export async function onRequestPost(");
  const iThemes = apiSrc.indexOf('body.action === "memberThemes"', iPost);
  const iCss = apiSrc.indexOf('body.action === "themeCss"', iPost);
  const iGate = apiSrc.indexOf('if (!uid) return json({ error: "missing user" }, 400)', iPost);
  const iSubmit = apiSrc.indexOf('case "submitTheme"', iPost);
  const galleryBlock = iCss > iThemes ? apiSrc.slice(iThemes, iCss) : "";
  if (!(iPost >= 0 && iThemes > iPost && iCss > iThemes && iGate > iCss && iSubmit > iGate)) {
    structureFail("the public reads and the authed writes are ordered wrong");
  } else if (!/owned: !!viewerUid && r\.uid === viewerUid/.test(galleryBlock)) {
    structureFail("the gallery does not mark which rows the viewer owns");
  } else if (/\buid\s*:/.test(galleryBlock)) {
    structureFail("the public gallery response leaks a uid");
  } else {
    structureOk("the gallery is public, writes are gated, and no uid is exposed");
  }

  /* Twenty per member, banned members out, and a save that only trusts a u-
     slug the community still has. */
  if (!/>= 20/.test(apiSrc) || !/"theme limit reached"/.test(apiSrc)) {
    structureFail("the 20-per-member limit is not enforced");
  } else if (!/"setVisibility", "submitTheme"\]/.test(apiSrc)) {
    structureFail("submitTheme is not behind the ban gate");
  } else if (!/SELECT 1 FROM member_themes WHERE slug = \?/.test(apiSrc)) {
    structureFail("saveTheme accepts u- slugs without checking the row still exists");
  } else {
    structureOk("submit amounts, bans, and saving member themes are enforced");
  }

  /* A take-down hides, it never deletes: wearers keep the theme. */
  const iRemove = apiSrc.indexOf('case "removeTheme"');
  const removeBlock = apiSrc.slice(iRemove, apiSrc.indexOf('case "saveLanguage"'));
  if (iRemove < 0) structureFail("there is no removeTheme action");
  else if (!/hidden = 1/.test(removeBlock)) structureFail("removeTheme is not a soft hide");
  else if (!/OWNER_DISCORD_ID/.test(removeBlock)) structureFail("removeTheme forgot the owner");
  else if (/DELETE FROM member_themes/.test(apiSrc)) structureFail("member themes get deleted, not hidden");
  else structureOk("removeTheme hides softly (author or owner), never a hard delete");

  if (!/CREATE TABLE IF NOT EXISTS member_themes/.test(migration) ||
      !/slug TEXT NOT NULL UNIQUE/.test(migration) ||
      !/hidden INTEGER/.test(migration)) {
    structureFail("the member_themes migration is not a unique-slug, soft-hide table");
  } else structureOk("the migration holds member themes: unique slug, soft hide");

  const seasonalBlock = /var SEASONAL = \[([\s\S]*?)\n  \];/.exec(acct);
  if (seasonalBlock) {
    const entries = (seasonalBlock[1].match(/\{[^}]+\}/g) || []);
    const withoutAbout = entries.filter((e) => !/about: "[^"]+"/.test(e));
    if (withoutAbout.length) structureFail(`${withoutAbout.length} seasonal themes have no about line for the panel`);
    else structureOk(`all ${entries.length} seasonal themes describe themselves for the panel`);
  }

  const caseM = /case "themeStats": \{([\s\S]*?)\n      case /.exec(apiSrc);
  if (!caseM) {
    structureFail("the account API has no themeStats action");
  } else {
    /* Comments first: the answer to "does this read a member's identity" has
       to come from the code, not from a sentence about identity. */
    const code = caseM[1].replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
    const sql = /SELECT ([\s\S]*?) FROM/.exec(code);
    const aggregates = /GROUP BY theme/.test(code) && /COUNT\(\*\)/.test(code);
    const identity = /\buid\b|site_uid|display_name|\bhandle\b|\bemail\b/.test(sql ? sql[1] : "SELECT-COULD-NOT-BE-READ");
    if (!aggregates) structureFail("themeStats does not group a count per theme");
    else if (!sql) structureFail("themeStats' query could not be read");
    else if (identity) structureFail("themeStats counts a per-member column: " + sql[1].trim().slice(0, 60));
    else structureOk("themeStats counts themes per group without touching a member's identity");
    /* Member themes are counted too - by the u- namespace, aggregate-only. */
    if (!/theme LIKE 'u-%'/.test(caseM[1])) structureFail("themeStats does not count member themes (u- namespace)");
    else structureOk("themeStats counts member themes by their u- namespace");
  }

  /* The builder's preview shows the shape of the theme, not just the swatch
     list: a mini mock of the site (nav, hero, cards) painted from the slots,
     plus the hex codes themselves. */
  if (!/ct-mini-nav/.test(ctJs) || !/ct-mini-hero/.test(ctJs) ||
      !/ct-mini-card/.test(ctJs) || !/ct-mini-hex/.test(ctJs)) {
    structureFail("the builder's preview is not a mini mockup of the site");
  } else structureOk("the builder previews a mini mockup of the site from the slots");

  if (!/\.ct-mini\s*\{/.test(ctCss) || !/\.ct-mini-nav\s*\{/.test(ctCss) || !/\.ct-mini-hero\s*\{/.test(ctCss)) {
    structureFail("the preview mockup has no stylesheet chrome");
  } else structureOk("the preview mockup is styled");

  /* Going back: every theme switch funnels through the picker's change
     handler (Wear sets the select and fires change), so the handler puts the
     previous theme away, and the gallery offers a one-click wear-back chip. */
  if (!/window\.thwPrevTheme = function/.test(acct) ||
      !/localStorage\.setItem\("thwPrevTheme", wasWearing\)/.test(acct)) {
    structureFail("theme switches do not remember the previous theme");
  } else structureOk("every theme switch remembers what the member was wearing before");

  if (!/function backChip/.test(ctJs) || !/thwPrevTheme/.test(ctJs) ||
      !/ct-btn-back/.test(ctJs)) {
    structureFail("the gallery does not offer a go-back chip for the previous theme");
  } else structureOk("the gallery offers a one-click wear-back of the previous theme");
}

/* ---- the recent activity list lives on the account page ----
 *
 * It was on the profile page, where it sat next to a stranger's name and read
 * as though it were their history. The account page already had a function to
 * fill it - applyActivity() - but there was no container for it in the markup,
 * so it did nothing and the list existed in exactly one place: the profile.
 *
 * The profile must not carry it, and the account page must have a container
 * for the function that was already there. */
{
  const acct = readFileSync(join(ROOT, "account.js"), "utf8");
  if (/data-pnl="recent-activity"/.test(acct)) {
    structureFail("the profile page still carries the Recent Activity panel");
  } else {
    structureOk("the profile page carries no Recent Activity panel");
  }
  if (!/id="activityList"/.test(html)) {
    structureFail("the account page has no #activityList for applyActivity() to fill");
  } else {
    structureOk("the account page has a container for the activity list");
  }
  if (!/getElementById\("activityList"\)/.test(acct)) {
    structureFail("applyActivity() does not look for #activityList");
  } else {
    structureOk("applyActivity() fills the account page's list");
  }
  const applyCount = (acct.match(/function applyActivity\s*\(/g) || []).length;
  if (applyCount !== 1) {
    structureFail(`there are ${applyCount} functions called applyActivity - the second one shadows the first`);
  } else {
    structureOk("one applyActivity, and renderAll already calls it");
  }
}

/* ---- the NSFW badge is sized from the artwork ----
 *
 * The badge used to measure the artwork's PARENT. That is the cover box in the
 * places it was written for - the mini player, the lightbox, a playlist row.
 * It is not the cover box everywhere: the Top Plays and Recently Played panels
 * put the artwork straight inside the row, so the row's width was published as
 * --cov-w and the badge was drawn across the track's title. */
{
  const sc = readFileSync(join(ROOT, "script.js"), "utf8");
  const sizeM = /function sizeBadge\([\s\S]{0,2400}?\r?\n {2}\}/.exec(sc);
  if (!sizeM) {
    structureFail("sizeBadge could not be found");
  } else if (!/img\.getBoundingClientRect\(\)/.test(sizeM[0]) ||
             !/(parBox\.width|parent\.getBoundingClientRect\(\)\.width)/.test(sizeM[0])) {
    structureFail("the NSFW badge is not sized from the artwork's own width");
  } else if (!/badge\.style\.width\s*=\s*box\.width/.test(sizeM[0]) ||
             !/badge\.style\.left\s*=\s*\(box\.left/.test(sizeM[0])) {
    structureFail("the NSFW badge is not placed over the artwork");
  } else {
    structureOk("the NSFW badge is sized from, and placed over, the artwork");
  }
}

/* ---- the presence table is pruned, and counted, in one format ----
 *
 * The cutoff was sqlite's datetime(), which is the same digits as the stored
 * ISO timestamps with a space where the T is. 'T' sorts after a space, so
 * every row from the current day compared as NEWER than the cutoff and was
 * never pruned: the table grew to hold every visitor of the day, and every
 * four-second poll scanned all of them. That is what spent the account's
 * entire daily row read budget and took the site down.
 *
 * So the cutoff has to be in the format the timestamps are actually stored in,
 * and both the prune and the count have to use the same one. */
{
  const online = readFileSync(join(ROOT, "functions/api/online.js"), "utf8");
  const cutoffs = [...online.matchAll(/strftime\('([^']+)'/g)].map((m) => m[1]);
  const isoCutoff = cutoffs.filter((c) => c.indexOf("%Y-%m-%dT") === 0);
  if (!isoCutoff.length) {
    structureFail("the presence cutoff is not in the format the timestamps are stored in, so same-day rows are never pruned");
  } else if (isoCutoff.length < 2) {
    structureFail("the presence prune and the presence count do not share one cutoff");
  } else if (!/WHERE last_seen >= strftime/.test(online)) {
    structureFail("the presence count is over the whole table rather than the live window");
  } else {
    structureOk("the presence table is pruned and counted over the same live window");
  }
  if (!/PRUNE_EVERY_MS/.test(online) || !/lastPruneAt/.test(online)) {
    structureFail("the presence prune runs on every heartbeat, scanning the table each time");
  } else {
    structureOk("the presence prune runs on a timer of its own");
  }
  if (/getCounts\(db, true\)/.test(online)) {
    structureFail("a presence heartbeat forces a fresh scan of the table every time");
  } else {
    structureOk("no presence heartbeat forces a fresh scan");
  }
}

/* ---- the recurring calls ask for what is on screen, and no more often ----
 *
 * The free tier allows 100,000 requests a day. The site was spending them on
 * polling that mostly produced nothing: the recently played list was asked for
 * every minute on every page and thrown away unless the profile was open, the
 * community socket was held open per tab for a page most tabs never show, and
 * the owner statistics were fetched every three seconds.
 *
 * So: a poll that is not on screen does not run, a tab in the background does
 * not ask, and nothing that can be asked once a minute is asked four times a
 * minute. */
{
  const presence = readFileSync(join(ROOT, "presence.js"), "utf8");
  const pollM = /var POLL_MS = (\d+);/.exec(presence);
  const hbM = /heartbeatTimer = setInterval\(heartbeat, (\d+)\)/.exec(presence);
  const wsHbM = /wsHbTimer = setInterval\(function \(\) \{ wsSend\(\{ type: 'heartbeat' \}\); \}, (\d+)\)/.exec(presence);
  if (!pollM || Number(pollM[1]) < 60000) {
    structureFail("the presence poll runs more often than once a minute");
  } else if (!hbM || Number(hbM[1]) < 60000) {
    structureFail("the presence heartbeat runs more often than once a minute");
  } else if (!wsHbM || Number(wsHbM[1]) < 60000) {
    structureFail("the presence socket heartbeats more often than once a minute");
  } else {
    structureOk("the presence poll and both heartbeats are a minute apart");
  }

  const recent = readFileSync(join(ROOT, "recent.js"), "utf8");
  if (!/function worthPolling\(\)/.test(recent)) {
    structureFail("the recently played list is polled whether or not it is on screen");
  } else if (!/setInterval\(function \(\) \{ if \(worthPolling\(\)\) load\(\); \}/.test(recent)) {
    structureFail("the recently played list's timer does not check whether it is on screen");
  } else {
    structureOk("the recently played list is only asked for when it is on screen");
  }

  const comm = readFileSync(join(ROOT, "community-realtime.js"), "utf8");
  if (!/function communityVisible\(\)/.test(comm)) {
    structureFail("the community socket is opened whether or not the community is on screen");
  } else if (!/if \(!communityVisible\(\)\) return;/.test(comm)) {
    structureFail("the community socket connects without checking the page is open");
  } else if (!/STATE\.heartbeat = setInterval\(\(\) => sendWs\(\{ type: 'heartbeat' \}\), (\d+)\)/.test(comm) ||
             Number(/STATE\.heartbeat = setInterval\(\(\) => sendWs\(\{ type: 'heartbeat' \}\), (\d+)\)/.exec(comm)[1]) < 60000) {
    structureFail("the community socket heartbeats more often than once a minute");
  } else {
    structureOk("the community socket follows the page, and heartbeats once a minute");
  }

  const visit = readFileSync(join(ROOT, "functions/api/visit.js"), "utf8");
  if (!/linkedCache/.test(visit)) {
    structureFail("every visit reads the linked-Discord row from the database");
  } else {
    structureOk("the linked-Discord lookup is read once per uid, not once per visit");
  }

  const script = readFileSync(join(ROOT, "script.js"), "utf8");
  const visitM = /if\(now-lp<(\d+)\)return;/.exec(script);
  if (!visitM || Number(visitM[1]) < 30000) {
    structureFail("a visit is recorded more often than once every thirty seconds");
  } else {
    structureOk("a visit is recorded once every thirty seconds");
  }
}

/* ---- the page's assets resolve from the root, whatever the path is ----
 *
 * A page served at /Profile/@someone resolves "./style.css" against
 * /Profile/, so every stylesheet and script 404s and the site answers with
 * the app shell instead - which the browser then refuses as a stylesheet
 * because its MIME type is text/html. A cold load or a refresh of a profile
 * address was therefore an unstyled page that never finished booting.
 *
 * A base of "/" fixes that for every deep path, not just the profile one, and
 * the only relative links on the page are already absolute paths, so nothing
 * else moves. */
if (!/<base href="\/"\s*>/.test(html)) {
  structureFail("the page has no <base href=\"/\">, so its assets resolve against the current path and a deep link loads nothing");
} else {
  structureOk("the page's assets resolve from the root on any path");
}

/* ---- the profile address has one owner ----
 *
 * A profile is addressed by its Discord username, /Profile/@name. Seven files
 * used to carry their own copy of the path pattern, so changing the address
 * would break them one at a time and none of them would say which: the page
 * quietly falls back to showing your own profile, or shows the wrong
 * statistics. */
{
  const accountSrc = readFileSync(join(ROOT, "account.js"), "utf8");
  if (!/function parseProfilePath\(/.test(accountSrc)) {
    structureFail("account.js has no parseProfilePath - the profile address has no single owner");
  } else if (!/window\.profilePathKey\s*=/.test(accountSrc) || !/window\.isOtherProfilePath\s*=/.test(accountSrc)) {
    structureFail("account.js does not publish profilePathKey and isOtherProfilePath");
  } else {
    structureOk("the profile address is read from one place");
  }

  const strays = [];
  for (const f of ["follows.js", "recent.js", "playlists-ui.js", "privacy.js", "profile-enhancements.js", "wrld-stats.js"]) {
    const src = readFileSync(join(ROOT, f), "utf8");
    if (/\/\\\/profile\\\//.test(src) || /["']\/profile\//.test(src)) strays.push(f);
  }
  if (strays.length) {
    structureFail(`files still matching the profile path themselves: ${strays.join(", ")}`);
  } else {
    structureOk("no file matches the profile path on its own any more");
  }

  /* The address carries the handle and no "@", and it is built from the field
   * the API actually returns. The API answers with the handle at the top
   * level - there is no top-level "username" - so reading the wrong one leaves
   * the address without a handle and quietly unfixed.
   *
   * And every member has to be routable: the API's handle falls back to the
   * site uid for anybody who has no Discord username, so a member without one
   * is still reachable rather than having no address at all. */
  if (!/PROFILE_PATH_ROOT\s*\+\s*"\/"\s*\+/.test(accountSrc)) {
    structureFail("the profile address is not built from the handle");
  } else {
    structureOk("the profile address is built from the handle");
  }
  if (!/canonicaliseProfileUrl\(\s*d\.handle/.test(accountSrc)) {
    structureFail("the address is not canonicalised from the API's handle field");
  } else {
    structureOk("the address is canonicalised from the field the API returns");
  }
  if (/\/Profile\/" \+ "@"|"\\\/@"/.test(accountSrc)) {
    structureFail("the profile address still carries an @");
  } else {
    structureOk("the profile address carries no @");
  }

  const profileApi = readFileSync(join(ROOT, "functions/api/profile.js"), "utf8");
  if (!/handle:\s*\(userRow\s*&&\s*userRow\.name\)\s*\|\|\s*String\(uid/.test(profileApi)) {
    structureFail("the API's handle does not fall back to the uid, so a member with no username has no address");
  } else {
    structureOk("every member has a handle, the uid standing in when there is no username");
  }
}

/* ---- a favourite row can be narrower than its content ----
 *
 * The producer pill is one long unbreakable line, and a flex item's automatic
 * minimum size is its min-content width - so without this the row was as wide
 * as the longest pill, the list was as wide as the longest row, and the page
 * scrolled sideways on a phone. The pill is what ellipsises, so the row has to
 * be the thing that gives way. */
{
  const ps = readFileSync(join(ROOT, "player-settings.css"), "utf8");
  const cardM = /\.cmp-profile-host \.fav-card\{([^}]*)\}/.exec(ps);
  const infoM = /\.cmp-profile-host \.fav-info\{([^}]*)\}/.exec(ps);
  if (!cardM) {
    structureFail("the favourite row has no min-width:0, so the longest pill widens the page");
  } else if (!/min-width:\s*0/.test(cardM[1])) {
    structureFail("the favourite row has no min-width:0, so the longest pill widens the page");
  } else if (!infoM || !/min-width:\s*0/.test(infoM[1])) {
    structureFail("the favourite row's text column has no min-width:0");
  } else {
    structureOk("a favourite row can be narrower than the pill in it");
  }

  const pe = readFileSync(join(ROOT, "profile-enhancements.js"), "utf8");
  if (!/pp-shelf\{flex-direction:column;align-items:stretch\}/.test(pe)) {
    structureFail("the profile shelf's stacked columns are still sized by their content, so they can exceed the phone");
  } else {
    structureOk("the profile shelf's columns take the width of the shelf");
  }
}

/* Depth of every page section. home, gallery, failed and player sit one level
   down inside the always-visible <main> wrapper; they have always been that way
   and all four render, so they are the baseline rather than a defect. Anything
   else not at depth 1 is new nesting that switchAppPage cannot undo. */
const sections = [...html.matchAll(/id="(page-section-[a-z]+)"/g)].map((mm) => ({ id: mm[1], at: mm.index }));
sections.sort((a, b) => a.at - b.at);
const ALWAYS_NESTED = new Set([
  "page-section-home",
  "page-section-gallery",
  "page-section-failed",
  "page-section-player",
]);
const depths = new Map();
{
  let ti = 0, depth = 0, i = 0;
  while (i < html.length && ti < sections.length) {
    const o = html.indexOf("<div", i);
    const c = html.indexOf("</div>", i);
    if (c === -1) break;
    if (o !== -1 && o < c) {
      while (ti < sections.length && sections[ti].at < o) depths.set(sections[ti++].id, depth);
      depth++;
      i = o + 4;
    } else {
      while (ti < sections.length && sections[ti].at < c) depths.set(sections[ti++].id, depth);
      depth--;
      if (depth < 0) depth = 0; // pre-existing over-close, tolerated
      i = c + 6;
    }
  }
  while (ti < sections.length) depths.set(sections[ti++].id, depth);
}
const buried = sections
  .filter((s) => {
    const d = depths.get(s.id);
    return !(d === 2 && ALWAYS_NESTED.has(s.id)) && d !== 1;
  })
  .map((s) => `${s.id} (depth ${depths.get(s.id)})`);
if (buried.length) {
  for (const b of buried) structureFail(`page section buried inside another element, can never be shown: ${b}`);
} else {
  structureOk(`${sections.length - ALWAYS_NESTED.size} page sections at top level, none buried`);
}
/* ---- 5. asset tokens agree between index.html and sw.js ----
 *
 * Every local asset the page loads is also in PRECACHE, spelled the same way -
 * same file, same ?v= token. The two drift apart easily because bumping a token
 * means editing two files, and a half-done bump is silent: the page requests
 * ./router.js?v=thw-v2 while the worker precached ./router.js?v=thw-v1, so the
 * offline path keeps serving the old file and the fresh one is never used. Worse,
 * a cached 502 for a script replays with no console error and no execution, which
 * looks exactly like a JavaScript bug.
 *
 * This is the check that was missing while that rule caused repeated outages. */
const localRefs = [];
for (const mm of html.matchAll(/<script[^>]*\ssrc=["'](\.\/[^"']+)["']/gi)) localRefs.push(mm[1]);
for (const mm of html.matchAll(/<link[^>]*\srel=["']?stylesheet["']?[^>]*href=["'](\.\/[^"']+)["']/gi)) localRefs.push(mm[1]);

const swSrc = readFileSync(SW, "utf8");
const pcStart = swSrc.indexOf("const PRECACHE = [");
const pcEnd = pcStart === -1 ? -1 : swSrc.indexOf("];", pcStart);
const pcEntries = pcStart === -1 ? [] : [...swSrc.slice(pcStart, pcEnd).matchAll(/'([^']+)'/g)].map((mm) => mm[1]);
const pcSet = new Set(pcEntries);
const drifted = [];
const uncached = [];
for (const ref of localRefs) {
  if (pcSet.has(ref)) continue;
  const bare = ref.replace(/^\.\//, "").split("?")[0];
  const variants = pcEntries.filter((p) => p.replace(/^\.\//, "").split("?")[0] === bare);
  if (variants.length) drifted.push(`${ref}  vs PRECACHE ${variants.join(", ")}`);
  else uncached.push(ref);
}
if (drifted.length || uncached.length) {
  for (const d of drifted) structureFail(`token drift, the offline path would serve a different file: ${d}`);
  for (const u of uncached) structureFail(`loaded by index.html but absent from PRECACHE: ${u}`);
} else {
  structureOk(`${localRefs.length} local assets, tokens match PRECACHE exactly`);
}

/* ---- 5b. a deployment must not re-download the whole shell ----
 *
 * The shell cache used to be named after the worker's VERSION, so every
 * deployment produced a new empty cache, the old one was deleted, and every
 * opening of the app after that deployment re-downloaded all 120 shell
 * assets. Each of those is a request against the plan's daily limit on a
 * Pages project running in bundled mode, and the site reached that limit and
 * stopped serving with "Error 1046: the owner has reached their plan limits".
 *
 * The assets inside the cache already carry their own ?v= token, and that
 * token moves when the content moves - which is what the check above proves.
 * So a stable cache name is correct, and a versioned one is a way of
 * re-downloading the world after every deploy. Both halves are asserted: the
 * name must not be derived from VERSION, and the precache must skip what is
 * already cached. */
{
  const shellName = /const\s+SHELL_CACHE\s*=\s*([^;]+);/.exec(swSrc);
  const runtimeName = /const\s+RUNTIME_CACHE\s*=\s*([^;]+);/.exec(swSrc);
  const versioned = (decl) => !!decl && /VERSION/.test(decl[1]);
  if (!shellName) structureFail("the shell cache name is not declared");
  else if (versioned(shellName)) {
    structureFail(
      "the shell cache is named after VERSION, so every deployment re-downloads all " +
      `${pcEntries.length} shell assets - that is what reached the plan limit`,
    );
  } else {
    structureOk(`the shell cache is stable (${shellName[1].trim()}), so a deploy only fetches what changed`);
  }
  if (!runtimeName) structureFail("the runtime cache name is not declared");
  else if (versioned(runtimeName)) {
    structureFail("the runtime cache is named after VERSION, so every deployment throws it away");
  } else {
    structureOk(`the runtime cache is stable (${runtimeName[1].trim()})`);
  }
  if (!/cache\s*\.\s*match\(\s*url\s*\)/.test(swSrc)) {
    structureFail("the precache does not skip assets that are already cached");
  } else {
    structureOk("the precache skips what is already cached");
  }
}

/* ---- 6. URL routing is intact, in the one place it lives ----
 *
 * Routing is account.js's NAV_URL, plus a boot hook that resolves the path, plus
 * a popstate handler. A separate router.js briefly duplicated all of that and was
 * removed: two tables for one job, and the duplicate sat inside account.js's
 * wrapper so its boot redirect never fired.
 *
 * What actually broke deep links was in script.js, not in either table. Its boot
 * timer ended with an unconditional switchAppPage("home"), and account.js's
 * wrapper turns every call into a pushState of that page's URL - so it rewrote
 * /player, /vault, /wanted, /account, /TOS and the rest to "/" after account.js had
 * already routed them correctly. Only /roadmap survived, because roadmap.js
 * carries its own rescue. Both halves of the fix are asserted below, because
 * either one alone leaves deep links silently broken. */
const accountSrc = readFileSync(join(ROOT, "account.js"), "utf8");
const scriptSrc = readFileSync(join(ROOT, "script.js"), "utf8");

const navBlock = accountSrc.match(/var NAV_URL = \{([^}]*)\}/);
if (!navBlock) {
  structureFail("could not find NAV_URL in account.js");
} else {
  const routes = [...navBlock[1].matchAll(/(\w+):\s*"(\/[^"]*)"/g)].map((mm) => ({ page: mm[1], path: mm[2] }));

  const REQUIRED_ROUTES = [
    { page: "about", path: "/about" },
    { page: "partner", path: "/partner" },
    { page: "gallery", path: "/gallery" },
    { page: "downloads", path: "/downloads" },
    { page: "failed", path: "/failed" },
    { page: "login", path: "/login" },
    // Not requested, but showAuthPage() switches between login and register with
    // one function, so routing only the first would leave the URL naming a page
    // that is no longer on screen the moment "Create one" is clicked.
    { page: "register", path: "/register" },
  ];
  for (const required of REQUIRED_ROUTES) {
    const hit = routes.find((r) => r.page === required.page);
    if (!hit) structureFail(`NAV_URL has no "${required.page}" entry, so ${required.path} is not routable`);
    else if (hit.path !== required.path) structureFail(`NAV_URL routes "${required.page}" to ${hit.path}, expected ${required.path}`);
  }
  if (routes.length && REQUIRED_ROUTES.every((r) => routes.some((x) => x.page === r.page && x.path === r.path))) {
    structureOk(`NAV_URL routes ${routes.length} pages, including all ${REQUIRED_ROUTES.length} required paths`);
  }

  /* A route whose section is missing or buried is a blank page, not a 404 - the
     same failure the About tab split caused. Checked against the depth map the
     section-4 guard already built. */
  let routeOk = true;
  for (const r of routes) {
    const id = `page-section-${r.page}`;
    if (!depths.has(id)) continue; // owner/profile are routed without their own .app-page
    const d = depths.get(id);
    if (d !== 1 && !(d === 2 && ALWAYS_NESTED.has(id))) {
      structureFail(`route ${r.path} targets ${id}, which is nested and can never be shown`);
      routeOk = false;
    }
  }
  if (routeOk) structureOk("every NAV_URL route that has a page section points at a showable one");
}

/* A route with no nav button must say so explicitly. The default is
   "page-nav-" + page, and for Gallery, Downloads, Failed Projects and the auth
   pages that id does not exist - so the fallback would silently depend on
   getElementById returning null rather than on anything being correct. */
const pillFor = accountSrc.match(/function _navPillFor\(page\) \{([\s\S]*?)\n  \}/);
if (!pillFor) {
  structureFail("could not find _navPillFor in account.js");
} else {
  const body = pillFor[1];
  const needsNoPill = ["gallery", "downloads", "failed", "login", "register"];
  const explicit = new Set();
  for (const m of body.matchAll(/page === "([a-z]+)"/g)) explicit.add(m[1]);
  const missing = needsNoPill.filter((p) => !explicit.has(p));
  if (missing.length) {
    structureFail(`_navPillFor does not mention ${missing.join(", ")}, so these would fall through to a nav button that does not exist`);
  } else {
    structureOk(`_navPillFor handles the ${needsNoPill.length} routes that have no nav button`);
  }
}

/* script.js's boot timer must not force the home page when the URL says otherwise. */
const BOOT_FORCES_HOME =
  'setTimeout(function(){try{window.switchAppPage("home")}catch(e){}showWrldLog()},0);';
const BOOT_YIELDS =
  'setTimeout(function(){try{if((location.pathname||"/").replace(/\\/+$/,"")==="/")window.switchAppPage("home")}catch(e){}showWrldLog()},0);';
if (scriptSrc.includes(BOOT_FORCES_HOME)) {
  structureFail("script.js's boot timer still forces the home page on every load, which rewrites every deep link to /");
} else if (!scriptSrc.includes(BOOT_YIELDS)) {
  structureFail("script.js's boot timer no longer matches the expected guarded form; deep links may be broken again");
} else {
  structureOk("script.js's boot timer only forces home at /, so deep links survive it");
}

/* And account.js must send an unrecognised path home rather than leaving the page
   blank, since script.js now declines to do it. */
if (!accountSrc.includes('window.switchAppPage(bootPage || "home")')) {
  structureFail("account.js's boot hook no longer falls back to home for an unknown path; such a load would render nothing");
} else {
  structureOk("account.js's boot hook resolves known paths and falls back to home");
}

/* ---- 7. no published track count is hardcoded ----
 *
 * The About hero stat and the WRLD LOG footer both used to carry a typed-in
 * catalogue size, and both went stale the moment tracks were added - the footer
 * was previously found claiming 30 while the panel above it listed 31. They are
 * now written from trackList, so what is checked here is that neither has drifted
 * back to a literal.
 *
 * The literal is compared against trackList's real length, so a stale number
 * fails even though it is a plausible-looking count. */
const tracksSrc = readFileSync(join(ROOT, "tracks.js"), "utf8");
let trackCount = null;
try {
  trackCount = new Function(tracksSrc + "; return trackList.length;")();
} catch (e) {
  structureFail("tracks.js does not parse, so the track count cannot be verified: " + e.message);
}
if (trackCount !== null) {
  const PUBLISHED = [
    { id: "abp-hero-tracks", where: "the About page hero stat" },
    { id: "wrldlog-track-count", where: "the WRLD LOG footer" },
  ];
  for (const p of PUBLISHED) {
    const re = new RegExp(`id="${p.id}"[^>]*>(\\d+)<`);
    const m = html.match(re);
    if (!m) {
      structureFail(`could not find #${p.id}, the count in ${p.where}`);
    } else if (Number(m[1]) !== trackCount) {
      structureFail(`${p.where} says ${m[1]} but trackList holds ${trackCount} tracks`);
    }
  }
  if (PUBLISHED.every((p) => {
    const m = html.match(new RegExp(`id="${p.id}"[^>]*>(\\d+)<`));
    return m && Number(m[1]) === trackCount;
  })) {
    structureOk(`both published track counts match trackList (${trackCount})`);
  }

  // And they must actually be written at runtime, not just correct in the markup.
  const aboutTabs = readFileSync(join(ROOT, "about-tabs.js"), "utf8");
  const unwired = PUBLISHED.filter((p) => !aboutTabs.includes(p.id));
  if (unwired.length) {
    structureFail(`about-tabs.js never updates ${unwired.map((p) => "#" + p.id).join(" and ")}, so they will drift on the next track added`);
  } else {
    structureOk("about-tabs.js derives both counts from trackList at runtime");
  }
}

/* ---- 8. the View cover button lives in the info panel ----
 *
 * It is built at runtime by cover-preview.js rather than present in the markup,
 * so nothing else checks where it ends up. It used to be appended to
 * #vinyl-wrapper, in the player's main column; it belongs in the info panel now.
 * If the mount target is ever reverted the button silently reappears in the wrong
 * place, and if the info panel's cover row is renamed the button stops being
 * created at all - with no error, since mount() just returns.
 *
 * Also asserts it is not being hidden on phones any more: it used to be, because
 * its label wrapped in the narrow player column, and that reason does not apply
 * inside a centred modal. */
const cpJs = readFileSync(join(ROOT, "cover-preview.js"), "utf8");
const cpCss = readFileSync(join(ROOT, "cover-preview.css"), "utf8");
if (!cpJs.includes(".info-panel-cover-row")) {
  structureFail("cover-preview.js does not mount the View cover button into .info-panel-cover-row");
} else if (/getElementById\("vinyl-wrapper"\)/.test(cpJs)) {
  structureFail("cover-preview.js still mounts the View cover button into the player's vinyl wrapper");
} else {
  structureOk("the View cover button is mounted into the info panel, not the player column");
}
if (!html.includes('class="info-panel-cover-row"')) {
  structureFail("the info panel has no .info-panel-cover-row for the View cover button to mount into");
} else {
  structureOk("the info panel still provides .info-panel-cover-row");
}
if (/#cover-preview-btn[\s\S]{0,80}display:\s*none/.test(cpCss)) {
  structureFail("cover-preview.css still hides the View cover button on phones, which would hide the feature entirely");
} else {
  structureOk("the View cover button is no longer hidden on phones");
}

/* ---- 9. the cover-credit lookup decodes filenames ----
 *
 * The info panel credits a cover by matching the cover's filename against
 * artistData. The filenames in trackList are URL-encoded ("AP%20TikTok.png")
 * while artistData spells them decoded ("AP TikTok.png"), so a strict comparison
 * never matched and 202 of 286 tracks rendered "Cover made by N/A".
 *
 * This recomputes the same lookup both ways, so the mismatch cannot come back
 * unnoticed. It also reports how many tracks have no credit at all, which is a
 * data gap rather than a bug - artistData simply does not cover them, and N/A is
 * the honest answer for those. */
const artistDataMatch = scriptSrc.match(/artistData=\[/);
if (!artistDataMatch) {
  structureFail("could not find artistData in script.js");
} else {
  const open = scriptSrc.indexOf("[", artistDataMatch.index);
  let depth = 0, k = open;
  for (; k < scriptSrc.length; k++) {
    if (scriptSrc[k] === "[") depth++;
    else if (scriptSrc[k] === "]") { depth--; if (depth === 0) break; }
  }
  let artistData = null;
  try {
    artistData = new Function("return " + scriptSrc.slice(open, k + 1) + ";")();
  } catch (e) {
    structureFail("artistData in script.js could not be read: " + e.message);
  }
  if (artistData && trackCount !== null) {
    const COVER_PREFIX = "https://raw.githubusercontent.com/Lightsky1356/TheHighWRLD/main/";
    const strip = (c) => String(c || "").replace(COVER_PREFIX, "").replace(/^Covers\//, "");
    const safeDecode = (v) => { try { return decodeURIComponent(v); } catch (_) { return v; } };

    const list = new Function(tracksSrc + "; return trackList;")();
    const credited = new Set();
    for (const a of artistData) for (const [, f] of a.tracks) credited.add(f);

    const matched = list.filter((tr) => credited.has(safeDecode(strip(tr.cover)))).length;
    const uncredited = list.length - matched;

    /* Two separate things are being checked, and the first is the one that
       actually catches a regression. An earlier version of this guard decoded the
       filenames itself and only counted the matches, so it passed whether or not
       script.js decoded anything - it was measuring the data rather than the code
       path, and removing the decode entirely still reported a full score.
       So the presence of the decode in script.js is asserted directly, and the
       match count is only a sanity check on the data. */
    const creditAt = scriptSrc.indexOf('document.getElementById("info-cover-credit")');
    const creditEnd = scriptSrc.indexOf('t.textContent="Cover made by "', creditAt);
    const creditBlock = creditAt >= 0 && creditEnd > creditAt ? scriptSrc.slice(creditAt, creditEnd) : "";
    if (!creditBlock) {
      structureFail("could not isolate the cover-credit lookup in script.js");
    } else if (!/decodeURIComponent/.test(creditBlock)) {
      structureFail("the cover-credit lookup no longer decodes the filename, so every cover with a space in its name reads \"Cover made by N/A\"");
    } else {
      structureOk("the cover-credit lookup decodes filenames before matching artistData");
    }

    if (matched < list.length * 0.75) {
      structureFail(`only ${matched} of ${list.length} covers can be credited, which means the decode is not reaching the comparison`);
    } else {
      structureOk(`${matched} of ${list.length} covers resolve to an artist (${uncredited} have no credit in artistData)`);
    }
  }
}

/* ---- 10. the cover lightbox stacks above the info panel ----
 *
 * Both were z-index:10000 in player-settings.css. Equal values stack in document
 * order and #cover-lightbox is written before #info-panel, so the panel painted
 * over the lightbox and View cover appeared to open behind it. Harmless while the
 * button lived in the player; broken once it moved into the panel.
 *
 * The comparison is done by reading both numbers out of the CSS rather than by
 * clicking the button, because a tie does not look like a failure in a screenshot
 * until the two overlap - which is exactly when nobody is looking at the CSS. */
const psCss = readFileSync(join(ROOT, "player-settings.css"), "utf8");
const zIndexOf = (css, selector) => {
  const re = new RegExp(`(?:^|[}{;\\s])${selector.replace(/[.#]/g, "\\$&")}\\s*(?:,[^{]*)?\\{([^}]*)\\}`, "g");
  let best = null;
  for (const m of css.matchAll(re)) {
    const z = /z-index:\s*(\d+)/.exec(m[1]);
    if (z) best = Number(z[1]);
  }
  return best;
};
const panelZ = zIndexOf(psCss, ".info-panel");
const lightboxZ = zIndexOf(readFileSync(join(ROOT, "cover-preview.css"), "utf8"), "#cover-lightbox");
if (panelZ === null) {
  structureFail("could not find .info-panel's z-index in player-settings.css");
} else if (lightboxZ === null) {
  structureFail("#cover-lightbox has no z-index in cover-preview.css, so it competes with the info panel at 10000");
} else if (lightboxZ <= panelZ) {
  structureFail(`#cover-lightbox is z-index ${lightboxZ} and .info-panel is ${panelZ}, so the panel paints over the lightbox`);
} else {
  structureOk(`the cover lightbox (${lightboxZ}) stacks above the info panel (${panelZ})`);
}

/* ---- 11. the lightbox arrows exist, and are shown only when there is a list ----
 *
 * They were removed outright at one point because the "View cover" entry point
 * has nothing to step between - it shows one track. But the artist panel's covers
 * are a real list, and _getCovers() returns exactly that, so removing them broke
 * the one place they were useful. They are back and are now toggled per-open.
 *
 * Two failure modes worth guarding: the buttons missing from the markup again,
 * and them being permanently visible - which would put the arrows back on the
 * info-panel view where pressing one jumped to an unrelated artist's artwork,
 * because indexOf returns -1 for a cover that is not in the artist panel's list.
 */
const lbBlock = html.slice(html.indexOf('id="cover-lightbox"'), html.indexOf('id="cover-lightbox"') + 900);
const navButtons = (lbBlock.match(/class="lb-nav/g) || []).length;
if (navButtons !== 2) {
  structureFail(`the lightbox has ${navButtons} arrow buttons, expected 2`);
} else {
  structureOk("the lightbox has its prev/next arrow buttons");
}
if (!readFileSync(join(ROOT, "player-settings.css"), "utf8").includes(".lb-nav")) {
  structureFail("player-settings.css no longer styles .lb-nav, so the arrows would be unstyled");
} else {
  structureOk("the .lb-nav stylesheet rules are back with the buttons");
}

/* The arrows must be decided at open time, not baked into the markup. */
if (!/t\.length>1&&_currentCoverIdx>-1/.test(scriptSrc)) {
  structureFail("showCoverArt no longer decides whether to show the arrows, so they are always visible - including where there is nothing to step between");
} else {
  structureOk("the arrows are shown only when the artist panel has a list and the open cover is in it");
}
/* And navigating from outside that list must not jump to an unrelated cover. */
if (!/function _navigateCover\(e\)\{var t=_getCovers\(\);t\.length&&_currentCoverIdx>-1&&/.test(scriptSrc)) {
  structureFail("_navigateCover no longer refuses to navigate when the open cover is outside the artist panel's list");
} else {
  structureOk("navigation refuses to step when the open cover is not in the list");
}

const lbHasClose = /id="cover-lightbox"[\s\S]{0,700}?hideCoverArt\(\)/.test(html);
const lbHasImg = /id="cover-lightbox"[\s\S]{0,700}?id="cover-lightbox-img"/.test(html);
if (!lbHasClose || !lbHasImg) {
  structureFail("the lightbox lost its close button or its image");
} else {
  structureOk("the lightbox still has its image, close button and label");
}

/* ---- 12. every cover resolves to a real gradient ----
 *
 * getCoverGradientValue() hashes the cover's FILENAME when it finds no entry, so
 * a missing gradient is not blank - it is confidently wrong. "Smile (Sessions)"
 * came out pink because S is early in the alphabet, which is why the cause went
 * unnoticed for so long.
 *
 * 16 covers were missing (26 tracks - several share era artwork, so one gap hid
 * five tracks at a time) and 7 more were wrong. All of them are now derived from
 * the artwork and live in the single coverGradientMap in script.js. This asserts
 * that no track in the vault reaches the hash fallback.
 */
const mapAt2 = scriptSrc.indexOf("coverGradientMap={");
let vaultMap = null;
if (mapAt2 >= 0) {
  const open2 = scriptSrc.indexOf("{", mapAt2);
  let d2 = 0, k2 = open2;
  for (; k2 < scriptSrc.length; k2++) {
    if (scriptSrc[k2] === "{") d2++;
    else if (scriptSrc[k2] === "}") { d2--; if (d2 === 0) break; }
  }
  try {
    vaultMap = new Function("return " + scriptSrc.slice(open2, k2 + 1) + ";")();
  } catch (_) {}
}
if (!vaultMap) {
  structureFail("could not read coverGradientMap from script.js");
} else {
  const merged = vaultMap;
  const COVER_PREFIX = "https://raw.githubusercontent.com/Lightsky1356/TheHighWRLD/main/";
  const strip = (c) => String(c || "").replace(COVER_PREFIX, "").replace(/^Covers\//, "");
  const safeDecode = (v) => { try { return decodeURIComponent(v); } catch (_) { return v; } };

  const list2 = new Function(tracksSrc + "; return trackList;")();
  const unresolved = [];
  for (const tr of list2) {
    const k = safeDecode(strip(tr.cover));
    if (!merged[k] && !merged["Covers/" + k]) unresolved.push(`${tr.title} (${k})`);
  }
  if (unresolved.length) {
    for (const u of unresolved.slice(0, 8)) structureFail(`cover gradient falls back to a hash of the filename: ${u}`);
    if (unresolved.length > 8) structureFail(`...and ${unresolved.length - 8} more`);
  } else {
    structureOk(`all ${list2.length} covers resolve to a real gradient, none to the filename hash (${Object.keys(merged).length} map keys)`);
  }
}

/* ---- there is exactly one gradient table ----
 *
 * coverGradientMap was assembled from three places: the literal in script.js, an
 * Object.assign(coverGradientMap, {...}) block at the bottom of script.js, and
 * cover-gradients.js. Precedence was load order, so 13 keys took their value from
 * whichever file happened to load last rather than from intent, and the block at the
 * bottom of a minified file is not something anyone reads by accident.
 *
 * A fourth table would be the same trap under a new filename, so this fails on any
 * gradient table anywhere other than the one in script.js. */
const gradientTablesElsewhere = [];
if (/Object\.assign\(\s*coverGradientMap/.test(scriptSrc)) {
  gradientTablesElsewhere.push("an Object.assign(coverGradientMap, ...) block in script.js");
}
// Matching the bare filename was too blunt: script.js documents this consolidation
// in prose, and that comment mentions cover-gradients.js by name. What matters is
// whether something would still LOAD a second table, so these match the loading
// forms - a script src, a precache entry, or the file existing at all.
if (/src=["'][^"']*cover-gradients\.js/.test(html)) {
  gradientTablesElsewhere.push("a <script src> in index.html");
}
if (/["'][^"']*cover-gradients\.js/.test(swSrc)) {
  gradientTablesElsewhere.push("an entry in the sw.js precache list");
}
if (existsSync(join(ROOT, "cover-gradients.js"))) {
  gradientTablesElsewhere.push("cover-gradients.js still exists on disk");
}
if (gradientTablesElsewhere.length) {
  for (const t of gradientTablesElsewhere) structureFail(`cover gradients are defined in more than one place: ${t}`);
} else {
  structureOk(`cover gradients come from one table only (${Object.keys(vaultMap || {}).length} keys in script.js)`);
}

/* The cache clear at the bottom of script.js is load-bearing and easy to lose in a
   consolidation like this one. A lookup that missed before the table was complete
   caches the filename-hash fallback, and without the clear it never re-reads the
   real value - so gradients would be right in the source and wrong on screen. */
if (/delete gradientCache\[cover\]/.test(scriptSrc)) {
  structureOk("gradientCache is cleared after the table is built, so a stale filename-hash fallback is re-read");
} else {
  structureFail("gradientCache is never cleared, so a lookup that cached the filename hash keeps serving it");
}

/* cover-gradients.js exported this hook for anything reading the table from outside.
   It pointed at that file's 52 keys; it now points at the whole map, which is a
   superset, so every lookup that used to resolve still does. */
if (/window\.__thwCoverGradients\s*=/.test(scriptSrc)) {
  structureOk("window.__thwCoverGradients is still exported");
} else {
  structureFail("window.__thwCoverGradients is no longer exported");
}

/* ---- 13. no script tag is nested inside another ----
 *
 * The cover-gradients.js tag was first added directly after script.js's opening
 * tag rather than after its closing one, so it became literal text inside that
 * element. Nothing noticed: the file parsed, every other script loaded, and the
 * server was seen serving the tag - but the browser never created the element, so
 * the file was never requested. parse-gate read index.html and saw the tag, which
 * is exactly why a check on the source is not enough on its own.
 *
 * Caught by walking the tags properly: every <script> that has a src must be
 * closed before the next one opens. */
{
  const tagRe = /<script\b[^>]*>/gi;
  let m;
  let open = null;
  let nested = [];
  let checked = 0;
  while ((m = tagRe.exec(html)) !== null) {
    const closeRe = /<\/script\s*>/gi;
    closeRe.lastIndex = m.index + m[0].length;
    const close = closeRe.exec(html);
    const nextOpen = html.indexOf("<script", m.index + m[0].length);
    if (!close) {
      nested.push(`${m[0].slice(0, 60)} is never closed`);
      continue;
    }
    if (nextOpen !== -1 && nextOpen < close.index) {
      nested.push(`${m[0].slice(0, 50)} contains another <script before its own </script>`);
      continue;
    }
    if (/src=/i.test(m[0])) checked++;
    open = m[0];
  }
  if (nested.length) {
    for (const n of nested) structureFail("nested script tag: " + n);
  } else {
    structureOk(`${checked} external script tags, none nested inside another`);
  }
}

/* ---- 14. scripts that extend the page's globals are deferred ----
 *
 * cover-artists.js was added without `defer` while script.js - which declares
 * artistData - has it. A plain <script src> runs the moment the parser reaches
 * it; a deferred one waits for parsing to finish. So the new file executed first,
 * artistData did not exist yet, and it logged "artistData missing" and did
 * nothing at all.
 *
 * Nothing caught it. The tag was present, the file parsed, the server served it,
 * and the page behaved exactly as before the change - the whole point of the
 * change silently did not happen. Ordering was never the problem; attribute
 * parity was.
 *
 * This asserts that anything loading after script.js is deferred, which is what
 * "extends a global declared in script.js" requires in practice. */
{
  const scriptTagAt = html.indexOf("./script.js");
  const tagRe = /<script\b[^>]*>/gi;
  const late = [];
  let m;
  while ((m = tagRe.exec(html)) !== null) {
    if (m.index < scriptTagAt) continue;          // runs before script.js anyway
    if (/src=/i.test(m[0]) && !/\bdefer\b/i.test(m[0])) {
      const src = /src="([^"]+)"/.exec(m[0]);
      late.push(src ? src[1] : m[0].slice(0, 60));
    }
  }
  if (late.length) {
    for (const l of late.slice(0, 6)) {
      structureFail(`script loads after script.js but is not deferred, so it runs before artistData exists: ${l}`);
    }
    if (late.length > 6) structureFail(`...and ${late.length - 6} more undeferred scripts after script.js`);
  } else {
    const after = [...html.matchAll(/<script\b[^>]*>/gi)].filter((x) => x.index > scriptTagAt).length;
    structureOk(`all ${after} script tags after script.js are deferred`);
  }
}

/* ---- 14. cover credits are consistent ----
 *
 * cover-artists.js adds 97 artists and moves 5 credits between existing ones.
 * Both operations edit artistData at runtime, so neither shows up in the source
 * and both fail silently: a credit added twice gives one cover two artists, and a
 * credit added for a cover no track uses is dead weight that looks like data.
 *
 * The corrections move rather than copy - the cover is removed from whoever held
 * it before being given to the artist the comp folder names. That is checked
 * here, offline, by replaying what the file does. */
{
  const caPath = join(ROOT, "cover-artists.js");
  if (!existsSync(caPath)) {
    structureOk("cover-artists.js not present, so there is nothing to gate");
  } else {
    const ca = readFileSync(caPath, "utf8");

    // Replay it: the same create-then-credit-then-correct order the file uses.
    const artistAt4 = scriptSrc.indexOf("var artistData");
    const open4 = scriptSrc.indexOf("[", artistAt4);
    let d4 = 0, k4 = open4, inS4 = null;
    for (; k4 < scriptSrc.length; k4++) {
      const c4 = scriptSrc[k4];
      if (inS4) { if (c4 === "\\") { k4++; continue; } if (c4 === inS4) inS4 = null; continue; }
      if (c4 === '"' || c4 === "'") { inS4 = c4; continue; }
      if (c4 === "[") d4++;
      else if (c4 === "]") { d4--; if (d4 === 0) break; }
    }
    const data = new Function("return " + scriptSrc.slice(open4, k4 + 1) + ";")();

    const grab = (marker) => {
      const m = new RegExp(`var ${marker} = (\\[[\\s\\S]*?\\]);`).exec(ca);
      if (!m) return [];
      try { return new Function("return " + m[1] + ";")(); } catch (_) { return []; }
    };
    const newArtists = grab("NEW_ARTISTS");
    const credits = grab("CREDITS");
    const corrections = grab("CORRECTIONS");
    const renames = grab("RENAMES");

    const byName = new Map(data.map((a) => [a.name, a]));
    for (const n of newArtists) {
      if (!byName.has(n)) {
        const fresh = { name: n, pfp: null, color: "hsl(0,60%,50%)", tracks: [] };
        data.push(fresh);
        byName.set(n, fresh);
      }
    }
    for (const c of credits) {
      const a = byName.get(c.name);
      if (a && !a.tracks.some((t) => t[1] === c.cover)) a.tracks.push([c.title, c.cover]);
    }
    for (const fix of corrections) {
      const holder = data.find((a) => a.tracks.some((t) => t[1] === fix.cover));
      if (holder) holder.tracks = holder.tracks.filter((t) => t[1] !== fix.cover);
      let dest = byName.get(fix.to);
      if (!dest) { dest = { name: fix.to, pfp: null, color: "hsl(0,60%,50%)", tracks: [] }; data.push(dest); byName.set(dest.name, dest); }
      if (!dest.tracks.some((t) => t[1] === fix.cover)) dest.tracks.push([fix.title || fix.cover, fix.cover]);
    }

    for (const pair of renames) {
      const stale = data.find((a) => a.tracks.some((t) => t[1] === pair.stale));
      if (!stale) continue;
      stale.tracks = stale.tracks.filter((t) => t[1] !== pair.stale);
      const dest = byName.get(pair.from);
      if (dest && !dest.tracks.some((t) => t[1] === pair.current)) dest.tracks.push([pair.title, pair.current]);
    }

    // One cover, one artist.
    const owners = new Map();
    for (const a of data) for (const t of a.tracks || []) {
      if (!owners.has(t[1])) owners.set(t[1], []);
      if (!owners.get(t[1]).includes(a.name)) owners.get(t[1]).push(a.name);
    }
    const doubles = [...owners.entries()].filter(([, names]) => names.length > 1);
    for (const [cover, names] of doubles.slice(0, 5)) {
      structureFail(`cover credited to ${names.length} artists: ${cover} -> ${names.join(" / ")}`);
    }
    if (doubles.length > 5) structureFail(`...and ${doubles.length - 5} more doubly-credited covers`);
    if (!doubles.length) structureOk(`no cover is credited to more than one artist (${owners.size} credited)`);

    // Nothing invented: every credited cover must be one the site actually uses.
    const list4 = new Function(tracksSrc + "; return trackList;")();
    const used4 = new Set(list4.map((t) => safeDecode4(stripPrefix4(t.cover))));
    const orphans = [...owners.keys()].filter((c) => !used4.has(c));
    for (const o of orphans.slice(0, 5)) structureFail(`credited cover no track uses: ${o}`);
    if (orphans.length > 5) structureFail(`...and ${orphans.length - 5} more orphaned credits`);
    if (!orphans.length) structureOk("every credited cover belongs to a real track");

    // The panel dereferences artist.color unconditionally.
    const noColour4 = data.filter((a) => !a.color);
    if (noColour4.length) {
      for (const a of noColour4.slice(0, 5)) structureFail(`artist has no colour, which throws in the panel: ${a.name}`);
      if (noColour4.length > 5) structureFail(`...and ${noColour4.length - 5} more`);
    } else {
      structureOk(`all ${data.length} artists carry a colour`);
    }

    structureOk(`replayed: ${newArtists.length} artists added, ${credits.length} credits applied, ${corrections.length} corrected, ${renames.length} renamed`);
  }
}

function stripPrefix4(c) {
  return String(c || "").replace("https://raw.githubusercontent.com/Lightsky1356/TheHighWRLD/main/", "").replace(/^Covers\//, "");
}
function safeDecode4(v) {
  try { return decodeURIComponent(v); } catch (_) { return v; }
}

/* The same check against what the browser actually parsed, which is the only
   place the nesting above was ever going to show up. */
/* ---- the listening history is summarised, not scanned ----
 *
 * The listens table holds one row per play. The profile of a member needs
 * several summaries of that history, and each one used to read the whole
 * of it - so a profile view read it four times over, and the free tier
 * counts rows read rather than queries. A member with forty thousand plays
 * cost a hundred and sixty thousand row reads for one profile view.
 *
 * The summaries are kept now, in three small tables, and read in one
 * place. The history itself is only read when a play is recorded, or when
 * the summaries are built for the first time.
 *
 * So no endpoint may go back to scanning the history, and every place that
 * changes the history has to change the summaries with it. */
{
  const listening = readFileSync(join(ROOT, "functions/_lib/listens-stats.js"), "utf8");
  const profile = readFileSync(join(ROOT, "functions/api/profile.js"), "utf8");
  const mystats = readFileSync(join(ROOT, "functions/api/mystats.js"), "utf8");
  const account = readFileSync(join(ROOT, "functions/api/account/index.js"), "utf8");
  const merge = readFileSync(join(ROOT, "functions/api/discord/callback.js"), "utf8");

  if (!/listeningStats/.test(profile) || !/listeningStats/.test(mystats) || !/listeningStats/.test(account)) {
    structureFail("an endpoint reads the listening history directly instead of the summaries");
  } else {
    structureOk("the summaries are read in one place, by every endpoint that needs them");
  }

  /* A scan of the whole history, with nothing to narrow it down.
     A limit on the groups is not a limit on the rows: every row is still
     read to make the groups. And a filter that puts a function on the
     column cannot use the index, so the whole history is read and the
     filter is applied afterwards - which is not cheap either. The only
     cheap reads are the ones that bound the rows themselves. */
  const scans = [];
  for (const [name, src] of [["profile.js", profile], ["mystats.js", mystats], ["account/index.js", account]]) {
    for (const m of src.matchAll(/FROM listens WHERE uid = \?[^"]*"/g)) {
      const q = m[0];
      const grouped = q.indexOf("GROUP BY");
      const limited = q.indexOf("LIMIT");
      const cheap = limited !== -1 && (grouped === -1 || limited < grouped);
      if (!cheap) scans.push(name + ": " + q);
    }
  }
  if (scans.length) {
    structureFail("an endpoint scans the whole listening history again - " + scans.join(" | "));
  } else {
    structureOk("no endpoint scans the whole listening history");
  }

  /* The history may only be written through the helper that keeps the
     summaries in step with it. */
  if (/INSERT INTO listens/.test(account)) {
    structureFail("a play is written without keeping the summaries in step");
  } else if (!/recordPlay\(db, uid, title, seconds\)/.test(account)) {
    structureFail("a play is not recorded through the helper that keeps the summaries in step");
  } else {
    structureOk("a play is recorded through the helper that keeps the summaries in step");
  }

  if (/DELETE FROM listens WHERE uid = \?/.test(account)) {
    structureFail("the history is cleared without clearing the summaries");
  } else if (!/clearPlays\(db, uid\)/.test(account)) {
    structureFail("the history is not cleared through the helper that clears the summaries");
  } else if (!/movePlays\(db, fromUid, toUid\)/.test(merge)) {
    structureFail("moving a member's plays does not move their summaries");
  } else {
    structureOk("clearing the history and moving it clear the summaries too");
  }

  /* The tables have to be created by a migration. */
  const migrations = join(ROOT, "migrations");
  const files = readdirSync(migrations).filter((f) => f.endsWith(".sql"));
  const makes = files.some((f) => /CREATE TABLE IF NOT EXISTS listens_daily/.test(readFileSync(join(migrations, f), "utf8")));
  if (!makes) {
    structureFail("no migration creates the tables the summaries are kept in");
  } else {
    structureOk("a migration creates the tables the summaries are kept in");
  }

  /* And the helper has to be able to do without them, because the migration
     may not have run yet. */
  if (!/rollupAvailable/.test(listening) || !/rawStats/.test(listening)) {
    structureFail("the summaries have no fallback to the history");
  } else {
    structureOk("the summaries fall back to the history when the tables are not there");
  }
}

/* ---- the trending page reads the days it asks for ----
 *
 * The trending page asked two questions of the listening history: which
 * tracks were played most in the last seven days, and how many plays there
 * have been in total. Both read the whole of it - the filter was on the
 * timestamp alone, and the only indexes on the table lead with the member,
 * so the index could not be used and every play ever recorded was read to
 * throw most of them away.
 *
 * So the days it asks for are read from an index that leads with the
 * timestamp, and the total is counted day by day. */
{
  const trending = readFileSync(join(ROOT, "functions/api/trending.js"), "utf8");
  if (/COUNT\(\*\) AS total FROM listens/.test(trending)) {
    structureFail("the trending page counts the whole listening history for one number");
  } else if (!/totalPlays/.test(trending)) {
    structureFail("the trending page does not ask for the number of plays through the day count");
  } else {
    structureOk("the trending page reads the number of plays from the days, not from the history");
  }

  const migrations = join(ROOT, "migrations");
  const files = readdirSync(migrations).filter((f) => f.endsWith(".sql"));
  const indexed = files.some((f) =>
    /CREATE INDEX IF NOT EXISTS idx_listens_ts_track/.test(readFileSync(join(migrations, f), "utf8"))
  );
  if (!indexed) {
    structureFail("no index lets the trending page read only the days it asks for");
  } else {
    structureOk("an index lets the trending page read only the days it asks for");
  }

  /* And the plays have to be counted as they happen, or the number drifts
     from the truth. */
  const listening = readFileSync(join(ROOT, "functions/_lib/listens-stats.js"), "utf8");
  if (!/countPlay/.test(listening)) {
    structureFail("a play is not counted in the day it happened");
  } else if (!/uncountPlays/.test(listening)) {
    structureFail("clearing a member's plays does not take them out of the count");
  } else {
    structureOk("the plays are counted as they happen, and taken back out when they are cleared");
  }
}

/* ---- the visits are read once, not four times over ----
 *
 * The statistics were asked for four times over - the totals, the days, the
 * pages and the countries - and each one was a scan of the whole visits
 * table, so one request for the owner's panel read the table four times
 * over. The free tier counts rows read rather than queries, and the panel
 * asks again every thirty seconds.
 *
 * So the visits are read once and the summaries are made from what comes
 * back. */
{
  const stats = readFileSync(join(ROOT, "functions/api/stats.js"), "utf8");
  const owner = readFileSync(join(ROOT, "functions/api/owner.js"), "utf8");

  for (const [name, src] of [["stats.js", stats], ["owner.js", owner]]) {
    const reads = (src.match(/FROM analytics_visits/g) || []).length;
    if (reads > 1) {
      structureFail(name + " reads the visits table " + reads + " times for one set of statistics");
    } else if (reads === 0) {
      structureFail(name + " does not read the visits table at all");
    }
  }
  if (!/COUNT\(\*\) AS cnt FROM analytics_visits/.test(owner) &&
      !/COUNT\(\*\) as visits, COUNT\(DISTINCT uid\) as uniques FROM analytics_visits/.test(stats)) {
    structureOk("the visits are read once, and the summaries are made from them");
  } else {
    structureFail("the statistics still ask for the visits one summary at a time");
  }

  /* And the statistics are remembered, because the panel asks again and
     again and the numbers are the same each time. */
  if (!/STATS_CACHE/.test(stats)) {
    structureFail("the owner's statistics are read again for every request, though they have not changed");
  } else {
    structureOk("the owner's statistics are remembered for a few minutes");
  }
}

/* ---- the community list counts its replies once ----
 *
 * The reply count for each post was counted by a subquery for each post, so
 * one request for the list ran two hundred queries - and two hundred
 * queries is more than the ten milliseconds a request is allowed to take.
 *
 * So the counts are asked for once, for all of the posts at once. */
{
  const community = readFileSync(join(ROOT, "functions/api/community/[[path]].js"), "utf8");
  const i = community.indexOf("async function listPosts");
  const block = i === -1 ? "" : community.slice(i, community.indexOf("async function getPost", i));
  if (i === -1) {
    structureFail("the community list cannot be found");
  } else if (/SELECT COUNT\(\*\) FROM community_replies cr WHERE cr\.post_id = cp\.id/.test(block)) {
    structureFail("the community list counts the replies of each post with a query of its own");
  } else if (!/GROUP BY post_id/.test(block)) {
    structureFail("the community list does not count the replies of all of the posts at once");
  } else {
    structureOk("the community list counts the replies of all of the posts at once");
  }
}

/* ---- the summaries do not wait for a migration ----
 *
 * The tables the summaries are kept in are created by the code as well as
 * by the migration, so that the fix does not depend on the migration having
 * been applied. A database that has never seen them gets them the first
 * time they are needed - and creating a table reads no rows, so it works
 * even when the daily read limit has been reached.
 *
 * The site was down for hours with the daily limits reached, and the fix
 * was sitting in the code waiting for a migration that could not be applied
 * for the same reason. */
{
  const listening = readFileSync(join(ROOT, "functions/_lib/listens-stats.js"), "utf8");
  if (!/const SCHEMA = \[/.test(listening)) {
    structureFail("the tables the summaries are kept in are not written down in the code");
  } else if (!/CREATE TABLE IF NOT EXISTS listens_daily/.test(listening)) {
    structureFail("the code does not make the table the summaries are kept in");
  } else if (!/createTables/.test(listening)) {
    structureFail("the code never makes the tables it needs");
  } else {
    structureOk("the code makes the tables the summaries are kept in");
  }

  /* And a "no" is remembered for a minute, not for ever: an isolate that
     started while the limit was reached has to recover. */
  if (!/AVAILABILITY_RETRY_MS/.test(listening)) {
    structureFail("an isolate that started while the limit was reached never recovers");
  } else {
    structureOk("an isolate that started while the limit was reached recovers");
  }
}

/* ---- a playlist's tracks are asked for once, not once per playlist ----
 *
 * The account page and the profile used to walk the playlists one at a time
 * and ask for each one's tracks separately - a dozen playlists, a dozen
 * queries, every time either page was read. And the account is read on
 * every load and again after every save.
 *
 * So the tracks of all of the playlists are asked for at once.
 *
 * And because the account is read from a remembered copy for half a minute,
 * anything that changes the account has to drop that copy - otherwise the
 * account page carries on showing the playlists it had before one was
 * made. */
{
  const account = readFileSync(join(ROOT, "functions/api/account/index.js"), "utf8");
  const profile = readFileSync(join(ROOT, "functions/api/profile.js"), "utf8");
  const playlists = readFileSync(join(ROOT, "functions/api/playlists.js"), "utf8");

  for (const [name, src] of [["account/index.js", account], ["profile.js", profile]]) {
    if (/for \(const p of plRows\.results\)[\s\S]{0,400}?FROM playlist_tracks/.test(src)) {
      structureFail(name + " asks for the tracks of each playlist one at a time");
    } else if (!/loadPlaylistTracks/.test(src)) {
      structureFail(name + " does not ask for the tracks of all of the playlists at once");
    }
  }
  if (!/loadPlaylistTracks/.test(account) || !/loadPlaylistTracks/.test(profile)) {
    structureFail("a page asks for the tracks of each playlist one at a time");
  } else {
    structureOk("the tracks of all of the playlists are asked for at once");
  }

  if (!/invalidateAccountState/.test(playlists)) {
    structureFail("a playlist can be changed without the account page noticing");
  } else {
    structureOk("a playlist change drops the remembered copy of the account");
  }
}

/* ---- a panel asks for the state once, not for ever ----
 *
 * The push panel drew itself by asking the server for the state, and asked
 * again whenever the state had not arrived. The state was only marked as
 * loaded when it arrived - so for anybody the server would not give it to,
 * a visitor who is not signed in, or a server without a key, the two asked
 * each other for ever: the state was asked for, it failed, the panel asked
 * again, and it failed again.
 *
 * That was a request every few milliseconds, for as long as the panel was
 * open, on every visitor's machine. It is why the daily request limit was
 * reached so quickly - the site was making thousands of requests an hour
 * that asked nothing.
 *
 * So the attempt is remembered whatever the answer is, and the panel asks
 * once. */
{
  const push = readFileSync(join(ROOT, "push-client.js"), "utf8");
  const boot = readFileSync(join(ROOT, "bootstrap-client.js"), "utf8");

  /* The state comes with the bootstrap, and the bootstrap remembers that it
     has asked - once, and the answer whatever it was. A panel that asked
     again after a failure is what emptied the daily request limit. */
  if (!/function take\(key, fallback\)/.test(boot)) {
    structureFail("the bootstrap cannot hand an answer to a caller that waits for it");
  } else if (!/if \(loading\) return loading/.test(boot)) {
    structureFail("the bootstrap asks for itself again while a request is already under way");
  } else if (!/state\.tried = true/.test(push)) {
    structureFail("the push panel does not remember that it has asked for the state");
  } else if (!/if \(state\.tried\)/.test(push)) {
    structureFail("the push panel asks for the state again after it has already asked");
  } else if (!/bootTake\("push", ask\)/.test(push)) {
    structureFail("the push panel does not take its state from the bootstrap");
  } else {
    structureOk("the push panel takes its state from the bootstrap, and asks once");
  }
}

/* ---- the vault, the visits and the presence window ----
 *
 * Three more things that cost more every day than the day before.
 *
 * The Wanted vault is the most expensive read on the site - every track,
 * every reply and every vote, thousands of rows - and it is read on every
 * load of the page, and it grows for ever. The part of it that is the same
 * for everybody is remembered for a minute; the part that is about the
 * visitor is read fresh.
 *
 * The visits table and the search log are the same story: a row for every
 * visit and every search, kept for ever, read by a dashboard that only ever
 * shows the last few months. They are pruned as they are written to.
 *
 * And the presence window has to be wider than the heartbeat, or people are
 * marked offline and then online again, for as long as they stay. */
{
  const wanted = readFileSync(join(ROOT, "functions/api/wanted.js"), "utf8");
  const visit = readFileSync(join(ROOT, "functions/api/visit.js"), "utf8");
  const search = readFileSync(join(ROOT, "functions/api/search.js"), "utf8");
  const owner = readFileSync(join(ROOT, "functions/api/owner.js"), "utf8");
  const hub = readFileSync(join(ROOT, "workers/community-hub.js"), "utf8");

  if (!/loadShared/.test(wanted) || !/SHARED_TTL_MS/.test(wanted)) {
    structureFail("the Wanted vault is read from the history on every load");
  } else if (!/invalidateShared/.test(wanted)) {
    structureFail("the Wanted vault is remembered but never dropped when it changes");
  } else {
    structureOk("the part of the Wanted vault that is the same for everybody is remembered");
  }

  if (!/DELETE FROM analytics_visits WHERE ts < \?/.test(visit)) {
    structureFail("the visits table is never pruned, so it grows for ever");
  } else {
    structureOk("the visits table is pruned as it is written to");
  }

  if (!/DELETE FROM search_logs WHERE ts < \?/.test(search)) {
    structureFail("the search log is never pruned, so it grows for ever");
  } else {
    structureOk("the search log is pruned as it is written to");
  }

  if (!/OWNER_CACHE/.test(owner)) {
    structureFail("the owner's dashboard is read again for every poll of it");
  } else {
    structureOk("the owner's dashboard is remembered");
  }

  /* The presence window has to be wider than the heartbeat the clients
     send, or people flicker offline while they are sitting there. */
  const ttl = /PRESENCE_TTL_MS = (\d+)/.exec(hub);
  const hb = /wsHbTimer = setInterval\(function \(\) \{ wsSend\(\{ type: 'heartbeat' \}\); \}, (\d+)\)/.exec(readFileSync(join(ROOT, "presence.js"), "utf8"));
  if (!ttl || !hb) {
    structureFail("the presence window and the heartbeat cannot be compared");
  } else if (Number(ttl[1]) <= Number(hb[1])) {
    structureFail("the presence window (" + ttl[1] + "ms) is not wider than the heartbeat (" + hb[1] + "ms), so people flicker offline");
  } else {
    structureOk("the presence window is wider than the heartbeat");
  }
}

/* ---- the alarm wakes when something expires, and the account is read once ----
 *
 * An alarm that fires every two seconds is a request every two seconds, for
 * as long as the site has somebody on it: forty-three thousand of the
 * hundred thousand requests the day allows, spent on waking up to find that
 * nothing had expired. A typing indicator expires after three seconds and a
 * presence after ninety, so the wake is set for the moment the next thing
 * actually expires.
 *
 * And the account was read several times over before it had shown anything:
 * on the page opening, on every change of tab, and on every save, with
 * each read a request of its own. */
{
  const hub = readFileSync(join(ROOT, "workers/community-hub.js"), "utf8");
  const account = readFileSync(join(ROOT, "account.js"), "utf8");

  if (!/nextWakeDelay/.test(hub)) {
    structureFail("the alarm does not work out when the next thing expires");
  } else if (/setAlarm(Date.now() + TYPING_ALARM_MS)/.test(hub)) {
    structureFail("the alarm is still armed at the typing interval for everything, so it wakes every two seconds");
  } else {
    structureOk("the alarm wakes for the moment the next thing expires");
  }

  if (!/_accountLoading/.test(account)) {
    structureFail("the account is read again while a read of it is already under way");
  } else if (!/ACCOUNT_FRESH_MS/.test(account)) {
    structureFail("the account is read again straight after it has just been read");
  } else if (!/loadAccountNow/.test(account)) {
    structureFail("a change that has just been made is not shown at once");
  } else {
    structureOk("the account is read once, and a change is shown at once");
  }
}

/* ---------------------------------------------------------------------------
   The friend activity feed, the message menu and the rest of this batch

   These are the things a static check can say something useful about:

     - that the grammar check never sends the message anywhere. It is a
       check of what somebody is about to send, so the one thing it must
       never do is send it.
     - that the sharing settings are off by default. Everything about the
       feed is worthless if a new account is in everybody's feed before
       anybody has decided it should be.
     - that the message menu holds what it used to hold inline, so moving
       the buttons did not lose them.
     - that the reactions in the menu are the ones the server accepts.
--------------------------------------------------------------------------- */
{
  const socialPanel = readFileSync(join(ROOT, "social-panel.js"), "utf8");
  const grammar = readFileSync(join(ROOT, "grammar-check.js"), "utf8");
  const socialApi = readFileSync(join(ROOT, "functions/api/social/[[path]].js"), "utf8");
  const activityApi = readFileSync(join(ROOT, "functions/api/activity.js"), "utf8");
  const playerSettings = readFileSync(join(ROOT, "player-settings.js"), "utf8");
  const script = readFileSync(join(ROOT, "script.js"), "utf8");
  const migration49 = readFileSync(join(ROOT, "migrations/0049_friend_activity.sql"), "utf8");

  /* The grammar check runs in the page. Nothing about it may reach the
     network - a message is about to be sent to the server anyway, but the
     check itself must not hand it to anything else. */
  if (/\bfetch\s*\(/.test(grammar) || /XMLHttpRequest/.test(grammar) || /navigator\.sendBeacon/.test(grammar)) {
    structureFail("the grammar check sends the message somewhere");
  } else if (!/function check\(text\)/.test(grammar)) {
    structureFail("the grammar check has no check to speak of");
  } else {
    structureOk("the grammar check runs in the page and sends nothing anywhere");
  }

  /* The sharing settings are off by default. */
  if (!/activity_listening TEXT NOT NULL DEFAULT 'nobody'/.test(migration49)) {
    structureFail("listening activity is not off by default");
  } else if (!/activity_playlists TEXT NOT NULL DEFAULT 'nobody'/.test(migration49)) {
    structureFail("playlist activity is not off by default");
  } else if (!/activity_community TEXT NOT NULL DEFAULT 'nobody'/.test(migration49)) {
    structureFail("community activity is not off by default");
  } else if (!/|| "nobody"/.test(activityApi)) {
    structureFail("a missing settings row does not mean off");
  } else {
    structureOk("the friend activity settings are off until they are turned on");
  }

  /* The server decides who may see a row, on every read. */
  if (!/async function canSee/.test(activityApi)) {
    structureFail("the feed does not check who may see a row");
  } else if (!/blockedEitherWay/.test(activityApi)) {
    structureFail("the feed does not exclude somebody who has blocked the actor");
  } else if (!/visibility !== "friends"/.test(activityApi)) {
    structureFail("the feed does not honour the sharing setting when it reads");
  } else if (!/a.expires_at > ?/.test(activityApi)) {
    structureFail("an expired listening event is still shown");
  } else {
    structureOk("the feed checks the rules on every read");
  }

  /* The message menu holds what used to be inline. */
  if (!/function openMessageMenu/.test(socialPanel)) {
    structureFail("there is no message menu");
  } else if (!/add\("Reply", "reply"\)/.test(socialPanel)) {
    structureFail("the message menu has lost Reply");
  } else if (!/add\("Copy", "copy-message"\)/.test(socialPanel)) {
    structureFail("the message menu has lost Copy");
  } else if (!/add\("Grammar check", "grammar-check"\)/.test(socialPanel)) {
    structureFail("the message menu has lost the grammar check");
  } else if (!/add\("Report", "report-message"\)/.test(socialPanel)) {
    structureFail("the message menu has lost Report");
  } else {
    structureOk("the message menu holds Reply, Copy, the grammar check and Report");
  }

  /* The menu's reactions are the ones the server accepts. */
  const serverEmojis = (/const EMOJIS = (\[[^\]]*\])/.exec(socialApi) || [, "[]"])[1];
  const panelEmojis = (/var REACTIONS = (\[[^\]]*\])/.exec(socialPanel) || [, "[]"])[1];
  const serverSet = new Set((serverEmojis.match(/"[^"]+"/g) || []));
  const panelSet = new Set((panelEmojis.match(/"[^"]+"/g) || []));
  if (!serverSet.size) {
    structureFail("the server's reaction list could not be read");
  } else if (serverSet.size !== panelSet.size) {
    structureFail("the panel offers " + panelSet.size + " reactions and the server accepts " + serverSet.size);
  } else {
    let same = true;
    serverSet.forEach((e) => { if (!panelSet.has(e)) same = false; });
    if (!same) {
      structureFail("the panel offers a reaction the server will refuse");
    } else {
      structureOk("the panel offers every reaction the server accepts");
    }
  }

  /* The buttons that moved into the menu are not on the message any more. */
  const tools = socialPanel.slice(
    socialPanel.indexOf("function renderMessages"),
    socialPanel.indexOf("function renderMessages") + 6000
  );
  if (/dataset\.action = "copy-message"/.test(tools)) {
    structureFail("Copy is back on the message as well as in the menu");
  } else if (!/dataset\.action = "message-menu"/.test(tools)) {
    structureFail("there is no way to open the message menu from a message");
  } else {
    structureOk("the message tools live in the menu, and there is a way in");
  }

  /* The message id on a button is a string and the id in the message is a
     number, so they have to be compared as strings. Comparing them with
     === never matches, and the action quietly did nothing - which is what
     Copy did for as long as it was there. */
  if (/m\.id === messageId/.test(socialPanel)) {
    structureFail("a message is looked up by comparing a number with a string, so it is never found");
  } else if (!/String\(m\.id\) === String\(messageId\)/.test(socialPanel)) {
    structureFail("the message is not looked up at all");
  } else {
    structureOk("a message is looked up by its id, as a string");
  }

  /* The typing indicator is bounded. */
  if (!/TYPING_LIMIT/.test(socialPanel)) {
    structureFail("the typing indicator has no limit");
  } else if (!/TYPING_REFRESH_MS/.test(socialPanel)) {
    structureFail("the typing indicator is not repeated while the typing continues");
  } else {
    structureOk("the typing indicator is bounded, and it is repeated while it lasts");
  }

  /* The status indicator. */
  if (!/function statusDot/.test(socialPanel)) {
    structureFail("there is no status indicator");
  } else if (!/thw-social-status--online/.test(readFileSync(join(ROOT, "social.css"), "utf8"))) {
    structureFail("the status indicator has no style");
  } else {
    structureOk("the status indicator is there, in both tabs");
  }

  /* The foldable friends list is a desktop control. */
  if (!/data-action="toggle-friends"/.test(socialPanel)) {
    structureFail("the friends list cannot be folded away");
  } else if (!/@media \(min-width:681px\)\{\s*\.thw-social-friends-toggle\{display:inline-flex\}/.test(readFileSync(join(ROOT, "social.css"), "utf8"))) {
    structureFail("the fold control is not a desktop control");
  } else {
    structureOk("the friends list folds away, on a desktop only");
  }

  /* The Cover Gradients setting. */
  if (!/coverGradients: true/.test(playerSettings)) {
    structureFail("the cover gradients are not on by default");
  } else if (!/function coverGradientsOn/.test(script)) {
    structureFail("the covers do not answer to the setting");
  } else if (!/function getCoverGradientStyle/.test(script)) {
    structureFail("there is no cover gradient style to answer to it");
  } else if (!/ps-cover-gradients-toggle/.test(readFileSync(join(ROOT, "index.html"), "utf8"))) {
    structureFail("the Cover Gradients setting has no control");
  } else {
    structureOk("the Cover Gradients setting is on by default, and the covers answer to it");
  }

  /* The "mark all read" button says what it did, and the cache it reads from
     is marked too - otherwise the next poll brings the unread rows back and
     the button looks like it did nothing. */
  if (!/function markCachedNotificationsRead/.test(readFileSync(join(ROOT, "account.js"), "utf8"))) {
    structureFail("the mark all read button does not mark the cached rows, so the next poll undoes it");
  } else {
    structureOk("the mark all read button marks the cache as well as the screen");
  }
}

/* ---------------------------------------------------------------------------
   The bootstrap answers in the same shapes as the endpoints it stands in

   The bootstrap was asked for the answers the endpoints give, so that one
   request could carry several of them. But the shapes drifted: the
   bootstrap handed over a bare list of trending rows and a drops object
   without its "ok", and the clients - which look for that "ok" before they
   draw anything - threw both sections away.

   So the trending strip and the Drops & Events section were simply not on
   the page, and nothing said why. The gate below is the shape check, and
   the clients were made to read either shape rather than throw the section
   away over it. */
{
  const bootstrap = readFileSync(join(ROOT, "functions/api/bootstrap.js"), "utf8");
  const trending = readFileSync(join(ROOT, "trending.js"), "utf8");
  const drops = readFileSync(join(ROOT, "drops.js"), "utf8");

  if (!/trending: \{ ok: true, days: 7, trending, total_listens: totalListens \}/.test(bootstrap)) {
    structureFail("the bootstrap does not answer with the trending endpoint's shape");
  } else if (!/drops = \{ ok: true, live, upcoming, past \}/.test(bootstrap)) {
    structureFail("the bootstrap does not answer with the drops endpoint's shape");
  } else if (!/Array\.isArray\(d\)/.test(trending)) {
    structureFail("the trending section is thrown away over a shape");
  } else if (!/d\.ok === false/.test(drops)) {
    structureFail("the drops section is thrown away over a shape");
  } else {
    structureOk("the bootstrap answers in the shapes the endpoints answer in");
  }
}

/* ---------------------------------------------------------------------------
   The stylesheets have to parse

   A comment that closes twice leaves a stray line behind, and the parser
   reads it as a rule it cannot make sense of - and swallows the next rule
   with it. Six of them went in at once, and the rule after each was gone:
   the message menu, the grammar check and four others. The site looked
   broken in a way nothing in the source said it should.

   The check is the shape of the comment: a line of dashes with a terminator
   on it, and nothing before it that ends the comment as well. */
{
  const stylesheets = ["social.css", "about.css", "community-realtime.css", "player-settings.css", "account.css", "style.css"];
  let cssBad = 0;
  for (const file of stylesheets) {
    const path = join(ROOT, file);
    if (!existsSync(path)) continue;
    const lines = readFileSync(path, "utf8").split(/\r?\n/);
    for (let i = 1; i < lines.length; i++) {
      if (!/^\s*-{10,}\s*\*\/\s*$/.test(lines[i])) continue;
      let j = i - 1;
      while (j >= 0 && lines[j].trim() === "") j--;
      if (j >= 0 && /\*\/\s*$/.test(lines[j])) {
        structureFail(file + " has a comment that closes twice - the rule after it is dropped");
        cssBad++;
      }
    }
  }
  if (!cssBad) {
    structureOk("every stylesheet comment closes once");
  }

  /* And the rules this batch added are actually in the file - the parser
     dropping one is invisible in the source. */
  const socialCss = readFileSync(join(ROOT, "social.css"), "utf8");
  const wanted = [
    ".thw-social-menu{position:fixed",
    ".thw-social-grammar{position:fixed",
    ".thw-social-status--online",
    ".thw-social-face",
    ".thw-social-friends-toggle",
    ".thw-social-expand",
    ".thw-social-activity",
    ".thw-social-group{position:fixed",
    ".thw-social-track{",
  ];
  const missing = wanted.filter((rule) => socialCss.indexOf(rule) === -1);
  if (missing.length) {
    structureFail("social.css is missing " + missing.length + " rule(s) - " + missing[0]);
  } else {
    structureOk("the panel's rules are all in the stylesheet");
  }
}

/* ---- the markup does not draw stray brackets ----
 *
 * A ">" on its own is not a tag. It is a character, and the browser draws it
 * as text - three of them were in index.html, and they read on the page as a
 * pair of little arrows at the left of the WRLD Player and a stray mark
 * under the footer.
 *
 * The count of ">>" is not enough to catch them: one of the three had three
 * in a row, and fixing the count left one of them behind. What is needed is
 * the text a browser would actually draw, so the markup is walked the way a
 * browser walks it - comments and raw-text elements skipped, quoted
 * attribute values honoured - and every piece of text is looked at. */
{
  const html = readFileSync(join(ROOT, "index.html"), "utf8");

  const textOf = (src) => {
    const out = [];
    let i = 0;
    while (i < src.length) {
      if (src.startsWith("<!--", i)) {
        const j = src.indexOf("-->", i + 4);
        i = j < 0 ? src.length : j + 3;
        continue;
      }
      const raw = src.slice(i).match(/^<(script|style)\b/i);
      if (raw) {
        const close = src.toLowerCase().indexOf("</" + raw[1], i);
        i = close < 0 ? src.length : close;
        continue;
      }
      if (src[i] === "<") {
        /* A tag: its end is the first ">" outside a quoted value. */
        let j = i + 1;
        let quote = null;
        while (j < src.length) {
          const c = src[j];
          if (quote) { if (c === quote) quote = null; }
          else if (c === '"' || c === "'") quote = c;
          else if (c === ">") break;
          j++;
        }
        i = j + 1;
        continue;
      }
      let j = i;
      while (j < src.length && src[j] !== "<") j++;
      out.push(src.slice(i, j));
      i = j;
    }
    return out;
  };

  const strays = textOf(html).filter((t) => t.indexOf(">") >= 0);
  if (strays.length) {
    structureFail(
      "index.html draws " + strays.length + " stray \">\" character(s) - " +
      strays.slice(0, 3).map((t) => JSON.stringify(t.trim().slice(0, 60))).join(", ")
    );
  } else {
    structureOk("the markup draws no stray brackets");
  }
}

/* ---- the critical CSS is in the page, and the big stylesheet is not
   holding the first paint ----
 *
 * The big stylesheet is 293 KB. It sat on the critical path, so the browser
 * would not paint anything until all of it had arrived - and what was being
 * painted was a splash screen with one button on it. The rules that apply
 * to what is on the screen are now in the page itself, and the stylesheet
 * arrives a moment later.
 *
 * The copy has to sit exactly where the link to the stylesheet was, or the
 * cascade changes: the stylesheets after it would no longer be the ones
 * with the last word. */
{
  const page = readFileSync(join(ROOT, "index.html"), "utf8");
  const css = readFileSync(join(ROOT, "player-settings.css"), "utf8");
  const at = page.indexOf('<style id="thw-critical">');
  if (at < 0) {
    structureFail("index.html has no critical CSS - the page waits for the whole stylesheet to paint");
  } else {
    const end = page.indexOf("</style>", at);
    const block = page.slice(at, end);
    const link = page.indexOf("player-settings.css?v=thw-v", at);
    if (block.length < 2000) {
      structureFail("the critical CSS is only " + block.length + " bytes - it is not the rules for the first screen");
    } else if (link < 0 || link > end + 400) {
      structureFail("the critical CSS does not sit where the stylesheet was - the cascade has changed");
    } else if (page.indexOf('media="print"', link) < 0) {
      structureFail("the big stylesheet is still on the critical path");
    } else if (css.indexOf("THE CRITICAL CSS IS A COPY OF THIS FILE") < 0) {
      structureFail("player-settings.css does not say that the copy in index.html has to be taken again when it changes");
    } else {
      structureOk("the critical CSS is in the page and the big stylesheet is off the critical path");
    }
  }
}


/* ---- the footer and the deck, on a phone ----
 *
 * The footer's columns were one under another, so the footer was four
 * screens tall on a 430px-wide phone. They sit side by side now.
 *
 * The WRLD Deck was hidden below 480px - and the full-screen mobile
 * player opens from the deck, so hiding the deck hid the only way into
 * it. A phone had no way at all of seeing what was playing.
 *
 * The floating chrome - the presence badges, the chat button, the night
 * light, the scroll-to-top - is fixed to the screen, so the footer's own
 * bottom bar ended up underneath it. A class on the root says the
 * footer is on screen, and the chrome gets out of the way.
 */
{
  const css = readFileSync(join(ROOT, "player-settings.css"), "utf8");
  const js = readFileSync(join(ROOT, "player-performance.js"), "utf8");
  const script = readFileSync(join(ROOT, "script.js"), "utf8");

  /* The media blocks themselves, so a rule inside one can be looked for.
     There is more than one of each: the file has had a phone block since
     long before the Deck came back to a phone, and a rule added later is
     in a block of its own. Every block is gathered, and the last one of
     each kind wins - which is what the browser does. */
  const mediaBlock = (query) => {
    const found = [];
    let at = css.indexOf(query);
    while (at >= 0) {
      const open = css.indexOf("{", at);
      let depth = 1, i = open + 1;
      while (i < css.length && depth > 0) {
        if (css[i] === "{") depth++;
        else if (css[i] === "}") depth--;
        i++;
      }
      found.push(css.slice(open + 1, i - 1));
      at = css.indexOf(query, i);
    }
    return found.join("\n");
  };
  const phone = mediaBlock("@media (max-width:520px)");
  const phoneUp = mediaBlock("@media (max-width:767px)");

  /* The footer's columns, side by side on a phone. */
  if (!/\.foot-cols\s*\{[^}]*repeat\(2,/.test(phone)) {
    structureFail("the footer's columns are not side by side on a phone - the footer is four screens tall");
  } else if (!/\.foot-note\{flex:1 1 100%\}/.test(phone) || !/\.foot-meta\{[^}]*margin-left:auto/.test(phone)) {
    structureFail("the footer's bottom bar does not put the disclaimer on its own line and the date against the right edge on a phone");
  } else {
    structureOk("the footer's columns sit side by side on a phone, and its bottom bar wraps");
  }

  /* The floating chrome, out of the footer's way. */
  if (!/html\.foot-in-view #site-online-badge/.test(css) || !/html\.foot-in-view #scrollTopBtn/.test(css)) {
    structureFail("the floating chrome is not moved out of the footer's way");
  } else if (js.indexOf("foot-in-view") < 0 || js.indexOf("IntersectionObserver") < 0) {
    structureFail("nothing sets the class that moves the floating chrome out of the footer's way");
  } else {
    structureOk("the floating chrome gets out of the footer's way");
  }

  /* The footer's head - the mark, who made it, and the way into the Legal
     & Info panel - is stacked and centred, the way the old footer's brand
     block was. And the Terms of Use, the Privacy Policy and the DMCA are
     out of the column of links: the Legal & Info panel, which is the button
     right beside them, is where all three live.
     There is one way into that panel, not two - the bottom bar had its own
     Legal & Info button opening the same door. */
  const page = readFileSync(join(ROOT, "index.html"), "utf8");
  const footStart = page.indexOf('class="foot-brand"');
  const footEnd = page.indexOf("</footer>", footStart);
  const foot = footStart < 0 || footEnd < 0 ? "" : page.slice(footStart, footEnd);
  const legalButtons = (foot.match(/data-legal-info/g) || []).length;
  if (!/\.foot-brand\{[^}]*flex-direction:column/.test(css)) {
    structureFail("the footer's head is not stacked - the mark, the maker and the Legal & Info button lie across the page");
  } else if (!/\.foot-brand\{[^}]*align-items:center/.test(css)) {
    structureFail("the footer's head is not centred");
  } else if (/\/TOS\"|\/PP\"|\/DMCA\"/.test(foot)) {
    structureFail("the footer's column still lists the Terms of Use, the Privacy Policy or the DMCA - the Legal & Info panel has all three");
  } else if (legalButtons !== 1) {
    structureFail("the footer offers " + legalButtons + " ways into the Legal & Info panel - there should be one");
  } else if (/foot-mark|foot-made/.test(foot)) {
    structureFail("the footer's bottom bar still has the 999 or the Made by line - both are at the top of the footer already");
  } else {
    structureOk("the footer's head is stacked and centred, and there is one way into the Legal & Info panel");
  }

  /* The bottom bar: the disclaimer on the left, the date on the right. */
  const barStart = foot.indexOf('class="foot-bar"');
  const bar = barStart < 0 ? "" : foot.slice(barStart);
  const noteAt = bar.indexOf('class="foot-note"');
  const metaAt = bar.indexOf('class="foot-meta"');
  if (noteAt < 0 || metaAt < 0 || metaAt < noteAt) {
    structureFail("the footer's bottom bar does not have the disclaimer before the date");
  } else if (!/justify-content:space-between/.test(css)) {
    structureFail("the footer's bottom bar does not put the two ends apart");
  } else {
    structureOk("the footer's bottom bar is the disclaimer on the left and the date on the right");
  }

  /* The deck on a phone: shown, sitting above the navigation, and opening
     the full-screen player when it is tapped. */
  if (!/#deck-player\s*\{[^}]*display:block\s*!important/.test(phoneUp)) {
    structureFail("the WRLD Deck is not shown on a phone - and the full-screen player opens from it");
  } else if (!/bottom:calc\(var\(--mbn-h/.test(phoneUp)) {
    structureFail("the WRLD Deck does not sit above the bottom navigation on a phone");
  } else if (script.indexOf("openMobilePlayer") < 0) {
    structureFail("tapping the WRLD Deck on a phone does not open the full-screen player");
  } else {
    structureOk("the WRLD Deck is on the phone, above the navigation, and opens the full-screen player");
  }
}


/* ---- the Covers wall's loader, and the nav's Trending icon ----
 *
 * The loader was a div with the words 'Loading More Covers' on it. The
 * only thing that grew the wall was an IntersectionObserver, and that
 * only exists in browsers that already know what to do with it - so on
 * every modern browser the label sat there saying it was loading more
 * covers and nothing happened when you touched it.
 *
 * And the batches never finished: they waited for pictures that carried
 * `loading="lazy"`, and the browser does not fetch a lazy picture that
 * is nowhere near the screen. So the wall stopped at the first twenty-
 * four and the spinner turned for ever.
 *
 * The nav's Trending button wore a flame, which reads as 'hot'. What it
 * opens is a list of what people are listening to most, which is a line
 * going up.
 */
{
  const page = readFileSync(join(ROOT, "index.html"), "utf8");
  const wall = readFileSync(join(ROOT, "credits-wall.js"), "utf8");
  const wallCss = readFileSync(join(ROOT, "credits-wall.css"), "utf8");

  /* The wall grows as the reader scrolls. It used to be a button, and the
     label said it was loading more covers while nothing was loading at
     all - because the batches waited for pictures the browser was not
     going to fetch until they were on the screen. */
  if (!/<div class="cw-more" data-cw-more>/.test(wall)) {
    structureFail("the Covers wall's loader is not the label it was - the wall grows as the reader scrolls");
  } else if (/moreEl\.addEventListener\("click"/.test(wall)) {
    structureFail("the Covers wall's loader is a button again - it should grow as the reader scrolls");
  } else if (!/img\.loading = "eager"/.test(wall)) {
    structureFail("the Covers wall's batches still wait for pictures the browser will not fetch until they are on the screen");
  } else if (!/setTimeout\(function \(\) \{\s*if \(finished\) return;/.test(wall)) {
    structureFail("a picture that never answers can hold the whole Covers wall hostage");
  } else if (!/Scroll for More Covers/.test(wall)) {
    structureFail("the Covers wall's loader does not say that the wall grows as the reader scrolls");
  } else {
    structureOk("the Covers wall grows as the reader scrolls, and its batches finish");
  }

  if (/id="page-nav-trending"/.test(page)) {
    structureFail("the nav's Trending arrow is still in the pill nav - there is no Trending page, the list lives inside the player, and the button was asked to go");
  } else {
    structureOk("the nav's Trending arrow is gone from the pill nav");
  }
}


/* ---- the footer's links, the Deck's opacity, and Bluetooth ----
 *
 * The RSS feed is out of the footer, and so is all of its code: the
 * endpoint, the test, and the row in the Public API page that named it.
 * The Community Board is out of the footer's list of links.
 *
 * The Deck can be see-through, in steps, and remembers how see-through
 * it was left. And there is a Bluetooth button in the Deck and in the
 * WRLD Player, so the music can go to a speaker without wires.
 */
{
  const page = readFileSync(join(ROOT, "index.html"), "utf8");
  const css = readFileSync(join(ROOT, "player-settings.css"), "utf8");
  const deck = readFileSync(join(ROOT, "deck.js"), "utf8");
  const footStart = page.indexOf('class="foot-brand"');
  const footEnd = page.indexOf("</footer>", footStart);
  const foot = footStart < 0 || footEnd < 0 ? "" : page.slice(footStart, footEnd);

  if (existsSync(join(ROOT, "functions", "feed.xml.js"))) {
    structureFail("the RSS feed's endpoint is still there");
  } else if (/feed\.xml/.test(page)) {
    structureFail("something still points at the RSS feed");
  } else if (/RSS feed/i.test(foot)) {
    structureFail("the footer's column still has the RSS feed in it");
  } else if (/Community Board/.test(foot)) {
    structureFail("the footer's column still has the Community Board in it");
  } else {
    structureOk("the RSS feed and the Community Board are out of the footer, and the feed's code is gone");
  }

  if (!/<select[^>]*id="deck-opacity"/.test(page) || !/"deck-opacity"/.test(deck)) {
    structureFail("the WRLD Deck has no opacity, or the choice is not remembered");
  } else if (!/thw-deck-opacity/.test(deck)) {
    structureFail("the WRLD Deck's opacity is not remembered");
  } else if ((page.match(/data-thw-bluetooth/g) || []).length < 2) {
    structureFail("the Bluetooth button is not in both the WRLD Deck and the WRLD Player");
  } else if (!/\.deck-opacity\{/.test(css)) {
    structureFail("the WRLD Deck's opacity dropdown has no styling");
  } else {
    structureOk("the WRLD Deck has an opacity that is remembered, and both it and the player have a Bluetooth button");
  }
}

failures += structureFailures;

process.exit(failures ? 1 : 0);