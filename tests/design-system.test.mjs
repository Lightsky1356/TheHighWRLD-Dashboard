/* One design token layer, loaded last, with no nav rules. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const read = (f) => readFileSync(join(ROOT, f), "utf8");
const html = read("index.html");
const css = read("design-system.css");
const sw = read("sw.js");
const out = [];
const check = (name, pass) => out.push(`${pass ? "PASS" : "FAIL"}  ${name}`);

check("design system is loaded last and precached", /design-system\.css\?v=thw-v13/.test(html) && /'\.\/design-system\.css\?v=thw-v13'/.test(sw));
check("design tokens and focus states exist", /--ds-radius:16px/.test(css) && /:focus-visible\{outline:2px solid var\(--ds-accent\)/.test(css));
check("surfaces and rows share one radius", /\.card,\.hub-panel,\.pv2-card,\.set-card,\.rank-shell/.test(css) && /\.playlist-item,\.wanted-item,\.sugg-card,\.lb-row/.test(css));
check("motion and scrollbars are consistent", /prefers-reduced-motion/.test(css) && /::-webkit-scrollbar-thumb/.test(css));
check("nav is untouched", !/mobile-bottom-nav|\.mbn-item|#nav-pill|\.page-tab-btn|\.nav-more|\.nav-auth-btn/.test(css));
check("player ambient layer removed and rules panel fits", /#page-section-player::before,[\s\S]{0,60}display:none !important/.test(css) && /lobby-panel-rules p\{font-size:12px/.test(css));
check("transport icons glow with the cover colour", /drop-shadow\(0 0 5px var\(--thw-cover-c1/.test(css) && /box-shadow:0 0 18px var\(--thw-cover-c1/.test(css));
check("shuffle and repeat have distinct on/off visuals", css.includes("text-white\\/40") && /text-cyan-400/.test(css) && /:has\(i\.text-cyan-400\)/.test(css));
check("player section uses one shared theme layer", /#page-section-player\{background:transparent !important\}/.test(css));

console.log(out.join("\n"));
if (out.some((l) => l.startsWith("FAIL"))) process.exit(1);
