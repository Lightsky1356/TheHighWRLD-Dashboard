/* The leaderboard says plays and comments both count; make sure plays award
 * XP on the server from the play-recording path. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const src = readFileSync(join(ROOT, "functions/_lib/listens-stats.js"), "utf8");
const pass = /import \{ awardXp \}/.test(src) && /awardXp\(db, uid, 5\)/.test(src);
console.log(`${pass ? "PASS" : "FAIL"}  recording a play awards five XP server-side`);

const xpApi = readFileSync(join(ROOT, "functions/api/xp.js"), "utf8");
const resolved = /resolveHandle\(db, asked\)/.test(xpApi) && /site_uid AS id FROM discord_links/.test(xpApi);
console.log(`${resolved ? "PASS" : "FAIL"}  xp queries resolve a /@handle to the site uid`);
if (!pass || !resolved) process.exit(1);
