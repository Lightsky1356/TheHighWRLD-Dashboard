/* Four site modes: Dark Glass, Normal Glass, Dark and Light. */
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
check("Dark Glass is the theme's own surfaces", /mode=dark/.test(css) && !/\[data-mode="dark"\]\{/.test(css));
check("Dark mode is opaque with no blur", /data-mode="flat"/.test(css) && /--ac-glass:rgba\(16,16,26,\.96\)/.test(css) && /backdrop-filter:none!important/.test(css));
check("Light mode changes background, text and chrome", /data-mode="light"/.test(css) && /--ac-bg0:#f4f5fb/.test(css) && /color:#17172b/.test(css) && /#app-breadcrumb/.test(css) && /#nav-pill/.test(css) && /\.set-guest-banner/.test(css));
check("Dark kills blur on every element and surface", /backdrop-filter:none!important/.test(css) && /body::before\{filter:none!important/.test(css) && /blur-active nav/.test(css) && /\.th-blob/.test(css));
check("Light repaints every surface and text globally", /html\[data-mode="light"\] :is\(\.app-page/.test(css) && /html\[data-mode="light"\] body,\s*html\[data-mode="light"\] html\{background:#f6f7fd!important/.test(css) && /:is\(p,span,h1,h2,h3,h4,h5,h6,li,label,b,small,em,strong,div,button,a,input,select,textarea\)\{color:#1c1c30!important/.test(css));

console.log(out.join("\n"));
if (out.some((l) => l.startsWith("FAIL"))) process.exit(1);
