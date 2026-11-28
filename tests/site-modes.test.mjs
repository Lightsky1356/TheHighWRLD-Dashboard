/* Four site modes with one shared token set for the full reset modes. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const read = (f) => readFileSync(join(ROOT, f), "utf8");
const html = read("index.html");
const css = read("site-mode.css");
const out = [];
const check = (name, pass) => out.push(`${pass ? "PASS" : "FAIL"}  ${name}`);

check("four modes are offered with the new labels", ['value="dark">Dark Glass', 'value="glass">Normal Glass', 'value="flat">Dark', 'value="light">Light'].every((o) => html.includes(o)));
check("Normal Glass keeps its frosted tokens", /html\[data-theme\]\[data-mode="glass"\]/.test(css) && /--ac-glass:rgba\(255,255,255,\.10\)/.test(css));
check("Dark Glass is the theme's own surfaces", /mode="dark"/.test(css) && !/\[data-mode="dark"\]\{/.test(css));
check("both full modes share one token set", ["flat", "light"].every((m) =>
  css.includes(`--mode-${m}-bg:`) && css.includes(`--mode-${m}-surface:`) &&
  css.includes(`--mode-${m}-text:`) && css.includes(`--mode-${m}-border:`) &&
  css.includes(`--ac-glass:var(--mode-${m}-surface)`) && css.includes(`--ac-text:var(--mode-${m}-text)`) &&
  css.includes(`--th-bg:var(--mode-${m}-bg)`)));
check("one application pass covers surfaces, borders, text and shadows",
  /html\[data-mode="flat"\] body,html\[data-mode="light"\] body\{background-color:var\(--th-bg\)!important\}/.test(css) &&
  ["flat", "light"].every((m) =>
    css.includes(`html[data-mode="${m}"] :is(body,p,span,h1,h2,h3,h4,h5,h6,li,label,b,small,em,strong,div,button,a,input,select,textarea,th,td,blockquote,summary){color:var(--mode-${m}-text)!important}`) &&
    css.includes(`html[data-mode="${m}"] :is(.app-page,.panel,.card,.hub-panel,.set-card,.info-panel,.foot-inner,.thw-sheet-panel,.nav-more-menu,.acct-menu,.palette-stage,.sheet-palettes,nav,#nav-pill,#app-breadcrumb,.set-guest-banner,.wanted-item,.playlist-item,.sugg-card,.lb-row){background-color:var(--mode-${m}-surface)!important;border-color:var(--mode-${m}-border)!important;box-shadow:var(--mode-${m}-shadow)!important}`)));
check("no blur or glow survives in either full mode", /backdrop-filter:none!important/.test(css) && /body::before\{background:var\(--th-bg\)!important;filter:none!important;animation:none!important\}/.test(css) && /\.th-blob\{opacity:\.18!important;filter:none!important\}/.test(css));

console.log(out.join("\n"));
if (out.some((l) => l.startsWith("FAIL"))) process.exit(1);
