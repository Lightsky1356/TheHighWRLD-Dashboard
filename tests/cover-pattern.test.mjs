/* Auto cover palettes: Default, Blobs, Glow, Wash, Wave and Liquid. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const read = (f) => readFileSync(join(ROOT, f), "utf8");
const script = read("script.js");
const html = read("index.html");
const account = read("account.js");
const css = read("player-settings.css");
const out = [];
const check = (name, pass) => out.push(`${pass ? "PASS" : "FAIL"}  ${name}`);

check("all six palettes are offered", ['value="default"', 'value="blobs"', 'value="glow"', 'value="wash"', 'value="wave"', 'value="liquid"'].every((v) => html.includes(v)));
check("palette controls the background layers", /palette !== "blobs" && palette !== "wash"/.test(script) && /palette !== "blobs" && palette !== "glow"/.test(script));
check("wave and liquid remap the cover colours", /palette === "liquid"/.test(script) && /_thwMix\(cols\[m\], cols\[\(m \+ 1\) % n\], \.5\)/.test(script) && /palette === "wave"/.test(script));
check("palette changes repaint Auto", /settingsSet\("coverPalette", this\.value\)/.test(account) && /function repaintAuto/.test(account));
check("nothing playing falls back to the site theme", /else \{ _thwClearAmbient\(\); \}/.test(script) && /if \(!cover\) \{[\s\S]{0,120}thwClearAmbient/.test(read("cover-pref.js")));
check("no background toggles remain", !html.includes("coverBlobsToggle") && !html.includes("coverGlowToggle") && !html.includes("coverWashToggle"));
check("the fixed theme layer honours its sizes", /background:var\(--th-bg\);background-size:var\(--th-bg-size,auto\)/.test(css));
check("the theme layer drifts cheaply and has a still switch", /animation:thwPatternDrift 24s/.test(css) && !/thwPatternBreathe/.test(css) && /html\[data-motion="still"\] body::before\{animation:none!important\}/.test(css));
check("every cover contributes at least two colours", /out\.length === 1\) out\.push\(_thwDarken/.test(script) && /out\.slice\(0, want\)/.test(script));
check("palettes stay within 2-4 colours", /out\.length > 4\) out = out\.slice\(0, 4\)/.test(script) && /Math\.min\(4, Number\(v\)/.test(script));
check("the picker offers 2, 3, 4 or all", /id="coverColorCount"/.test(html) && ['<option value="2">2</option>', '<option value="3">3</option>', '<option value="4">4</option>'].every((o) => html.includes(o)));

console.log(out.join("\n"));
if (out.some((l) => l.startsWith("FAIL"))) process.exit(1);
