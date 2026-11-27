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

check("all four pattern settings are read", ["coverDots", "coverLines", "coverGlow", "coverWash"].every((k) => script.includes(`_thwFlag("${k}"`)));
check("dots and lines paint a layer for every colour", /for \(var d = 0; d < n; d\+\+\)/.test(script) && /for \(var l = 0; l < n; l\+\+\)/.test(script) && /cols\[d\]/.test(script) && /cols\[l\]/.test(script));
check("each layer gets its own background size", /sizes\.push\(step \+ "px " \+ step \+ "px"\)/.test(script) && /--th-bg-size/.test(script));
check("the fixed theme layer honours those sizes", /background:var\(--th-bg\);background-size:var\(--th-bg-size,auto\)/.test(css));
check("appearance page exposes Dots, Lines, Glow and Wash", ["coverDotsToggle", "coverLinesToggle", "coverGlowToggle", "coverWashToggle"].every((id) => html.includes(`id="${id}"`)));
check("toggles are saved and repaint Auto", /\["coverDotsToggle", "coverDots", false\]/.test(account) && /settingsSet\(t\[1\], this\.checked\)/.test(account) && /window\.paintAutoTheme\(\)/.test(account));

console.log(out.join("\n"));
if (out.some((l) => l.startsWith("FAIL"))) process.exit(1);
