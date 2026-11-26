/* Auto theme paints the current cover's gradient across the page background. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const cover = readFileSync(join(ROOT, "cover-pref.js"), "utf8");
const html = readFileSync(join(ROOT, "index.html"), "utf8");
const sw = readFileSync(join(ROOT, "sw.js"), "utf8");
const checks = [
  ["Auto theme derives the page background from the cover", /data-theme"\) !== "auto"/.test(cover) && /--th-bg/.test(cover) && /coverGradientRaw\(cover\)/.test(cover)],
  ["theme changes and track changes repaint it", /attributeFilter: \['data-theme'\]/.test(cover) && /thw:trackplaying/.test(cover)],
  ["the listening panel is fully removed", !/playerInsights|player-insights/.test(html + cover + sw)],
];
let ok = true;
for (const [name, pass] of checks) {
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}`);
  if (!pass) ok = false;
}
if (!ok) process.exit(1);
