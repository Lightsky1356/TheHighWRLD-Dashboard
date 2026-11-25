/* WRLD Player additions: real listening panel and cover-driven Auto theme. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const read = (f) => readFileSync(join(ROOT, f), "utf8");
const html = read("index.html");
const js = read("player-insights.js");
const css = read("player-insights.css");
const cover = read("cover-pref.js");
const sw = read("sw.js");
const out = [];
const check = (name, pass) => out.push(`${pass ? "PASS" : "FAIL"}  ${name}`);

check("listening panel is mounted and precached", /id="playerInsights"/.test(html) && /player-insights\.js\?v=thw-v1/.test(html) && /'\.\/player-insights\.js\?v=thw-v1'/.test(sw) && /'\.\/player-insights\.css\?v=thw-v1'/.test(sw));
check("listening panel uses only real API data", /fetch\("\/api\/profile"/.test(js) && /topPlays/.test(js) && /d\.activity/.test(js) && !/Math\.random/.test(js));
check("signed-out visitors get a sign-in gate", /pi-gate/.test(js) && /showAuthPage\("login"\)/.test(js));
check("listening panel has responsive styles", /pi-stats/.test(css) && /@media \(max-width:767px\)/.test(css));
check("Auto theme paints the cover gradient on the page background", /data-theme"\) !== "auto"/.test(cover) && /--th-bg/.test(cover) && /coverGradientRaw\(cover\)/.test(cover) && /data-theme'\]/.test(cover));

console.log(out.join("\n"));
if (out.some((l) => l.startsWith("FAIL"))) process.exit(1);
