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
/* More achievements, each backed by a stat the profile actually loads. */
check("extra achievements cover hours, favourites and XP", /id: "hours100"/.test(profile) && /id: "fav25"/.test(profile) && /id: "xp5000"/.test(profile));
check("achievement stats include the new real fields", /favorites: favs\.length/.test(profile) && /weekXp: xpObj/.test(profile));
const achCount = (profile.match(/\{ id: "/g) || []).length;
check("the profile has a large achievement set", achCount >= 120, `${achCount} achievements`);
check("achievement rows are capped with a show-all toggle", /ACH_ROW_CAP = 25/.test(profile) && /id="achShowAll"/.test(profile));
check("profile shows only the 8 most recent earned badges", /CARD_ACH_CAP = 8/.test(profile) && /achStampUnlocks/.test(profile) && /earned\.sort\(/.test(profile));
check("achievements modal has latest, summary and category grids", /ach-latest/.test(profile) && /ach-summary-ring/.test(profile) && /ach-section-head/.test(profile) && /ach-cell/.test(profile));
check("progress rings use real progress, no invented rarity", /achRing\(p, m\.icon\)/.test(profile) && !/Rare: \d+%/.test(profile + read("profile.css")));
check("the achievements modal opens when .open is set", /#achievementsModal\.rank-overlay\.open\{display:flex\}/.test(read("profile.css")));
check("the profile card only shows earned badges", /var earned = MILESTONES\.filter/.test(profile) && /var list = cardAchShowAll \? earned/.test(profile));
/* Account dropdown head mirrors the rank ladder and streak. */
check("account dropdown shows rank, level, XP bar and streak", /id="acctRankTitle"/.test(read("index.html")) && /id="acctXpFill"/.test(read("index.html")) && /id="acctStreakN"/.test(read("index.html")));
check("account dropdown values come from the APIs", /function fillRank\(\)/.test(account) && /acctXpFill/.test(account) && /acctStreakN/.test(account));
check("rank spans survive profile re-renders", !/acctTag\.textContent/.test(account) && /id="acctVerified"/.test(read("index.html")));
const achApi = read("functions/_lib/achievements.js");
check("there are no game achievements", !/cat: "Games"/.test(achApi) && !/id: "gm_/.test(achApi) && !/<h5>Games<\/h5>/.test(read("index.html")));
check("level names use the vault's eras", /t: "JuiceTheKidd"/.test(profile) && /t: "Legends Never Die"/.test(profile) && /t: "Posthumous"/.test(profile));
check("level card shows the rank name and its colour", /id="pv2LevelTitle"/.test(profile) && /paintLevelBadge\(lvl\)/.test(profile) && /function rankDot\(/.test(profile));
check("listened stat formats hours and minutes without seconds", /function fmtDuration\(/.test(profile) && /h \+ "h " \+ m \+ "m"/.test(profile) && !/sec \+ "s"/.test(profile));
check("the achievements overlay blurs the page", /#achievementsModal\.rank-overlay\{[^}]*backdrop-filter:blur\(8px\)/.test(read("profile.css")));
check("level and strip cards refresh from the head poll", /refreshLiveCards\(d\)/.test(profile) && /id="pv2XpNote"/.test(profile) && /"Plays", "pv2StatPlays"/.test(profile));
const rankCss = read("profile.css").match(/\.rank-shell\{[^}]*\}/)?.[0] || "";
check("achievements modal matches the Info panel size", /width:min\(860px,92vw\)/.test(rankCss) && /\.info-panel\{\s*width:min\(860px,92vw\)/.test(read("player-settings.css")));
check("the head poll follows the viewed profile first", /if \(!isSelfView\(\)\) return profileKey\(\);/.test(profile));
check("live hero edits cannot touch another profile", /__pv2ApplyLive[\s\S]{0,260}if \(!isSelfView\(\)\) return;/.test(profile));
const profileApi = read("functions/api/profile.js");
check("the head read resolves a handle to the site uid", /head"\) === "1"[\s\S]{0,500}byUsername/.test(profileApi));
/* Presence on another member's profile: the dot must carry a real status
   colour and a readable label, and the Links block needs a separator. */
check("presence dot maps online/idle/offline to colours", /statusInfo\(status\)/.test(profile) && /#f59e0b/.test(profile) && /#64748b/.test(profile));
check("presence dot keeps an accessible label but no hover tooltip", /aria-label="'\s*\+\s*esc2\(title\)/.test(profile) && !/pv2-dot[^>]*title=/.test(profile) && !/pv2-dot\{[^}]*cursor:help/.test(read("profile.css")));
check("no separate visible status label", !/statusLabelHTML|pv2-status-label/.test(profile + read("profile.css")));
check("links section has a separator", /border-top:1px solid var\(--pv-border-soft\)/.test(read("profile.css")));

const social = read("social-panel.js");
check("chat name links use the handle", /profilePathFor\(friend\.handle/.test(social));

const online = read("functions/api/online/members.js");
check("the online list supplies a handle for links", /handle:\s*String\(handle/.test(online));

console.log(out.join("\n"));
if (out.some((l) => l.startsWith("FAIL"))) process.exit(1);
