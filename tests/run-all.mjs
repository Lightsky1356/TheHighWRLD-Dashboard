// Single entry point for the dashboard's test suite.
//
// These exist because today three genuinely serious bugs were only caught by
// tests that ran the REAL code paths:
//   - a bare EC private key that Web Crypto cannot import at all
//   - an HKDF extract with its key and data reversed, producing well-formed but
//     undecryptable push payloads
//   - serviceWorker.ready never settling, leaving a UI permanently blank
// None of those throw visibly in a browser. A suite is what makes them cheap.
//
// Run:  npm test
//
// Groups:
//   crypto  - offline, no server, no network. Safe to run anywhere.
//   server  - needs `wrangler pages dev . --port 8788` running.
//             Skipped with a clear message rather than a false failure.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = "http://127.0.0.1:8788";

const GROUPS = [
  { name: "parse-gate", file: "./parse-gate.test.mjs", needsServer: false },
  { name: "crypto", file: "./crypto-selftest.mjs", needsServer: false },
  { name: "push-api", file: "./push-api.test.mjs", needsServer: true },
  { name: "notifications", file: "./notifications-optout.test.mjs", needsServer: true },
];

function run(file) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [join(HERE, file)], { stdio: "inherit" });
    p.on("close", (code) => resolve(code === 0));
    p.on("error", () => resolve(false));
  });
}

async function serverUp() {
  try {
    const res = await fetch(BASE + "/", { signal: AbortSignal.timeout(4000) });
    return res.ok;
  } catch (_) {
    return false;
  }
}

console.log("TheHighWRLD Dashboard - test suite\n" + "=".repeat(46) + "\n");

const up = await serverUp();
const results = [];

for (const g of GROUPS) {
  const path = join(HERE, g.file.replace("./", ""));
  if (!existsSync(path)) {
    console.log(`SKIP  ${g.name}  (${g.file} not found)`);
    results.push({ name: g.name, ok: true, skipped: true });
    continue;
  }
  if (g.needsServer && !up) {
    console.log(`SKIP  ${g.name}  (needs the dev server on :8788)`);
    console.log(`      start it with:  wrangler pages dev . --port 8788`);
    results.push({ name: g.name, ok: true, skipped: true });
    continue;
  }

  console.log(`\n${"-".repeat(46)}\n${g.name}\n${"-".repeat(46)}`);
  const ok = await run(g.file);
  results.push({ name: g.name, ok, skipped: false });
}

console.log("\n" + "=".repeat(46));
console.log("summary");
console.log("=".repeat(46));
for (const r of results) {
  console.log(`  ${r.skipped ? "SKIP" : r.ok ? "PASS" : "FAIL"}  ${r.name}`);
}

const failed = results.filter((r) => !r.ok && !r.skipped);
const skipped = results.filter((r) => r.skipped).length;

console.log(
  `\n${results.length - failed.length - skipped} passed, ${failed.length} failed, ${skipped} skipped`
);
if (failed.length) {
  console.log("\nfailed: " + failed.map((f) => f.name).join(", "));
}
process.exitCode = failed.length ? 1 : 0;