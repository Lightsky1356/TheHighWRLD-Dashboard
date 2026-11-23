/* Regression guards for profile addresses and public playlists.
 *
 * A profile lives at /@handle. A site uid must never be written into a
 * profile URL, whether the link is built for the address bar, a copied link,
 * a chat name or a breadcrumb. Public playlists must appear on another
 * member's profile, because the API only sends the public ones to a viewer.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const read = (f) => readFileSync(join(ROOT, f), "utf8");
const out = [];
const check = (name, pass) => out.push(`${pass ? "PASS" : "FAIL"}  ${name}`);

const account = read("account.js");
check("profile addresses use the /@ prefix", /PROFILE_HANDLE_PREFIX\s*=\s*"\/@"/.test(account));
check("the address is built by one helper", /function profilePathFor\(/.test(account));
check("opening a member pushes the handle address", /pushState\([^;]*profilePathFor\(/.test(account));
check("Discord ids are resolved to a handle before navigating", /\/api\/profile\?discord=/.test(account) && /openResolved\(\(d && d\.handle\)/.test(account));
check("no /Profile/<key> address is built any more", !/PROFILE_PATH_ROOT\s*\+\s*"\/"\s*\+/.test(account));

const profile = read("profile.js");
check("the copied link uses the shared path helper", /window\.profilePathFor\(handle\)/.test(profile));
check("the address bar is canonicalised to the handle", /window\.profilePathFor\(handle\)/.test(profile));
check("public playlists are rendered for every viewer", /pv2-playlists/.test(profile) && /d\.playlists/.test(profile));
/* Two bugs that kept coming back: links live at the top level of /api/profile
   (not inside `profile`), and the head poll must follow the profile on screen
   rather than the signed-in viewer or it overwrites the viewed member. */
check("links fall back to the API's top-level array", /Array\.isArray\(d\.links\)/.test(profile));
check("the head poll follows the viewed profile first", /if \(!isSelfView\(\)\) return profileKey\(\);/.test(profile));
check("live hero edits cannot touch another profile", /__pv2ApplyLive[\s\S]{0,260}if \(!isSelfView\(\)\) return;/.test(profile));
const profileApi = read("functions/api/profile.js");
check("the head read resolves a handle to the site uid", /head"\) === "1"[\s\S]{0,500}byUsername/.test(profileApi));

const social = read("social-panel.js");
check("chat name links use the handle", /profilePathFor\(friend\.handle/.test(social));

const online = read("functions/api/online/members.js");
check("the online list supplies a handle for links", /handle:\s*String\(handle/.test(online));

console.log(out.join("\n"));
if (out.some((l) => l.startsWith("FAIL"))) process.exit(1);
