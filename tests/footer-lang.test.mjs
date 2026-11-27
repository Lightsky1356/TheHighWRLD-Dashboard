/* Language lives in the footer picker, driven by the existing setLang path. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const read = (f) => readFileSync(join(ROOT, f), "utf8");
const html = read("index.html");
const account = read("account.js");
const css = read("design-system.css");
const out = [];
const check = (name, pass) => out.push(`${pass ? "PASS" : "FAIL"}  ${name}`);

check("settings keeps only the hidden source select", /<select id="setLang" hidden aria-hidden="true"><\/select>/.test(html) && !/for="setLang">Language/.test(html));
check("footer picker is in the footer bar", /id="foot-langs"/.test(html) && /id="foot-lang-btn"/.test(html) && /id="foot-lang-menu"/.test(html));
check("picker drives the saved language path", /foot-lang-btn/.test(account) && /lg\.dispatchEvent\(new Event\("change"/.test(account) && /foot-lang-label/.test(account));
check("picker menu is styled", /\.foot-lang-menu\{/.test(css) && /aria-selected=/.test(account) && /on \? "true" : "false"/.test(account));

console.log(out.join("\n"));
if (out.some((l) => l.startsWith("FAIL"))) process.exit(1);
