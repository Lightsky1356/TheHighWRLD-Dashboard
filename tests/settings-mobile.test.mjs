/* On phones the Settings panels must use the whole width - the old layout
   stacked four nested paddings and squeezed them. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const css = readFileSync(join(ROOT, "account.css"), "utf8");
const checks = [
  ["mobile media query exists", /@media \(max-width: 640px\)[\s\S]*settings-layout/.test(css)],
  ["outer gutters are removed", /#page-section-account\{padding-left:0 !important;padding-right:0 !important\}/.test(css)],
  ["panels claim full width", /#page-section-account \.set-body \.card,[\s\S]{0,140}width:100% !important/.test(css) && /#page-section-account \.set-body \.section/.test(css)],
  ["select rows stack on mobile", /\.toggle-row:has\(\.thw-select\)\{flex-wrap:wrap/.test(css) && /\.toggle-row \.thw-select\{flex:1 1 100%/.test(css)],
  ["notification buttons are styled", /\.thw-push-btn--on,[\s\S]{0,240}linear-gradient\(135deg,#a78bfa,#7c6cf0\)/.test(css)],
  ["guest state stays aligned on mobile", /\.thw-push-pill\{width:auto !important/.test(css) && /\.guest-note \.btn\{flex:1 1 100%/.test(css)],
];
let ok = true;
for (const [name, pass] of checks) {
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}`);
  if (!pass) ok = false;
}
if (!ok) process.exit(1);
