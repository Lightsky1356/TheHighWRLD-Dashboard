// ASSET TOKEN GATE
//
// The service worker precaches by URL. A file edited without its token moving
// is a file nobody ever fetches again - the worker keeps handing back the copy
// it already holds, and the change exists on disk where every local check reads
// it and nowhere a person can see it.
//
// This has now cost three separate rounds of "it works locally and the page is
// still broken":
//   - the message menu and its stylesheet were written, and the page went on
//     serving the previous copy, so the menu opened two thousand pixels below
//     the panel where nobody could see it
//   - social.css was edited and only social-panel.js's reference to it moved,
//     leaving social-panel.js itself stale, which left the css stale too
//   - the gradient changes shipped into a token the worker already held
//
// Every one of those passed the parse gate, the feature check and the browser
// check, because all three read the files off disk. Nothing read them the way
// the browser does: through the worker, by URL.
//
// So the check is mechanical. Two things must hold:
//   1. every referrer agrees about an asset's token (index.html and sw.js name
//      the same copy of script.js, or the page asks for one file and the
//      worker precaches another)
//   2. any asset changed since HEAD has a token HEAD did not use
//
// Offline, no server, no network.

import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

let failures = 0;
const fail = (m) => { console.log("  FAIL  " + m); failures++; };
const ok = (m) => console.log("  PASS  " + m);

/* The files that name assets, and the assets they name. A token is
   `<asset>?v=thw-v<n>`; the same asset may be named in several of them. */
const REFERERS = ["index.html", "sw.js", "social-panel.js"];

function refsIn(file) {
  const path = join(ROOT, file);
  if (!existsSync(path)) return [];
  const text = readFileSync(path, "utf8");
  const out = [];
  const re = /([A-Za-z0-9_./-]+\.(?:js|mjs|css|html|json|png|jpg|svg|woff2))\?v=(thw-v\d+)/g;
  let m;
  while ((m = re.exec(text))) out.push({ asset: m[1].replace(/^\.\//, ""), token: m[2] });
  return out;
}

const byAsset = new Map(); // asset -> [{ referer, token }]
for (const referer of REFERERS) {
  for (const { asset, token } of refsIn(referer)) {
    if (!byAsset.has(asset)) byAsset.set(asset, []);
    byAsset.get(asset).push({ referer, token });
  }
}

if (!byAsset.size) {
  fail("no asset tokens found at all - the scan pattern no longer matches the files");
} else {
  /* 1. Every referrer agrees. */
  let disagreements = 0;
  for (const [asset, uses] of byAsset) {
    const tokens = [...new Set(uses.map((u) => u.token))];
    if (tokens.length > 1) {
      disagreements++;
      fail(
        asset + " has " + tokens.length + " different tokens - " +
        uses.map((u) => u.referer + " says " + u.token).join(", ") +
        " (the page asks for one copy and the worker precaches another)"
      );
    }
  }
  if (!disagreements) ok("every referrer agrees about every asset's token (" + byAsset.size + " assets)");

  /* 2. A changed file has a moved token. */
  let gitUsable = true;
  let head = null;
  try {
    execFileSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd: ROOT, stdio: "pipe" });
    head = execFileSync("git", ["show", "HEAD:index.html"], { cwd: ROOT, stdio: "pipe" }).toString("utf8");
  } catch (e) {
    gitUsable = false;
  }

  if (!gitUsable) {
    ok("git is not usable here - token drift cannot be compared against HEAD");
  } else {
    const changed = execFileSync("git", ["diff", "--name-only", "HEAD", "--"], { cwd: ROOT, stdio: "pipe" })
      .toString("utf8")
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);

    const changedSet = new Set(changed);
    let stale = 0;

    for (const [asset, uses] of byAsset) {
      if (!changedSet.has(asset)) continue;
      const referer = uses[0].referer;
      let headText;
      try {
        headText = execFileSync("git", ["show", "HEAD:" + referer], { cwd: ROOT, stdio: "pipe" }).toString("utf8");
      } catch (e) {
        continue; // a brand new referrer, nothing to compare against
      }
      const re = new RegExp(asset.replace(/[.]/g, "\\.") + "\\?v=(thw-v\\d+)");
      const before = re.exec(headText);
      const now = uses[0].token;
      if (before && before[1] === now) {
        stale++;
        fail(
          asset + " was edited but its token never moved - still " + now +
          ", the same copy the service worker already precached. Bump it in " +
          referer + " (and sw.js VERSION), or the page never sees the change."
        );
      }
    }

    if (!stale) {
      const howMany = changed.filter((c) => byAsset.has(c)).length;
      ok("every changed asset has a token the worker has not seen (" + howMany + " of " + changed.length + " changed files are assets)");
    }
  }
}

console.log(failures ? "\n  " + failures + " token problem(s)\n" : "\n  asset tokens: all good\n");
process.exit(failures ? 1 : 0);
