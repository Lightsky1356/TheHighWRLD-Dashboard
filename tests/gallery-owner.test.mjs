/* Gallery author controls: server-enforced spoiler toggle, author-only UI. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const read = (f) => readFileSync(join(ROOT, f), "utf8");
const api = read("functions/api/gallery.js");
const js = read("gallery.js");
const out = [];
const check = (name, pass) => out.push(`${pass ? "PASS" : "FAIL"}  ${name}`);

check("spoiler toggle is server-enforced from the session", /action === "setSpoiler"/.test(api) && /String\(row\.uid \|\| ""\) !== String\(me\.uid\)/.test(api) && /UPDATE gallery_items SET spoiler/.test(api));
check("single-item JSON lightbox source exists", /itemParam/.test(api) && /spoiler/.test(api) && /"\/api\/gallery\?item="/.test(js));
check("author-only controls appear on cards and lightbox", /data-gal-spoiler=/.test(js) && /data-gal-del=/.test(js) && /String\(it\.uid\) === String\(myUid\(\)\)/.test(js));
check("gallery styling has mobile and reduced-motion rules", /@media \(max-width:640px\)/.test(js) && /prefers-reduced-motion/.test(js) && /gal-empty/.test(js));
check("gallery script token is precached", /gallery\.js\?v=thw-v14/.test(read("index.html")) && /'\.\/gallery\.js\?v=thw-v14'/.test(read("sw.js")));
check("gallery community stats and layout toggle", /community=1/.test(js) && /gal-layout/.test(js) && /is-roomy/.test(js));
check("gallery conversation has real API endpoints", /commentCreate/.test(api) && /commentDelete/.test(api) && /gallery_comments/.test(api) && /galCompose/.test(js));
check("lightbox has no scroll container", /\.gal-box\{max-width:min\(760px,94vw\);max-height:none;overflow:hidden/.test(js));

console.log(out.join("\n"));
if (out.some((l) => l.startsWith("FAIL"))) process.exit(1);
