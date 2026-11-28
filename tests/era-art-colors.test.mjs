/* Era gradients come from the actual cover art; JW999 is JW3. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const read = (f) => readFileSync(join(ROOT, f), "utf8");
const cover = read("cover-pref.js");
const script = read("script.js");
const html = read("index.html");
const out = [];
const check = (name, pass) => out.push(`${pass ? "PASS" : "FAIL"}  ${name}`);

const art = ["AlbumArt/goodbye.jpg", "AlbumArt/death.jpg", "AlbumArt/party.jpg", "AlbumArt/999.jpg", "assets/settings-era/JW999.webp"];
check("era covers use real album art", art.every((p) => cover.includes(p)) && !cover.includes('"GB&GR": "assets/settings-era/GBGR.webp"'));
check("JW999 is JW3", /"JW3": "assets\/settings-era\/JW999.webp"/.test(cover) && /replace\(\/\^JW999\$\/, "JW3"\)/.test(cover) && html.includes('>JW3</span>'));
check("era gradients use colours sampled from art", art.every((p) => {
  const at = script.indexOf(`"${p}":"linear-gradient(`);
  if (at < 0) return false;
  const end = script.indexOf('"', at + p.length + 4);
  const stops = script.slice(at, end).match(/#[0-9a-f]{6}/gi) || [];
  return stops.length === 4;
}));

console.log(out.join("\n"));
if (out.some((l) => l.startsWith("FAIL"))) process.exit(1);
