/* Desktop & mobile notifications panel in Settings. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const read = (f) => readFileSync(join(ROOT, f), "utf8");
const html = read("index.html");
const js = read("desktop-mobile-notifications.js");
const css = read("design-system.css");
const out = [];
const check = (name, pass) => out.push(`${pass ? "PASS" : "FAIL"}  ${name}`);

check("panel is loaded in Settings", html.includes("desktop-mobile-notifications.js") && html.includes('id="notifAppBlock"'));
check("all toggles from the screenshot exist", ["show", "messages", "leaks", "groupBuys", "snippets"].every((k) => html.includes(`id="notifApp-${k}"`)));
check("test notification button exists", html.includes('id="notifAppTest"') && html.includes("Send a test notification"));
check("preferences are saved locally", /wrldPlayerSettings\.set\(NS/.test(js) && /DEFAULTS/.test(js));
check("shows real notifications where supported", /highwrld\.notify|new Notification\(/.test(js) && /showToast/.test(js));
check("panel is styled for mobile and desktop", /\.app-notif-body/.test(css) && /\.app-notif-test/.test(css));

console.log(out.join("\n"));
if (out.some((l) => l.startsWith("FAIL"))) process.exit(1);
