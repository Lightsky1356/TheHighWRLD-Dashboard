/* The site's Windows download points at the published 1.0.6 installer. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const html = readFileSync(join(ROOT, "index.html"), "utf8");
const out = [];
const check = (name, pass) => out.push(`${pass ? "PASS" : "FAIL"}  ${name}`);

check("Windows download uses v1.0.8", (html.match(/releases\/download\/v1\.0\.8\/TheHighWRLD\.Dashboard\.Setup\.1\.0\.8\.exe/g) || []).length === 2);
check("no stale Windows links remain", !html.includes("Setup.1.0.5.exe") && !html.includes("Setup.1.0.6.exe") && !html.includes("Setup.1.0.7.exe"));
check("checksum matches the new installer", html.includes("TheHighWRLD.Dashboard.Setup.1.0.8.exe         FE523C43DDA92E7D5A3FB4A53931F6125C279A44D1238B13EDA56670F5B2A460"));
check("download page shows the new version", /Version <span class="text-white\/80">v1\.0\.8<\/span>/.test(html));

console.log(out.join("\n"));
if (out.some((l) => l.startsWith("FAIL"))) process.exit(1);
