/* Every cover gradient contributes exactly four colours from its own palette. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const src = readFileSync(join(ROOT, "script.js"), "utf8");
const start = src.indexOf("var coverGradientMap=");
const end = src.indexOf("};", start);
const block = start >= 0 ? src.slice(start, end + 2) : "";
const entries = [...block.matchAll(/"([^"]+)":"(linear-gradient\([^"]*\))"/g)];
const counts = entries.map(([, , value]) =>
  (value.match(/hsla?\([^)]+\)|rgba?\([^)]+\)|#[0-9a-fA-F]{3,8}/g) || []).length
);
const bad = counts.filter((n) => n !== 4).length;
const out = [];
const check = (name, pass) => out.push(`${pass ? "PASS" : "FAIL"}  ${name}`);
check("cover gradient map exists", entries.length > 0);
check(`all ${entries.length} cover gradients have four colours`, bad === 0);
console.log(out.join("\n"));
if (bad) console.log(`  ${bad} entries are not four-colour gradients`);
if (out.some((l) => l.startsWith("FAIL"))) process.exit(1);
