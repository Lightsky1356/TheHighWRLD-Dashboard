/* Small source guards for three regressions:
 *  - a live head poll must never swap in an avatar that hides itself on error
 *  - the desktop player no longer shows the "Main version" chip
 *  - the desktop seek fill wears the current cover's gradient
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const read = (f) => readFileSync(join(ROOT, f), "utf8");
const out = [];
const check = (name, pass) => out.push(`${pass ? "PASS" : "FAIL"}  ${name}`);

const profile = read("profile.js");
check("live head updates use the avatar fallback chain", /av\.outerHTML = avatarHtml\(\{ avatar: d\.avatar, name: d\.name \}\)/.test(profile));
check("no avatar path hides itself on error", !/onerror=.*style\.display=\\'none\\'/.test(profile));

const dp = read("desktop-player.js");
check("the Main version chip is gone", !/dpl-versions|data-dpl=\"versions\"|Main version/.test(dp));
check("the seek fill uses the cover gradient", /dpl-prog-fill[\s\S]{0,120}seekFill\.style\.background = gradient/.test(dp));

console.log(out.join("\n"));
if (out.some((l) => l.startsWith("FAIL"))) process.exit(1);
