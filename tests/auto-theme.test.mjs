/* Auto theme washes the page with the real cover gradient and recolours chrome. */
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
  ["Auto derives both hues from the real cover map", /coverGradientRaw\(url\)/.test(script) && /_thwGradientPair\(url\)/.test(script)],
  ["background is a cover wash plus stronger corner pools", /linear-gradient\(135deg," \+ _thwHslRgba\(c1, \.24\)/.test(script) && /_thwHslRgba\(c1, \.45\)/.test(script) && /_thwHslRgba\(c2, \.40\)/.test(script)],
  ["UI accents follow the cover", /--ds-accent/.test(script) && /--ac-grad-brand/.test(script) && /--th-glow/.test(script)],
  ["leaving Auto removes every override", /var props = \[/.test(script) && /"--ds-accent"/.test(script) && /"--th-glow"/.test(script) && /"--th-bg"/.test(script) && /removeProperty\(props\[i\]\)/.test(script)],
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
