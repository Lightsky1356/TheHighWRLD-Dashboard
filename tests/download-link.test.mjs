/* The site's Windows download points at the published 1.0.6 installer. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const html = readFileSync(join(ROOT, "index.html"), "utf8");
const out = [];
const check = (name, pass) => out.push(`${pass ? "PASS" : "FAIL"}  ${name}`);

check("Windows download uses v1.0.6", (html.match(/releases\/download\/v1\.0\.6\/TheHighWRLD\.Dashboard\.Setup\.1\.0\.6\.exe/g) || []).length === 2);
check("no stale Windows 1.0.5 links remain", !html.includes("Setup.1.0.5.exe"));
check("checksum matches the new installer", html.includes("TheHighWRLD.Dashboard.Setup.1.0.6.exe         1201D6330F65B6B67C88FEF76343669091B2B6A5811328C23715ABBE54A23403"));
check("download page shows the new version", /Version <span class="text-white\/80">v1\.0\.6<\/span>/.test(html));

console.log(out.join("\n"));
if (out.some((l) => l.startsWith("FAIL"))) process.exit(1);
