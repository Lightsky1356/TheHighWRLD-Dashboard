// Resolve and run the wrangler CLI without going through a shell.
//
// The obvious way is spawn("wrangler.cmd", args, { shell: true }) on Windows,
// which works and is quietly wrong twice over: Node concatenates the arguments
// rather than escaping them (DEP0190), and cmd.exe then re-splits any statement
// containing spaces. That is what made an earlier version of seed.mjs fail with
// "Unknown arguments: FROM, community_notifications, WHERE, ..." - wrangler was
// being handed a SQL statement cut into words.
//
// Running wrangler's JS entry point with the current node binary removes the shell
// from the path entirely: no quoting rules, no re-splitting, no warning.

import { spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

let cached = null;

/**
 * Absolute path to wrangler's bin script, or null if it cannot be found.
 * Resolution order: explicit override, a local install, then the global one.
 */
export function wranglerEntry() {
  if (cached !== null) return cached || null;

  if (process.env.WRANGLER_JS) {
    cached = existsSync(process.env.WRANGLER_JS) ? process.env.WRANGLER_JS : "";
    return cached || null;
  }

  // A local install wins, so a project pinned to a specific version uses it.
  const local = join(ROOT, "node_modules", "wrangler", "bin", "wrangler.js");
  if (existsSync(local)) {
    cached = local;
    return cached;
  }

  if (process.platform === "win32") {
    const global = join(
      process.env.APPDATA || "",
      "npm", "node_modules", "wrangler", "bin", "wrangler.js"
    );
    cached = existsSync(global) ? global : "";
    return cached || null;
  }

  // POSIX: the npm global bin is a symlink, and its realpath is the JS entry.
  try {
    const which = execFileSync("which", ["wrangler"], { encoding: "utf8" }).trim().split("\n")[0];
    if (which) {
      const real = realpathSync(which);
      cached = existsSync(real) ? real : "";
      return cached || null;
    }
  } catch (_) {
    // wrangler not on PATH; fall through.
  }
  cached = "";
  return null;
}

/** Run wrangler to completion. Returns the raw spawnSync result. */
export function runWrangler(args, options = {}) {
  const entry = wranglerEntry();
  if (!entry) {
    return {
      status: 1,
      stdout: "",
      stderr:
        "could not find wrangler. Install it with `npm i -g wrangler`, or set " +
        "WRANGLER_JS to the absolute path of wrangler's bin/wrangler.js.",
    };
  }
  return spawnSync(process.execPath, [entry, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    ...options,
  });
}