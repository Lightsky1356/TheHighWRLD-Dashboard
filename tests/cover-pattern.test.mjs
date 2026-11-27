/* Auto palettes: six live previews, user-controlled drift, real cover colours. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const read = (f) => readFileSync(join(ROOT, f), "utf8");
const script = read("script.js");
const html = read("index.html");
const account = read("account.js");
const picker = read("palette-picker.js");
const design = read("design-system.css");
const css = read("player-settings.css");
const out = [];
const check = (name, pass) => out.push(`${pass ? "PASS" : "FAIL"}  ${name}`);

check("all six palettes have live previews", ["default", "blobs", "glow", "wash", "wave", "liquid"].every((p) => picker.includes(`["${p}",`)) && html.includes('id="palettePick"'));
check("previews use the playing cover's colours", /getCoverGradientValue\(t\)/.test(picker) && /function preview\(id, c\)/.test(picker) && /thw:trackplaying/.test(picker));
check("palette controls the background layers", /palette !== "blobs" && palette !== "wash"/.test(script) && /palette !== "blobs" && palette !== "glow"/.test(script));
check("wave and liquid remap the cover colours", /palette === "liquid"/.test(script) && /_thwMix\(cols\[m\], cols\[\(m \+ 1\) % n\], \.5\)/.test(script) && /palette === "wave"/.test(script));
check("tapping a preview saves and repaints", /wrldPlayerSettings\.set\("coverPalette", id\)/.test(picker) && /function repaint/.test(picker));
check("drift speed is user controlled", ['value="off"', 'value="slow"', 'value="normal"', 'value="fast"'].every((v) => html.includes(v)) && /settingsSet\("coverDrift", this\.value\)/.test(account) && /get\("coverDrift"\)/.test(script));
check("every palette animation uses the drift speed", /animation:thwPatternDrift var\(--thw-drift-speed/.test(css) && /thwWaveFlow calc\(var\(--thw-drift-speed/.test(css) && /thwLiquidFlow calc\(var\(--thw-drift-speed/.test(css) && /html\[data-cover-drift="off"\] body::before\{animation:none!important\}/.test(css));
check("nothing playing falls back to the site theme", /else \{ _thwClearAmbient\(\); \}/.test(script) && /if \(!cover\) \{[\s\S]{0,120}thwClearAmbient/.test(read("cover-pref.js")));
check("a playing track survives palette changes", /var list = \(typeof trackList !== "undefined" && trackList\)/.test(script));
check("no background toggles remain", !html.includes("coverBlobsToggle") && !html.includes("coverGlowToggle") && !html.includes("coverWashToggle"));
check("palette previews are styled", /\.palette-pick\{/.test(design) && /\.palette-preview\{/.test(design) && /\.palette-btn\.active\{/.test(design));
check("every cover contributes at least two colours", /out\.length === 1\) out\.push\(_thwDarken/.test(script) && /out\.slice\(0, want\)/.test(script));
check("palettes stay within 2-4 colours", /out\.length > 4\) out = out\.slice\(0, 4\)/.test(script) && /Math\.min\(4, Number\(v\)/.test(script));

console.log(out.join("\n"));
if (out.some((l) => l.startsWith("FAIL"))) process.exit(1);
