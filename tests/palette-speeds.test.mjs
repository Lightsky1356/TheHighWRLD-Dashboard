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
check("names match their motion", ["thwBlobsFloat", "thwGlowPulse", "thwWashSweep", "thwRippleFlow", "thwPrismFlow", "thwSunriseFlow"].every((k) => css.includes("@keyframes " + k + "{")) && css.includes("skewX(-3deg)") && css.includes("scale(1.28)") && css.includes("translate3d(0,9%,0)"));
check("Liquid mixes the playing cover's colours", /thwLiquidFlow\{[^}]*filter:hue-rotate\(0deg\)\}to\{[^}]*filter:hue-rotate\(26deg\)/.test(css));

check("drift speed has four distinct values", ["0s", "30s", "8s", "2s"].every((v) => script.includes(`"${v}"`)) && /drift === "slow" \? "30s" : drift === "fast" \? "2s" : "8s"/.test(script));
check("palette speed has four distinct values", /pspeed === "off" \? "0s" : pspeed === "slow" \? "24s" : pspeed === "fast" \? "2s" : "7s"/.test(script));
check("motion is constant-speed so it is visible immediately", /thwPatternDrift var\(--thw-drift-speed,8s\) linear/.test(css) && /thwWaveFlow var\(--thw-palette-speed,7s\) linear/.test(css));
check("motion is visibly large", css.includes("translate3d(-7%,-5%,0) scale(1.22)") && css.includes("translate3d(-9%,8%,0)") && css.includes("rotate(-4deg)") && css.includes("scale(1.34)"));
check("both speed selectors expose all four options", ["coverDrift", "coverPaletteSpeed"].every((id) => {
  const at = html.indexOf(`id="${id}"`);
  const block = html.slice(at, html.indexOf("</select>", at));
  return ["off", "slow", "normal", "fast"].every((v) => block.includes(`value="${v}"`));
}));

check("Off stops only its own palettes", !/data-cover-drift="off"\] body::before,html\[data-cover-palette-speed="off"\]/.test(css) &&
  driftPalettes.every((p) => css.includes(`[data-cover-drift="off"][data-cover-palette="${p}"] body::before`)) &&
  palettePalettes.every((p) => css.includes(`[data-cover-palette-speed="off"][data-cover-palette="${p}"] body::before`)));

check("one off switch cannot kill the other group", !/html\[data-cover-drift="off"\] body::before\{/.test(css) && !/html\[data-cover-palette-speed="off"\] body::before\{/.test(css));
check("reduced motion still overrides", /html\[data-motion="still"\] body::before\{animation:none!important\}/.test(css));

console.log(out.join("\n"));
if (out.some((l) => l.startsWith("FAIL"))) process.exit(1);
