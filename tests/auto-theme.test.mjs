/* Auto theme washes the page with every colour in the cover gradient. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const read = (f) => readFileSync(join(ROOT, f), "utf8");
const cover = read("cover-pref.js");
const script = read("script.js");
const html = read("index.html");
const sw = read("sw.js");
const checks = [
  ["Auto derives every colour stop from the real cover map", /coverGradientRaw\(url\)/.test(script) && /_thwGradientColors\(url\)/.test(script) && /out\.indexOf\(c\) === -1/.test(script)],
  ["every hue gets its own background layer", /for \(var g = 0; g < n; g\+\+\)/.test(script) && /themeCols\[g\]/.test(script) && /x \+ "% " \+ y \+ "%/.test(script)],
  ["UI accents follow all the palette colours", /themeCols\.join\(","\)/.test(script) && /--ds-accent/.test(script) && /--ac-grad-brand/.test(script) && /--th-glow/.test(script)],
  ["leaving Auto removes every override", /var props = \[/.test(script) && /"--th-bg-size"/.test(script) && /"--ds-accent"/.test(script) && /removeProperty\(props\[i\]\)/.test(script)],
  ["the active painter follows the displayed cover", /window\.thwPaintAmbient\(cover\)/.test(cover) && /thwPaintAmbient&&window\.thwPaintAmbient/.test(script)],
  ["theme changes and track changes repaint it", /attributeFilter: \['data-theme'\]/.test(cover) && /thw:trackplaying/.test(cover)],
  ["the listening panel is fully removed", !/playerInsights|player-insights/.test(html + cover + sw)],
];
let ok = true;
for (const [name, pass] of checks) {
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}`);
  if (!pass) ok = false;
}
if (!ok) process.exit(1);
