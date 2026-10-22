// What the site costs, measured from the server's own log.
//
// This is the honest count. The browser cannot see the requests for the
// assets, because they are served from disk by the development proxy rather
// than over the network - but in production they are served from Cloudflare's
// edge, and the ones that invoke a Function are what the limit counts.
//
// So this reads the functions server's log, which records every request that
// invoked a function, and reports what the site asked for.
//
// Usage:  node scripts/measure-log.mjs [logFile]

import fs from "node:fs";

const LOG = process.argv[2] || "";

function readLog() {
  try { return fs.readFileSync(LOG, "utf8").split(/\r?\n/); } catch (_) { return []; }
}

function count(lines) {
  const api = new Map();
  let total = 0;
  for (const l of lines) {
    const m = /(?:^|\] )(GET|POST|PUT|DELETE) (\/\S*)/.exec(l);
    if (!m) continue;
    total++;
    const key = m[1] + " " + m[2].split("?")[0];
    api.set(key, (api.get(key) || 0) + 1);
  }
  return { total, api };
}

const before = count(readLog());
console.log("  === the requests that invoked a function ===");
console.log("  " + before.total + " in total");
console.log("");
for (const [k, n] of [...before.api.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14)) {
  console.log("    " + String(n).padStart(7) + "  " + k);
}
