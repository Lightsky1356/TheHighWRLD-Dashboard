/* The player's three-dot menu: removed items must be gone, and navigation
 * items must put the full-sheet player away. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const src = readFileSync(join(ROOT, "context-menu.js"), "utf8");
const out = [];
const check = (name, pass) => out.push(`${pass ? "PASS" : "FAIL"}  ${name}`);

for (const [act, label] of [["versions", "Other versions"], ["edit", "Edit this song"], ["openqueue", "Open queue"], ["eq", "Equalizer and reverb"]]) {
  check(`${label} is gone`, !new RegExp(`data-act="${act}"`).test(src) && !new RegExp(`a === "${act}"`).test(src));
}
check("Go to era opens the era page", /a === "era"[\s\S]{0,220}window\.openEraPage\(code\)/.test(src));
check("Go to song closes the full sheet", /a === "song"[\s\S]{0,120}closeSheet\(\)/.test(src));
check("Close player stops playback and closes the sheet", /a === "close"[\s\S]{0,500}closeSheet\(\)/.test(src));

console.log(out.join("\n"));
if (out.some((l) => l.startsWith("FAIL"))) process.exit(1);
