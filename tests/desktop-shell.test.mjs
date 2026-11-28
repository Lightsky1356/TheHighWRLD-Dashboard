/* The EXE has native window controls, a custom bar, and a quiet tray mode. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const read = (f) => readFileSync(join(ROOT, f), "utf8");
const main = read("electron-app/main.js");
const preload = read("electron-app/preload.js");
const design = read("design-system.css");
const drift = read("theme-drift.js");
const out = [];
const check = (name, pass) => out.push(`${pass ? "PASS" : "FAIL"}  ${name}`);

check("tray and native notifications are available", /Tray, Notification/.test(main) && /new Tray\(/.test(main) && /new Notification\(/.test(main));
check("close hides to the tray with the custom notice", /function hideToTray/.test(main) && /mainWindow\.hide\(\)/.test(main) && /It's in the tray by the clock/.test(main));
check("notice is named TheHighWRLD Dashboard", /title: "TheHighWRLD Dashboard"/.test(main) && !/juicewrl d\.io/.test(main));
check("native overlay owns minimise and fullscreen", /titleBarStyle: "hidden"/.test(main) && /titleBarOverlay:/.test(main) && !/frame: false/.test(main));
check("custom bar keeps only navigation", /thw-exe-bar/.test(main) && /data-a="back"/.test(main) && !/data-a="min"/.test(main) && !/data-a="max"/.test(main));
check("preload exposes navigation controls", /win: \{/.test(preload) && ["back", "forward", "reload", "close"].every((k) => preload.includes(`${k}: function`)));
check("hidden window pauses all animation", /highwrld:exe-hidden/.test(main) && /exe-hidden/.test(preload) && /html\.exe-hidden \*/.test(design) && /exe-hidden/.test(drift));
check("all blobs roam and bounce on desktop", !design.includes("is-desktop .th-blob") && /is-desktop/.test(main) && /Equal-mass bounces/.test(readFileSync(join(ROOT, "theme-drift.js"), "utf8")));

console.log(out.join("\n"));
if (out.some((l) => l.startsWith("FAIL"))) process.exit(1);
