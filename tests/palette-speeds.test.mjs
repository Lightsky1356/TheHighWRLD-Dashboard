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

check("all nine palettes animate", driftPalettes.every((p) =>
  /animation:thwPatternDrift var\(--thw-drift-speed/.test(css)) && palettePalettes.every((p) =>
  css.includes(`[data-cover-palette="${p}"] body::before{animation:thw`)) &&
  ["thwWaveFlow", "thwLiquidFlow", "thwRippleFlow", "thwPrismFlow", "thwSunriseFlow"].every((k) =>
    new RegExp(`@keyframes ${k}\\{from\\{transform:[^}]+\\}to\\{transform:`).test(css)));

check("drift speed has four distinct values", ["0s", "60s", "24s", "6s"].every((v) => script.includes(`"${v}"`)) && /drift === "slow" \? "60s" : drift === "fast" \? "6s" : "24s"/.test(script));
check("palette speed has four distinct values", /pspeed === "off" \? "0s" : pspeed === "slow" \? "48s" : pspeed === "fast" \? "5s" : "18s"/.test(script));
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
