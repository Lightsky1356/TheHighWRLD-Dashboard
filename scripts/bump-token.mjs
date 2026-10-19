/* Cache-token management for the app shell.
 *
 * WHY THIS EXISTS
 * Two assets are cached with a plain ?v=N token and the rest with ?v=thw-vN.
 * i18n.js was the one that kept getting missed: a helper that only understood
 * thw-vN threw on it, the error was easy to lose in the noise, and i18n.js sat
 * unchanged through three commits that altered its contents. Returning visitors
 * then kept running the old copy.
 *
 * So this handles BOTH schemes, and refuses to touch a file whose asset does
 * not actually exist - a silent no-op is how the original got lost.
 *
 * Usage:
 *   node scripts/bump-token.mjs <asset.js|css> [<asset2> ...]
 *
 * A name with no extension gets .js appended. With no arguments it reports
 * every asset's current token and whether it matches the file's content.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const HTML = path.join(ROOT, "index.html");
const SW = path.join(ROOT, "sw.js");

/* The two token schemes in use. Both are matched, and the one that is actually
 * present in the file is the one that gets bumped. */
const THW = "thw-v";
const NUM = /\?v=(\d+)(?![\w-])/;

/* Files that are cached and therefore need a token. Anything referenced from
 * index.html with a ?v= qualifies; this is derived rather than hard-coded so a
 * new asset cannot be forgotten. */
function cachedAssets() {
  const html = fs.readFileSync(HTML, "utf8");
  const out = new Map();
  const re = /["'./]([A-Za-z0-9._-]+\.(?:js|css))\?v=([^"'&)\s]+)/g;
  let m;
  while ((m = re.exec(html))) out.set(m[1], m[2]);
  return out;
}

/** The token scheme an asset currently uses, or null if it has none. */
function schemeOf(token) {
  if (!token) return null;
  if (token.startsWith(THW)) return "thw";
  if (/^\d+$/.test(token)) return "num";
  return "other";
}

function bumpOne(token) {
  const s = schemeOf(token);
  if (s === "thw") {
    const n = parseInt(token.slice(THW.length), 10);
    if (!Number.isFinite(n)) throw new Error(`cannot parse thw token "${token}"`);
    return THW + (n + 1);
  }
  if (s === "num") return String(parseInt(token, 10) + 1);
  throw new Error(`unrecognised token "${token}" - refusing to guess`);
}

const args = process.argv.slice(2);
const assets = cachedAssets();

if (!args.length) {
  console.log("\n  asset                      index.html        sw.js            scheme");
  console.log("  " + "-".repeat(74));
  const sw = fs.readFileSync(SW, "utf8");
  for (const [name, token] of [...assets].sort()) {
    const inSw = sw.includes(`./${name}?v=${token}`);
    console.log(
      `  ${name.padEnd(26)} ${token.padEnd(18)} ${(inSw ? token : "MISSING").padEnd(16)} ${schemeOf(token)}`,
    );
  }
  console.log("");
  process.exit(0);
}

let changed = 0;
for (const raw of args) {
  const name = raw.includes(".") ? raw : raw + ".js";
  const current = assets.get(name);
  if (!current) {
    console.error(`  ${name}: not referenced from index.html with a ?v= token - refusing`);
    process.exitCode = 1;
    continue;
  }
  const next = bumpOne(current);
  // Replace every occurrence of this asset's exact current token.
  for (const file of [HTML, SW]) {
    const t = fs.readFileSync(file, "utf8");
    const re = new RegExp(`(${name.replace(/\./g, "\\.")}\\?v=)${current.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "g");
    if (!re.test(t)) continue;
    fs.writeFileSync(file, t.replace(re, `$1${next}`), "utf8");
    console.log(`  ${path.basename(file)}: ${name} ${current} -> ${next}`);
  }
  changed++;
}

if (changed) {
  console.log(`\n  ${changed} asset(s) bumped.`);
  console.log("  Remember: sw.js VERSION must also move, or the service worker keeps");
  console.log("  serving the old precache entry.");
}
