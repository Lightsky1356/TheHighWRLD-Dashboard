/* Desktop polish is loaded last and scoped to wide screens only. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const read = (f) => readFileSync(join(ROOT, f), "utf8");
const html = read("index.html");
const css = read("desktop-polish.css");
const sw = read("sw.js");
const out = [];
const check = (name, pass) => out.push(`${pass ? "PASS" : "FAIL"}  ${name}`);

check("desktop sheet is loaded last and precached", /desktop-polish\.css\?v=thw-v1/.test(html) && /'\.\/desktop-polish\.css\?v=thw-v1'/.test(sw));
check("desktop rules never reach phone widths", /@media \(min-width:1024px\)/.test(css) && !/@media \(max-width:767px\)/.test(css));
check("settings heading gets room and width", /#account-page\.settings-page\{/.test(css) && /max-width:1240px !important/.test(css));
check("deck actions no longer shrink", /#deck-player \.deck-actions>\.deck-btn\{flex:0 0 34px\}/.test(css));
check("nav keeps one indicator and frozen frost", /#nav-pill \.page-tab-btn\.active\{background:transparent/.test(css) && /html\.is-idle #nav-pill/.test(css));
check("wide content pages are widened", /#player-container\{max-width:960px\}/.test(css) && /\.lb-page\{max-width:1040px\}/.test(css));

console.log(out.join("\n"));
if (out.some((l) => l.startsWith("FAIL"))) process.exit(1);
