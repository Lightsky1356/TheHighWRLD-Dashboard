/* Auto palettes: live previews, two speeds, and only the playing cover's hues. */
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

const paletteIds = ["default", "blobs", "glow", "wash", "wave", "liquid", "ripple", "prism", "sunrise"];
check("nine palettes have live previews", paletteIds.every((p) => picker.includes(`["${p}",`)) && html.includes('id="palettePick"'));
check("previews use the playing cover's colours", /getCoverGradientValue\(t\)/.test(picker) && /function preview\(id, c\)/.test(picker) && /thw:trackplaying/.test(picker));
check("liquid keeps the real cover gradient", /var themeCols = cols;/.test(script) && !/_thwMix\(cols\[m\]/.test(script));
check("new palettes paint from cover colours", /palette === "ripple"/.test(script) && /palette === "prism"/.test(script) && /palette === "sunrise"/.test(script));
check("two clearly different speed ranges", /"40s" : drift === "fast" \? "3s"/.test(script) && /"32s" : pspeed === "fast" \? "3s"/.test(script));
check("drift and palette speeds are user controlled", ['id="coverDrift"', 'id="coverPaletteSpeed"'].every((id) => html.includes(id)) && /settingsSet\("coverDrift", this\.value\)/.test(account) && /settingsSet\("coverPaletteSpeed", this\.value\)/.test(account));
check("every palette animation follows a speed", /thwPatternDrift var\(--thw-drift-speed/.test(css) && ["wave", "liquid", "ripple", "prism", "sunrise"].every((p) => css.includes(`data-cover-palette="${p}"] body::before`)) && /--thw-palette-speed/.test(css));
check("tapping a preview saves and repaints", /wrldPlayerSettings\.set\("coverPalette", id\)/.test(picker) && /function repaint/.test(picker));
check("blobs, drift and speeds are visible on the palettes", /id="paletteStage"/.test(html) && /stage-blob/.test(html) && /id="driftBadge"/.test(html) && /id="paletteSpeedBadge"/.test(html) && /palette-meta/.test(picker) && /syncVisibleControls/.test(picker) && /\.palette-stage\{/.test(design) && /\.speed-badge\{/.test(design));
check("number picker has a live preview", /id="colorCountPreview"/.test(html) && /function paintCount/.test(picker) && /\.count-preview span\{/.test(design));
check("palettes appear in both full sheets", /mplayer-ov/.test(picker) && /dplayer-ov/.test(picker) && /className = "sheet-palettes"/.test(picker) && /\.sheet-palettes\{/.test(design) && /\.sheet-palette\.active\{/.test(design));
check("footer has a Settings link", /<a href="\/settings" class="foot-link">Settings<\/a>/.test(html));
check("nothing playing falls back to the site theme", /else \{ _thwClearAmbient\(\); \}/.test(script) && /if \(!cover\) \{[\s\S]{0,120}thwClearAmbient/.test(read("cover-pref.js")));
check("a playing track survives palette changes", /var list = \(typeof trackList !== "undefined" && trackList\)/.test(script));
check("palette previews are styled", /\.palette-pick\{/.test(design) && /\.palette-preview\{/.test(design) && /\.palette-btn\.active\{/.test(design));
check("every cover contributes at least two colours", /out\.length === 1\) out\.push\(_thwDarken/.test(script) && /out\.slice\(0, want\)/.test(script));
check("palettes stay within 2-4 colours", /out\.length > 4\) out = out\.slice\(0, 4\)/.test(script) && /Math\.min\(4, Number\(v\)/.test(script));

console.log(out.join("\n"));
if (out.some((l) => l.startsWith("FAIL"))) process.exit(1);
