/* The EXE has its own address bar and minimises to a notifying tray icon. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const read = (f) => readFileSync(join(ROOT, f), "utf8");
const main = read("electron-app/main.js");
const preload = read("electron-app/preload.js");
const out = [];
const check = (name, pass) => out.push(`${pass ? "PASS" : "FAIL"}  ${name}`);

check("tray and native notifications are available", /Tray, Notification/.test(main) && /new Tray\(/.test(main) && /new Notification\(/.test(main));
check("close hides to the tray with the custom notice", /function hideToTray/.test(main) && /mainWindow\.hide\(\)/.test(main) && /It's in the tray by the clock/.test(main));
check("notice is named TheHighWRLD Dashboard", /title: "TheHighWRLD Dashboard"/.test(main) && !/juicewrl d\.io/.test(main));
check("custom bar replaces the OS title bar", /frame: false/.test(main) && /thw-exe-bar/.test(main) && /highwrld:win-maximize/.test(main));
check("preload exposes the bar controls", /win: \{/.test(preload) && ["minimize", "maximize", "close", "back", "forward", "reload"].every((k) => preload.includes(`${k}: function`)));
check("fullscreen and minimize are enabled", /setFullScreen\(!mainWindow\.isFullScreen\(\)\)/.test(main) && /setMinimizable\(true\)/.test(main) && /setMaximizable\(true\)/.test(main));

console.log(out.join("\n"));
if (out.some((l) => l.startsWith("FAIL"))) process.exit(1);
