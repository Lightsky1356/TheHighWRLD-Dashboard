/* Playback settings are all on/off switches, speed control is gone, and the
   Friends view has a real mobile layout. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const read = (f) => readFileSync(join(ROOT, f), "utf8");
const html = read("index.html");
const account = read("account.js");
const player = read("player-settings.js");
const social = read("social.css");
const out = [];
const check = (name, pass) => out.push(`${pass ? "PASS" : "FAIL"}  ${name}`);

check("playback speed is gone from settings", !/pbSpeedSelect|Playback speed/.test(html) && !/playbackRate|setRate/.test(player) && !/pbSpeedSelect/.test(account));
check("queue choice is a toggle", /id="pbKeepQueueToggle"/.test(html) && /pbKeepQueueToggle/.test(account));
check("all playback rows are switches", !/thw-select/.test(html.slice(html.indexOf('id="playback"'), html.indexOf('id="notifications"'))));
check("social tabs ignore global nav padding", /nav\.thw-social-tabs\{padding:10px 12px !important/.test(social));
check("friends view has mobile rules", /\[data-view="friends"\] \.thw-social-list\{min-width:0/.test(social) && /\.thw-social-root--page \.thw-social-gate\{flex:1 1 auto/.test(social));

console.log(out.join("\n"));
if (out.some((l) => l.startsWith("FAIL"))) process.exit(1);
