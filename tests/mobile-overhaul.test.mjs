/* The mobile overhaul must be last, phone-only, and must not restyle the nav. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const read = (f) => readFileSync(join(ROOT, f), "utf8");
const html = read("index.html");
const css = read("mobile-overhaul.css");
const sw = read("sw.js");
const out = [];
const check = (name, pass) => out.push(`${pass ? "PASS" : "FAIL"}  ${name}`);

check("overhaul sheet is loaded last and precached", /mobile-overhaul\.css\?v=thw-v7/.test(html) && /'\.\/mobile-overhaul\.css\?v=thw-v7'/.test(sw));
check("overhaul is phone-only", /@media \(max-width:767px\)/.test(css) && !/min-width/.test(css));
check("nav is untouched", !/mobile-bottom-nav|\.mbn-item|#nav-pill|\.page-tab-btn|\.nav-more|\.nav-auth-btn|\.mobile-profile-popup|\.thw-sheet-panel/.test(css));
check("messages empty space collapses and Top clears the deck", /\.thw-social-list:empty\{display:none\}/.test(css) && /#scrollTopBtn\{[\s\S]{0,120}bottom:calc/.test(css));
check("readable type and touch controls", /\.text-gray-600,.text-gray-500,.text-gray-400/.test(css) && /font-size:16px !important/.test(css) && /min-height:40px/.test(css));
check("content panels fill the width", /max-width:100% !important/.test(css) && /\.table-wrap\{overflow-x:auto/.test(css));

console.log(out.join("\n"));
if (out.some((l) => l.startsWith("FAIL"))) process.exit(1);
