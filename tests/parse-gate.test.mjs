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

import { readFileSync, existsSync } from "node:fs";
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

const curAbout = aboutBlockOf(html);
const baseAbout = aboutBlockOf(
  execFileSync("git", ["show", `${BASELINE_REV}:index.html`], {
    maxBuffer: 64 * 1024 * 1024,
  }).toString("utf8"),
);

if (!curAbout || !baseAbout) {
  structureFail("could not isolate the About block (needs '<div class=\"abp-page\">' then page-section-partner)");
} else {
  /* The Info tab contributes exactly two sections and four jump links and
     nothing else matching these patterns. Any other difference means the tab
     edit ate or duplicated original content. */
  const expectedDelta = [
    ['<section class="abp-sec"', 2],
    ['class="abp-social"', 0],
    ['releases/download/v1\\.0\\.1', 0],
    ['class="abp-card-top abp-link"', 4],
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
 * five tracks at a time) and 7 more were wrong. cover-gradients.js now supplies
 * all of them, derived from the artwork. This asserts that no track in the vault
 * reaches the hash fallback, and that the fixes file actually loads after
 * script.js - coverGradientMap is declared with `var`, so the merge only works
 * if script.js has already run.
 */
const coverGradientSrc = readFileSync(join(ROOT, "cover-gradients.js"), "utf8");
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
  // Merge in what cover-gradients.js will add, then resolve every track's cover.
  const extraKeys = [...coverGradientSrc.matchAll(/^\s{4}"([^"]+)":\s*"linear-gradient/gm)].map((m) => m[1]);
  const merged = { ...vaultMap };
  const pairs = [...coverGradientSrc.matchAll(/^\s{4}"([^"]+)":\s*("(?:[^"\\]|\\.)*")/gm)];
  for (const [, k, v] of pairs) merged[k] = JSON.parse(v);

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
    structureOk(`all ${list2.length} covers resolve to a real gradient, none to the filename hash`);
  }
  if (extraKeys.length) structureOk(`cover-gradients.js supplies ${extraKeys.length} map keys`);
  else structureFail("cover-gradients.js contains no gradient entries");
}

/* The merge only works after script.js has run, since coverGradientMap is a `var`
   there. */
const cgTag = html.indexOf("./cover-gradients.js?");
const scriptTag2 = html.indexOf("./script.js?");
if (cgTag === -1) structureFail("cover-gradients.js is not referenced by index.html");
else if (cgTag < scriptTag2) structureFail("cover-gradients.js loads before script.js, so coverGradientMap does not exist yet");
else structureOk("cover-gradients.js loads after script.js, so the merge has somewhere to land");

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

/* The same check against what the browser actually parsed, which is the only
   place the nesting above was ever going to show up. */
failures += structureFailures;

process.exit(failures ? 1 : 0);