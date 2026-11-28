/* Drops & Events is gone: no renderer, API, bootstrap field or search group. */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const read = (f) => readFileSync(join(ROOT, f), "utf8");
const html = read("index.html");
const sw = read("sw.js");
const bootstrap = read("functions/api/bootstrap.js");
const search = read("functions/api/search.js");
const gs = read("global-search.js");
const out = [];
const check = (name, pass) => out.push(`${pass ? "PASS" : "FAIL"}  ${name}`);

check("renderer and API are deleted", !existsSync(join(ROOT, "drops.js")) && !existsSync(join(ROOT, "functions/api/drops.js")));
check("section is no longer loaded or precached", !html.includes("drops.js") && !sw.includes("drops.js"));
check("bootstrap no longer returns drops", !/\bdrops\b/.test(bootstrap));
check("search no longer indexes drops", !/\bdrops\b/.test(search) && !gs.includes("gsDrops") && !gs.includes("data-gs-drop"));
check("no drops section hook remains", !read("account.js").includes("drops-sec"));

console.log(out.join("\n"));
if (out.some((l) => l.startsWith("FAIL"))) process.exit(1);
