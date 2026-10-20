/* Verify the app-shell cache tokens.
 *
 * FOUR THINGS ARE CHECKED, because each has actually gone wrong here:
 *
 * 1. index.html and sw.js must agree on every asset's token. A mismatch means
 *    the service worker precaches a different file from the one the page asks
 *    for, so one of them is served stale forever.
 *
 * 2. Every referenced asset must actually exist on disk.
 *
 * 3. A token must have moved since the asset's CONTENT last moved. This is the
 *    check that was missing. Comparing index.html against sw.js only proves the
 *    two agree with EACH OTHER, so a token that never moved looked perfectly
 *    healthy while the asset behind it changed - which is exactly what happened
 *    to i18n.js across three commits, and to queue-ui.js across two.
 *
 *    git history answers it: find the newest commit that touched the asset, and
 *    the newest commit that touched that exact token string. If the asset's
 *    commit is newer, the token is stale and returning visitors are running an
 *    old copy.
 *
 *    The pickaxe searches for the WHOLE "name?v=token" string, not the bare
 *    token. A bare digit matches any line containing that digit, which
 *    produced a convincing false positive on i18n.js's "?v=5" before it was
 *    narrowed.
 *
 * 4. The service worker's own VERSION must have moved since PRECACHE last
 *    moved. If PRECACHE changed but VERSION did not, the worker keeps the old
 *    cache and the new tokens are never fetched.
 *
 * Usage: node scripts/check-tokens.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const HTML = path.join(ROOT, "index.html");
const SW = path.join(ROOT, "sw.js");

const html = fs.readFileSync(HTML, "utf8");
const sw = fs.readFileSync(SW, "utf8");

const git = (args) => {
  try {
    return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 256e6 }).trim();
  } catch {
    return "";
  }
};

/** Every asset referenced with a ?v= token, and the token it carries. */
function assetsIn(text) {
  const out = new Map();
  const re = /["'./]([A-Za-z0-9._-]+\.(?:js|css))\?v=([^"'&)\s]+)/g;
  let m;
  while ((m = re.exec(text))) out.set(m[1], m[2]);
  return out;
}

const inHtml = assetsIn(html);
const inSw = assetsIn(sw);
let problems = 0;

// ---- 1. index.html and sw.js must agree ------------------------------------
console.log("\n  1. token agreement between index.html and sw.js");
console.log("  " + "-".repeat(70));
let agreeBad = 0;
for (const [name, token] of [...inHtml].sort()) {
  const swToken = inSw.get(name);
  const ok = swToken === token;
  if (!ok) agreeBad++;
  console.log(
    `  ${ok ? "OK  " : "FAIL"}  ${name.padEnd(30)} index=${String(token).padEnd(12)} sw=${swToken ?? "MISSING"}`,
  );
}
for (const name of [...inSw.keys()].sort()) {
  if (!inHtml.has(name)) {
    console.log(`  FAIL  ${name.padEnd(30)} precached by sw.js but not referenced by index.html`);
    agreeBad++;
  }
}
problems += agreeBad;

// ---- 2. assets must exist ---------------------------------------------------
console.log("\n  2. referenced assets exist on disk");
console.log("  " + "-".repeat(70));
let missing = 0;
for (const name of [...inHtml.keys()].sort()) {
  const ok = fs.existsSync(path.join(ROOT, name));
  if (!ok) {
    console.log(`  FAIL  ${name.padEnd(30)} referenced but not on disk`);
    missing++;
  }
}
if (!missing) console.log(`  OK    all ${inHtml.size} assets present`);
problems += missing;

// ---- 3. token must have moved since the content moved -----------------------
console.log("\n  3. token vs content (git history)");
console.log("  " + "-".repeat(70));
const order = git(["rev-list", "HEAD"]).split("\n").filter(Boolean);
const pos = new Map(order.map((h, i) => [h, i]));
const lastCommit = (args) => git(["log", "-1", "--format=%H", ...args]) || null;

let stale = 0;
for (const [name, token] of [...inHtml].sort()) {
  const fileCommit = lastCommit(["--", name]);
  // The WHOLE "name?v=token" string - a bare token is not unique enough.
  const tokenCommit = lastCommit(["-S" + `${name}?v=${token}`, "--", "index.html"]);

  if (!fileCommit) {
    console.log(`  --    ${name.padEnd(30)} file is not in git yet`);
    continue;
  }
  if (!tokenCommit) {
    console.log(`  --    ${name.padEnd(30)} token never appears in a commit`);
    continue;
  }
  const pf = pos.get(fileCommit);
  const pt = pos.get(tokenCommit);
  if (pf < pt) {
    // The file's commit is NEWER than the token's: the token is stale.
    const subject = git(["log", "-1", "--format=%s", fileCommit]);
    console.log(`  STALE ${name.padEnd(30)} content changed in ${fileCommit.slice(0, 8)} ("${subject}")`);
    console.log(`         after the token was set in ${tokenCommit.slice(0, 8)} - bump it`);
    stale++;
  }
}
if (!stale) console.log(`  OK    every token moved at or after its asset's last change`);
problems += stale;

// ---- 4. the service worker's VERSION must have moved with PRECACHE ----------
console.log("\n  4. sw.js VERSION vs PRECACHE");
console.log("  " + "-".repeat(70));
const ver = /VERSION\s*=\s*'([^']+)'/.exec(sw);
console.log(`  sw.js VERSION = ${ver ? ver[1] : "(not found)"}`);

// The working tree, not just the history. A PRECACHE edit that has not been
// committed is invisible to a git-log comparison - which is exactly how the
// last commit shipped a changed PRECACHE with an unchanged VERSION, so the
// service worker kept serving the old manifest.
const treeDiff = git(["diff", "HEAD", "--", "sw.js"]);
const treeTouchesPrecache = /^[+-].*'\.\/[^']+\?v=/m.test(treeDiff);
const treeTouchesVersion = /^[+-].*const VERSION =/m.test(treeDiff);
if (treeTouchesPrecache && !treeTouchesVersion) {
  console.log("  STALE sw.js has uncommitted PRECACHE changes but no VERSION change");
  console.log("         the service worker would keep serving the old precache");
  problems++;
} else if (treeTouchesPrecache) {
  console.log("  OK    uncommitted sw.js changes include the VERSION");
} else {
  console.log("  --    sw.js has no uncommitted PRECACHE change");
}
// Both pickaxes here use -G, not -S. -S reports a commit only when the NUMBER
// of occurrences of a literal string changes, and "const VERSION =" occurs once
// before a bump and once after it, so -S could never see a VERSION change at
// all and reported the version as stale no matter what. -G searches the diff
// for a matching line, which is what "this line changed" actually means.
const precacheCommit = lastCommit(["-G" + "'\\./[^']+\\?v=", "--", "sw.js"]);
const versionCommit = lastCommit(["-G" + "const VERSION =", "--", "sw.js"]);
if (precacheCommit && versionCommit) {
  const pp = pos.get(precacheCommit);
  const pv = pos.get(versionCommit);
  if (pp < pv) {
    console.log(`  STALE PRECACHE changed in ${precacheCommit.slice(0, 8)}, VERSION last set in ${versionCommit.slice(0, 8)}`);
    console.log("         bump the VERSION or the worker keeps serving the old cache");
    problems++;
  } else {
    console.log(`  OK    VERSION moved at or after the last PRECACHE change`);
  }
} else {
  console.log("  --    not enough history to compare");
}

console.log(
  problems
    ? `\n  ${problems} problem(s). A stale token means a returning visitor keeps the old file.\n`
    : "\n  all tokens agree, exist, and match their asset content\n",
);
process.exit(problems ? 1 : 0);
