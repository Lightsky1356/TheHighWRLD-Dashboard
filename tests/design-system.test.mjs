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

check("design system is loaded last and precached", /design-system\.css\?v=thw-v1/.test(html) && /'\.\/design-system\.css\?v=thw-v1'/.test(sw));
check("design tokens and focus states exist", /--ds-radius:16px/.test(css) && /:focus-visible\{outline:2px solid var\(--ds-accent\)/.test(css));
check("surfaces and rows share one radius", /\.card,\.hub-panel,\.pv2-card,\.set-card,\.rank-shell/.test(css) && /\.playlist-item,\.wanted-item,\.sugg-card,\.lb-row/.test(css));
check("motion and scrollbars are consistent", /prefers-reduced-motion/.test(css) && /::-webkit-scrollbar-thumb/.test(css));
check("nav is untouched", !/mobile-bottom-nav|\.mbn-item|#nav-pill|\.page-tab-btn|\.nav-more|\.nav-auth-btn/.test(css));

console.log(out.join("\n"));
if (out.some((l) => l.startsWith("FAIL"))) process.exit(1);
