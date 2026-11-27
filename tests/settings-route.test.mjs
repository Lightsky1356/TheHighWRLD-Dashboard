/* /settings is the account route, everywhere it is mapped or linked. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const read = (f) => readFileSync(join(ROOT, f), "utf8");
const account = read("account.js");
const legal = read("legal-info.js");
const html = read("index.html");
const out = [];
const check = (name, pass) => out.push(`${pass ? "PASS" : "FAIL"}  ${name}`);

check("SPA nav map uses /settings", /account: "\/settings"/.test(account) && !/account: "\/account"/.test(account));
check("legal panel routes and links /settings", /"\/settings": "account"/.test(legal) && !/"\/account": "account"/.test(legal) && /setAttribute\("href", "\/settings"\)/.test(legal));
check("direct /settings loads the account stylesheet", /\^\\\/settings\$\/i/.test(html) && !/\^\\\/account\$\/i/.test(html));
check("the legal account link points at /settings", /data-legal-account href="\/settings"/.test(html));

console.log(out.join("\n"));
if (out.some((l) => l.startsWith("FAIL"))) process.exit(1);
