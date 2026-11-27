/* Auto cover pattern: dots, lines, glow and wash toggles, one layer per hue. */
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

check("wave, liquid, glow and wash are read by the painter", ["coverWave", "coverLiquid", "coverGlow", "coverWash"].every((k) => script.includes(`_thwFlag("${k}"`)) && !script.includes("_thwFlag(\"coverDots\""));
check("waves and liquid paint a layer for every colour", /for \(var v = 0; v < n; v\+\+\)/.test(script) && /for \(var q = 0; q < n; q\+\+\)/.test(script) && /cols\[v\]/.test(script) && /cols\[q\]/.test(script));
check("the blobs toggle controls the existing circles", /html\[data-blobs="off"\] \.th-blob\{display:none!important\}/.test(read("design-system.css")) && /coverBlobsToggle/.test(html) && /data-blobs/.test(account));
check("each layer gets its own background size", /sizes\.push\("240px 90px"\)/.test(script) && /sizes\.push\("320px 160px"\)/.test(script) && /--th-bg-size/.test(script));
check("the fixed theme layer honours those sizes", /background:var\(--th-bg\);background-size:var\(--th-bg-size,auto\)/.test(css));
check("every pattern is animated, with a still switch", /animation:thwPatternDrift/.test(css) && /@keyframes thwPatternDrift\{from\{transform:translate3d/.test(css) && /@keyframes thwPatternBreathe/.test(css) && /html\[data-motion="still"\] body::before\{animation:none!important\}/.test(css));
check("appearance page exposes Blobs, Wave, Liquid, Glow and Wash", ["coverBlobsToggle", "coverWaveToggle", "coverLiquidToggle", "coverGlowToggle", "coverWashToggle"].every((id) => html.includes(`id="${id}"`)) && !html.includes("coverDotsToggle") && !html.includes("coverLinesToggle"));
check("toggles are saved and repaint Auto", /\["coverBlobsToggle", "coverBlobs", true\]/.test(account) && /settingsSet\(t\[1\], this\.checked\)/.test(account) && /window\.paintAutoTheme\(\)/.test(account));
check("every cover contributes at least two colours", /out\.length === 1\) out\.push\(_thwDarken/.test(script) && /out\.slice\(0, want\)/.test(script));
check("palettes stay within 2-4 colours", /out\.length > 4\) out = out\.slice\(0, 4\)/.test(script) && /Math\.min\(4, Number\(v\)/.test(script));
check("the picker offers 2, 3, 4 or all", /id="coverColorCount"/.test(html) && /<option value="2">2<\/option>/.test(html) && /<option value="3">3<\/option>/.test(html) && /<option value="4">4<\/option>/.test(html));
check("the colour count is saved and repaints Auto", /settingsSet\("coverColorCount"/.test(account) && /id="coverColorCount"/.test(html));

console.log(out.join("\n"));
if (out.some((l) => l.startsWith("FAIL"))) process.exit(1);
