/* Every era has cover art, and it drives Auto's theme and the deck wash. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const read = (f) => readFileSync(join(ROOT, f), "utf8");
const cover = read("cover-pref.js");
const script = read("script.js");
const out = [];
const check = (name, pass) => out.push(`${pass ? "PASS" : "FAIL"}  ${name}`);

const eras = ["GB&GR", "WOD", "DRFL", "JW3", "POST", "999", "JW999", "OUT", "AF", "ND", "BDM", "HIH", "JUTE"];
check("all era tags have cover art", eras.every((e) => new RegExp(`"${e.replace("&", "&amp;")}":\\s*"`).test(cover) || cover.includes(`"${e}":`)));
check("JUTE is a recognised era tag", /HIH\|JUTE/.test(cover));
check("deck wash follows the displayed era cover", /getCoverGradientValue\(window\.wrldCoverFor\(cur\)\)/.test(cover));
check("era art has real gradients in the cover map", ["GBGR.webp", "WOD.webp", "DRFL.webp", "OUT.webp", "ND.webp", "BDM.webp", "HIH.webp", "JUTE.webp"].every((p) => script.includes(p)));

console.log(out.join("\n"));
if (out.some((l) => l.startsWith("FAIL"))) process.exit(1);
