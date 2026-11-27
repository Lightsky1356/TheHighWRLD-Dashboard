/* Auto cover palettes and the remaining background toggles (Blobs/Glow/Wash). */
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

check("only background toggles remain", ["coverGlow", "coverWash"].every((k) => script.includes(`_thwFlag("${k}"`)) && !script.includes("_thwFlag(\"coverWave\"") && !script.includes("_thwFlag(\"coverLiquid\""));
check("wave and liquid are palette mappings", /get\("coverPalette"\)/.test(script) && /palette === "liquid"/.test(script) && /_thwMix\(cols\[m\], cols\[\(m \+ 1\) % n\], \.5\)/.test(script) && /palette === "wave"/.test(script));
check("the picker exposes Default, Wave and Liquid", /id="coverPalette"/.test(html) && ['value="default"', 'value="wave"', 'value="liquid"'].every((v) => html.includes(v)));
check("palette changes repaint Auto", /settingsSet\("coverPalette", this\.value\)/.test(account) && /function repaintAuto/.test(account));
check("the blobs toggle controls the existing circles", /html\[data-blobs="off"\] \.th-blob\{display:none!important\}/.test(read("design-system.css")) && /coverBlobsToggle/.test(html) && /data-blobs/.test(account));
check("the fixed theme layer honours its sizes", /background:var\(--th-bg\);background-size:var\(--th-bg-size,auto\)/.test(css));
check("the theme layer drifts cheaply and has a still switch", /animation:thwPatternDrift 24s/.test(css) && !/thwPatternBreathe/.test(css) && /html\[data-motion="still"\] body::before\{animation:none!important\}/.test(css));
check("no pattern toggles for wave, liquid, dots or lines", !html.includes("coverWaveToggle") && !html.includes("coverLiquidToggle") && !html.includes("coverDotsToggle") && !html.includes("coverLinesToggle"));
check("every cover contributes at least two colours", /out\.length === 1\) out\.push\(_thwDarken/.test(script) && /out\.slice\(0, want\)/.test(script));
check("palettes stay within 2-4 colours", /out\.length > 4\) out = out\.slice\(0, 4\)/.test(script) && /Math\.min\(4, Number\(v\)/.test(script));
check("the picker offers 2, 3, 4 or all", /id="coverColorCount"/.test(html) && ['<option value="2">2</option>', '<option value="3">3</option>', '<option value="4">4</option>'].every((o) => html.includes(o)));

console.log(out.join("\n"));
if (out.some((l) => l.startsWith("FAIL"))) process.exit(1);
