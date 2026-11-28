/* Every palette animates; both speed controls cover Off/Slow/Normal/Fast. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const read = (f) => readFileSync(join(ROOT, f), "utf8");
const script = read("script.js");
const css = read("player-settings.css");
const html = read("index.html");
const out = [];
const check = (name, pass) => out.push(`${pass ? "PASS" : "FAIL"}  ${name}`);

const driftPalettes = ["default", "blobs", "glow", "wash"];
const palettePalettes = ["wave", "liquid", "ripple", "prism", "sunrise"];

check("all nine palettes have their own motion", ["default", "blobs", "glow", "wash", "wave", "liquid", "ripple", "prism", "sunrise"].every((p) =>
  css.includes(`[data-cover-palette="${p}"] body::before{animation:thw`) ||
  (p === "default" && /body::before\{[^}]*animation:thwPatternDrift/.test(css))) &&
  ["thwPatternDrift", "thwBlobsFloat", "thwGlowPulse", "thwWashSweep", "thwWaveFlow", "thwLiquidFlow", "thwRippleFlow", "thwPrismFlow", "thwSunriseFlow"].every((k) =>
    new RegExp(`@keyframes ${k}\\{`).test(css)));
check("names match their motion", ["thwBlobsFloat", "thwGlowPulse", "thwWashSweep", "thwRippleFlow", "thwPrismFlow", "thwSunriseFlow"].every((k) => css.includes("@keyframes " + k + "{")) && css.includes("skewX(-5deg)") && css.includes("scale(1.3)") && css.includes("translate3d(0,12%,0)"));
check("Liquid mixes the playing cover's colours", css.includes("@keyframes thwLiquidFlow") && css.includes("hue-rotate(0deg)") && css.includes("hue-rotate(54deg)") && css.includes("saturate(1.25)"));

check("drift speed has four distinct values", ["0s", "20s", "5s", "1s"].every((v) => script.includes(`"${v}"`)) && /drift === "slow" \? "20s" : drift === "fast" \? "1s" : "5s"/.test(script));
check("palette speed has four distinct values", /pspeed === "off" \? "0s" : pspeed === "slow" \? "16s" : pspeed === "fast" \? "1s" : "4s"/.test(script));
check("motion is constant-speed so it is visible immediately", /thwPatternDrift var\(--thw-palette-speed,4s\) linear/.test(css) && /thwWaveFlow var\(--thw-palette-speed,4s\) linear/.test(css));
check("motion is visibly large and never exposes edges", css.includes("translate3d(-9%,-6%,0) rotate(-1deg) scale(1.45)") && css.includes("scale(1.45)") && css.includes("hue-rotate(54deg)") && css.includes("scale(1.7)") && css.includes("translate3d(0,12%,0)"));
check("both speed selectors expose all four options", ["coverDrift", "coverPaletteSpeed"].every((id) => {
  const at = html.indexOf(`id="${id}"`);
  const block = html.slice(at, html.indexOf("</select>", at));
  return ["off", "slow", "normal", "fast"].every((v) => block.includes(`value="${v}"`));
}));

check("Palette Off stops every palette", /html\[data-cover-palette-speed="off"\] body::before\{animation:none!important\}/.test(css) && !/data-cover-drift="off"/.test(css));
check("all palettes follow the palette speed", /body::before\{[^}]*animation:thwPatternDrift var\(--thw-palette-speed/.test(css) && ["blobs", "glow", "wash"].every((p) => css.includes(`[data-cover-palette="${p}"] body::before{animation:thw`)) && !css.includes("var(--thw-drift-speed"));

check("wrap layer re-enters with no square seams", /#thw-wrap-layer\{[^}]*background-repeat:repeat[^}]*background-size:50vw 100%/.test(css) && /@keyframes thwWrapSlide\{from\{background-position:0 0\}to\{background-position:50vw 0\}/.test(css) && /First and last stops match/.test(readFileSync(join(ROOT, "palette-picker.js"), "utf8")));
check("reduced motion still overrides", /html\[data-motion="still"\] body::before\{animation:none!important\}/.test(css));

console.log(out.join("\n"));
if (out.some((l) => l.startsWith("FAIL"))) process.exit(1);
