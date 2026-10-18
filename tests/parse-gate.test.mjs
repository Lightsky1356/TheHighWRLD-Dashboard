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
failures += structureFailures;

process.exit(failures ? 1 : 0);