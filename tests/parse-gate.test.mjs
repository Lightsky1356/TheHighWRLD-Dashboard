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

/* ---- 6. URL routing is wired up correctly ----
 *
 * router.js only works because it loads after script.js. Every script is deferred,
 * so they execute in document order, and script.js installs the switchAppPage
 * wrapper that router.js wraps. If the tag is ever moved above script.js, the
 * router captures nothing, warns once in the console, and URL routing silently
 * does nothing - deep links would keep falling back to the home page with no
 * other symptom. */
const ROUTER = "router.js";
const routerAt = html.indexOf(`./${ROUTER}?`);
const scriptAt = html.indexOf("./script.js?");
if (routerAt === -1) {
  structureFail(`${ROUTER} is not referenced by index.html, so /about and /partner are not routed`);
} else if (routerAt < scriptAt) {
  structureFail(`${ROUTER} loads before script.js and cannot wrap switchAppPage; move its script tag after script.js`);
} else {
  structureOk(`${ROUTER} loads after script.js, so it wraps the real switchAppPage`);
}

/* A route pointing at a section that is missing, or buried inside another one,
 * is the exact failure the About tab split caused: the URL resolves fine and the
 * page stays blank. So each route is checked against the section it targets. */
const routerSrc = existsSync(join(ROOT, ROUTER)) ? readFileSync(join(ROOT, ROUTER), "utf8") : "";
const routed = [...routerSrc.matchAll(/\[\s*"(\/[^"]+)"\s*,\s*"([a-z0-9-]+)"\s*\]/g)].map((mm) => ({ path: mm[1], page: mm[2] }));
if (!routed.length) {
  structureFail(`no routes found in ${ROUTER}; the Map should hold ["/about", "about"]-style pairs`);
} else {
  let routeOk = true;
  for (const r of routed) {
    const id = `page-section-${r.page}`;
    if (!depths.has(id)) {
      structureFail(`route ${r.path} targets ${id}, which does not exist`);
      routeOk = false;
    } else if (depths.get(id) !== 1 && !(depths.get(id) === 2 && ALWAYS_NESTED.has(id))) {
      structureFail(`route ${r.path} targets ${id}, which is nested and can never be shown`);
      routeOk = false;
    }
  }
  if (routeOk) {
    structureOk(`${routed.length} routes resolve to showable sections: ${routed.map((r) => r.path).join(", ")}`);
  }
}

failures += structureFailures;

process.exit(failures ? 1 : 0);