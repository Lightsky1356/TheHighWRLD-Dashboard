// Single entry point for the dashboard's test suite.
//
// These exist because today several genuinely serious bugs were only caught by
// tests that ran the REAL code paths:
//   - a bare EC private key that Web Crypto cannot import at all
//   - an HKDF extract with its key and data reversed, producing well-formed but
//     undecryptable push payloads
//   - serviceWorker.ready never settling, leaving a UI permanently blank
//   - INSERT OR IGNORE on follows, duplicating notifications on every re-follow
// None of those throw visibly in a browser. A suite is what makes them cheap.
//
// Run:  npm test
//
// Groups:
//   offline  - parse-gate, crypto. No server, no network.
//   server   - push-api, notifications. Need a dev server on :8788.
//
// WHY THIS STARTS ITS OWN SERVER
// The runner used to skip any group it could not reach and still exit 0, reporting
// "2 passed, 0 failed, 2 skipped". The two skipped groups are the only ones that
// exercise real HTTP handlers, so a green run said nothing about the code most
// likely to break - and a genuinely failing notifications suite went unread for
// most of a session for exactly this reason.
//
// Now the runner applies migrations, seeds the test accounts, starts the server,
// runs everything, and tears the server down. A suite it cannot run is reported
// as a failure, because a test that did not run is not a passing test.

import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runWrangler, wranglerEntry } from "./_wrangler.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const PORT = 8788;
const BASE = `http://127.0.0.1:${PORT}`;

const GROUPS = [
  { name: "parse-gate", file: "./parse-gate.test.mjs", needsServer: false },
  { name: "crypto", file: "./crypto-selftest.mjs", needsServer: false },
  { name: "push-api", file: "./push-api.test.mjs", needsServer: true },
  { name: "notifications", file: "./notifications-optout.test.mjs", needsServer: true },
];

const SERVER_BOOT_TIMEOUT_MS = 120_000;

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

function startServer() {
  const entry = wranglerEntry();
  if (!entry) return null;
  // stdio is ignored: wrangler writes a banner and progress lines that would
  // interleave with the suite output, and nothing it prints is actionable here.
  return spawn(process.execPath, [entry, "pages", "dev", ".", "--port", String(PORT)], {
    cwd: ROOT,
    stdio: "ignore",
    windowsHide: true,
  });
}

/* wrangler spawns node as its own child, so killing the wrapper leaves a server
   holding :8788. On Windows that needs killing the whole tree. */
function killServerTree(child) {
  if (!child || child.killed) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
  }
  try { child.kill(); } catch (_) {}
}

async function bootServer() {
  const deadline = Date.now() + SERVER_BOOT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await serverUp()) return true;
    await new Promise((r) => setTimeout(r, 1500));
  }
  return false;
}

function seed() {
  const r = spawnSync(process.execPath, [join(HERE, "seed.mjs")], {
    stdio: "inherit",
    cwd: ROOT,
  });
  return r.status === 0;
}

console.log("TheHighWRLD Dashboard - test suite\n" + "=".repeat(46) + "\n");

/* Offline groups first: if sw.js will not parse there is no point booting a
   server to test the endpoints that serve it. */
const results = [];
let server = null;

async function runGroup(g) {
  const path = join(HERE, g.file.replace("./", ""));
  if (!existsSync(path)) {
    console.log(`FAIL  ${g.name}  (${g.file} does not exist - the suite names a test that is not there)`);
    results.push({ name: g.name, ok: false, skipped: false });
    return;
  }
  console.log(`\n${"-".repeat(46)}\n${g.name}\n${"-".repeat(46)}`);
  const ok = await run(g.file);
  results.push({ name: g.name, ok, skipped: false });
}

for (const g of GROUPS.filter((x) => !x.needsServer)) {
  await runGroup(g);
}

if (GROUPS.some((g) => g.needsServer)) {
  console.log(`\n${"-".repeat(46)}\npreparing the local database\n${"-".repeat(46)}`);
  if (seed()) {
    if (await serverUp()) {
      console.log("using the dev server already running on :" + PORT);
    } else {
      console.log(`starting the dev server on :${PORT}…`);
      server = startServer();
      if (!(await bootServer())) {
        killServerTree(server);
        server = null;
      }
    }
    console.log(server || (await serverUp()) ? "dev server is up" : "dev server did not start");
  } else {
    console.log("seeding failed - server groups cannot run");
  }
}

const up = await serverUp();
for (const g of GROUPS.filter((x) => x.needsServer)) {
  if (!up) {
    console.log(`FAIL  ${g.name}  (no dev server on :${PORT} - this suite could not run)`);
    results.push({ name: g.name, ok: false, skipped: false });
    continue;
  }
  await runGroup(g);
}

if (server) {
  killServerTree(server);
  console.log("\nstopped the dev server");
}

console.log("\n" + "=".repeat(46));
console.log("summary");
console.log("=".repeat(46));
for (const r of results) {
  console.log(`  ${r.skipped ? "SKIP" : r.ok ? "PASS" : "FAIL"}  ${r.name}`);
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
if (failed.length) {
  console.log("\nfailed: " + failed.map((f) => f.name).join(", "));
}
process.exitCode = failed.length ? 1 : 0;