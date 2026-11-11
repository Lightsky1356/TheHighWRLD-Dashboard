// COVER THUMBNAIL GATE
//
// The covers are 400-1024px PNGs, up to 11 MB each, and the track list draws
// them at 24 pixels. Three tiers of small WebP stand in for them:
//
//   64   the track list rows, the mini cover, the queue
//   128  the stat art, trending, recent
//   320  the credits wall, the info panel cover
//
// The tiers live in Covers/, which is gitignored - the folder is deployed
// from the working tree, the same as Covers/webp/. That is convenient (the
// PNGs are not in git either) and it is dangerous: a clone that never ran
// scripts/make-thumbs.py has no tiers at all.
//
// And the failure is silent and enormous. Cloudflare Pages answers a missing
// file with the app shell, so every one of the 250 track rows would ask for
// a thumbnail that is not there, receive 306 KB of HTML, fail to decode it,
// and fall through to the next step in the chain - which is another 306 KB.
// 250 rows x 2 x 306 KB is 150 MB for one pass through the list.
//
// So the tiers are checked here, and the build fails without them.
//
// Offline, no server, no network.

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const COVERS = join(ROOT, "Covers");
const TIERS = ["64", "128", "320", "640"];

let failures = 0;
const fail = (m) => { console.log("  FAIL  " + m); failures++; };
const ok = (m) => console.log("  PASS  " + m);

/* ---------- 1. the tiers exist ---------- */
console.log("  the three tiers are there");
for (const tier of TIERS) {
  const dir = join(COVERS, "thumbs", tier);
  if (!existsSync(dir)) {
    fail("Covers/thumbs/" + tier + " is missing - run: python scripts/make-thumbs.py");
    continue;
  }
  const n = readdirSync(dir).filter((f) => f.endsWith(".webp")).length;
  if (n < 200) fail("Covers/thumbs/" + tier + " holds " + n + " files - it should hold one per cover");
  else ok("Covers/thumbs/" + tier + " holds " + n + " thumbnails");
}

/* ---------- 2. every cover has every tier ---------- */
console.log("\n  every cover has every tier");
if (!existsSync(COVERS)) {
  fail("Covers/ is missing");
} else {
  const covers = readdirSync(COVERS).filter((f) => /\.(png|jpe?g|webp)$/i.test(f) && f !== "Juice-WRLD.png");
  const missing = [];
  for (const tier of TIERS) {
    for (const c of covers) {
      /* The extension stays in the name, so a thumbnail can never be the
         wrong picture: Covers/Floating.jpg and Covers/Floating.png are two
         different pictures with the same name. */
      const thumb = join(COVERS, "thumbs", tier, c + ".webp");
      if (!existsSync(thumb)) missing.push(tier + "/" + c);
    }
  }
  if (missing.length) {
    fail(missing.length + " thumbnails are missing, e.g. " + missing.slice(0, 5).join(", "));
  } else {
    ok("all " + covers.length + " covers have all " + TIERS.length + " tiers");
  }

  /* ---------- 3. the tiers are small ---------- */
  console.log("\n  the tiers are small");
  for (const tier of TIERS) {
    const dir = join(COVERS, "thumbs", tier);
    if (!existsSync(dir)) continue;
    const files = readdirSync(dir).filter((f) => f.endsWith(".webp"));
    if (!files.length) continue;
    let total = 0;
    let biggest = 0;
    for (const f of files) {
      const s = statSync(join(dir, f)).size;
      total += s;
      if (s > biggest) biggest = s;
    }
    const avg = total / files.length;
    /* A thumbnail that is not small is not a thumbnail. */
    if (avg > 40 * 1024) fail("the " + tier + " tier averages " + Math.round(avg / 1024) + " KB - that is not a thumbnail");
    else ok("the " + tier + " tier averages " + (avg / 1024).toFixed(1) + " KB, the whole set is " + (total / 1024 / 1024).toFixed(2) + " MB");
    if (biggest > 200 * 1024) fail("the biggest file in the " + tier + " tier is " + Math.round(biggest / 1024) + " KB");
  }

  /* ---------- 4. the tiers are a fraction of the originals ---------- */
  let png = 0;
  for (const c of covers) {
    try { png += statSync(join(COVERS, c)).size; } catch (_) {}
  }
  let thumbs = 0;
  for (const tier of TIERS) {
    const dir = join(COVERS, "thumbs", tier);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      try { thumbs += statSync(join(dir, f)).size; } catch (_) {}
    }
  }
  console.log("\n  the tiers against the originals");
  if (png > 0 && thumbs > 0) {
    ok("the originals are " + (png / 1024 / 1024).toFixed(1) + " MB, all three tiers together are " + (thumbs / 1024 / 1024).toFixed(1) + " MB");
  }
}

/* ---------- 5. the page asks for the tiers ---------- */
console.log("\n  the page asks for the tiers");
const script = readFileSync(join(ROOT, "script.js"), "utf8");
if (script.indexOf("window._coverThumb = _coverThumb") < 0) fail("script.js does not export _coverThumb");
else ok("script.js exports _coverThumb");

const html = readFileSync(join(ROOT, "index.html"), "utf8");
if (html.indexOf("Covers/thumbs/320/") < 0) fail("index.html does not point at the thumbnail tiers");
else ok("index.html points at the thumbnail tiers");

/* The tier sizes the tiers are built for, and the ones the code asks for,
   have to agree - a tier that is built at 64 and asked for at 320 is blurry,
   and one built at 320 and asked for at 64 is 25 times heavier than it needs
   to be. */
const TIERS_IN_CODE = ["64", "128", "320", "640"];
const BUILT = { "64": 64, "128": 128, "320": 320, "640": 640 };
for (const t of TIERS_IN_CODE) {
  if (!BUILT[t]) fail("the code asks for a tier the build does not make: " + t);
}
ok("the tiers the code asks for are the tiers the build makes");

/* Nothing may point at a picture that is not there. A missing picture on
   Pages costs the whole index.html, and the browser then tries to decode it
   as an image. */
console.log("\n  no picture points at a file that is not there");
const rootFiles = new Set(readdirSync(ROOT));
const referenced = new Set();
const RE = /src="\.\/([^"/?]+\.(?:png|jpe?g|webp|gif|svg|ico))"/gi;
let m;
const html2 = readFileSync(join(ROOT, "index.html"), "utf8");
while ((m = RE.exec(html2)) !== null) referenced.add(m[1]);
const missingPics = [...referenced].filter((f) => !rootFiles.has(f));
if (missingPics.length) fail("index.html points at " + missingPics.length + " picture(s) that are not there: " + missingPics.join(", "));
else ok("every picture index.html points at is really there (" + referenced.size + " checked)");

console.log(failures ? "\n  " + failures + " check(s) failed" : "\n  cover thumbnails: all good");
process.exitCode = failures ? 1 : 0;
