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

process.exit(failures ? 1 : 0);