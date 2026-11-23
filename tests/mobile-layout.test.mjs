/* Site-wide mobile layout guards. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const read = (f) => readFileSync(join(ROOT, f), "utf8");
const html = read("index.html");
const css = read("mobile.css");
const account = read("account.css");
const sw = read("sw.js");
const out = [];
const check = (name, pass) => out.push(`${pass ? "PASS" : "FAIL"}  ${name}`);

check("mobile polish sheet is loaded last and precached", /mobile\.css\?v=thw-v1/.test(html) && /'\.\/mobile\.css\?v=thw-v1'/.test(sw));
check("zoom is no longer disabled", /name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"/.test(html) && !/user-scalable=no/.test(html));
check("critical animations are valid CSS", !/@@keyframes/.test(html));
check("account responsive tier is valid CSS", !/#account-page @media/.test(account) && /@media \(max-width:1024px\)/.test(account) && /#account-page \.stats-grid\{grid-template-columns:repeat\(3,1fr\)\}/.test(account));
check("one mobile breakpoint drives the layout", /@media \(max-width:767px\)/.test(css) && /--mbn-h: calc\(54px \+ env\(safe-area-inset-bottom, 0px\)\)/.test(css));
check("grids and selects collapse on phones", /\.thw-select\{min-width:0;width:100%\}/.test(css) && /grid-template-columns:minmax\(0,1fr\) !important/.test(css));

console.log(out.join("\n"));
if (out.some((l) => l.startsWith("FAIL"))) process.exit(1);
