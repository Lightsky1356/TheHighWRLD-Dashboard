/* The three era themes wear their supplied four-colour palettes in full. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const css = readFileSync(join(ROOT, "themes.css"), "utf8");
const rule = (id) => {
  const start = css.indexOf(`html[data-theme="${id}"]{`);
  if (start < 0) return "";
  return css.slice(start, css.indexOf("\n}", start));
};
const out = [];
const check = (name, pass) => out.push(`${pass ? "PASS" : "FAIL"}  ${name}`);
/* The theme paints these as rgba() pools; the accent keeps the hex form. */
const rgb = (h) => { const n = parseInt(h.slice(1), 16); return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`; };

const eras = [
  ["era-wod", ["#287C80", "#65B9AC", "#8271A4", "#D18EB9"]],
  ["era-gbgr", ["#111114", "#39363B", "#817C80", "#B52F48"]],
  ["era-drfl", ["#100E20", "#462568", "#A33D32", "#F07832"]],
];
for (const [id, colors] of eras) {
  const body = rule(id);
  check(`${id} uses every supplied colour`, colors.every((c) => body.includes(c) || body.includes(rgb(c))));
  check(`${id} paints a layer per colour`, (body.match(/radial-gradient\(/g) || []).length >= 4 && /linear-gradient\(135deg/.test(body));
}

console.log(out.join("\n"));
if (out.some((l) => l.startsWith("FAIL"))) process.exit(1);
