/* Full sheets, deck progress, patterns and EXE Space all follow the cover. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const read = (f) => readFileSync(join(ROOT, f), "utf8");
const script = read("script.js");
const mobile = read("mobile-player.js");
const desktop = read("desktop-player.js");
const css = read("player-settings.css");
const design = read("design-system.css");
const main = read("electron-app/main.js");
const out = [];
const check = (name, pass) => out.push(`${pass ? "PASS" : "FAIL"}  ${name}`);

check("full sheets paint from the displayed cover", /getCoverGradientValue\(cover\)/.test(mobile) && /window\.wrldCoverFor\(t\)/.test(desktop));
check("full sheets use every colour stop", /for \(var i = 0; i < cols\.length; i\+\+\)/.test(mobile) && /for \(var i = 0; i < cols\.length; i\+\+\)/.test(desktop));
check("deck progress wears the cover gradient", /\.deck-progress-bar\{[^}]*background:var\(--thw-cover-grad/.test(css));
check("wave is a seamless sine, liquid fades like water", /C 40 " \+ top \+ ", 80 " \+ top/.test(script) && /linearGradient id='a'/.test(script) && /stop-color='" \+ _thwHslRgba\(cols\[q\], 0\)/.test(script));
check("Top button clears the deck and hides on profile sheet", /mobile-profile-popup:not\(\.hidden\)\) #scrollTopBtn\{display:none!important\}/.test(design) && /deck-player:not\(\.hidden\):not\(\.deck-away\)\) #scrollTopBtn/.test(design));
check("EXE Space toggles playback", /e\.code!=='Space'/.test(main) && /getElementById\('deck-play'\)/.test(main));

console.log(out.join("\n"));
if (out.some((l) => l.startsWith("FAIL"))) process.exit(1);
