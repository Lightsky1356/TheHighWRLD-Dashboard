/* Cover-tinted transport icons and a real catalogue search in the queue. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const read = (f) => readFileSync(join(ROOT, f), "utf8");
const css = read("design-system.css");
const cover = read("cover-pref.js");
const queue = read("queue-side.js");
const out = [];
const check = (name, pass) => out.push(`${pass ? "PASS" : "FAIL"}  ${name}`);

check("transport icons use the cover gradient, darkened", /--thw-cover-grad/.test(cover) && /#deck-shuffle-btn i,#deck-repeat-btn i,#deck-play i/.test(css) && /brightness\(\.62\)/.test(css));
check("icon gradient follows track changes", /paintControlIcons\(\)/.test(cover) && /thw:trackplaying/.test(cover));
check("queue has a search field", /qs-add-search/.test(queue) && /Add a song to the queue/.test(queue));
check("queue search uses real catalogue and appends", /trackList/.test(queue) && /window\.addToQueue/.test(queue) && /qs-add-row/.test(queue));

console.log(out.join("\n"));
if (out.some((l) => l.startsWith("FAIL"))) process.exit(1);
