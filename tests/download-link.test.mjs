/* The site's Windows download points at the published 1.0.6 installer. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const html = readFileSync(join(ROOT, "index.html"), "utf8");
const out = [];
const check = (name, pass) => out.push(`${pass ? "PASS" : "FAIL"}  ${name}`);

check("Windows download uses v1.0.7", (html.match(/releases\/download\/v1\.0\.7\/TheHighWRLD\.Dashboard\.Setup\.1\.0\.7\.exe/g) || []).length === 2);
check("no stale Windows links remain", !html.includes("Setup.1.0.5.exe") && !html.includes("Setup.1.0.6.exe"));
check("checksum matches the new installer", html.includes("TheHighWRLD.Dashboard.Setup.1.0.7.exe         EC15BC75D1FDB50A6D526A1A0E4E6C057250128DD47EC80309CDDAAF61FA2DF4"));
check("download page shows the new version", /Version <span class="text-white\/80">v1\.0\.7<\/span>/.test(html));

console.log(out.join("\n"));
if (out.some((l) => l.startsWith("FAIL"))) process.exit(1);
