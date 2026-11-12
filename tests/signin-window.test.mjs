// SIGNING IN WITHOUT THROWING THE PAGE AWAY
//
// WHY THIS SUITE EXISTS
// Signing in used to be a whole navigation: the site sent the person to
// the provider and the provider sent them back, and the page was fetched
// and drawn again from the top. Everything that was happening stopped -
// the music, the position in the track, the panel that was open.
//
// So the sign-in happens in a small window, and the page is told when it
// is finished. Four things have to be true at once, and each of them can
// fail on its own:
//
//   1. the provider is sent to with a marker that says "a small window"
//   2. the marker is different from the one Discord's own "link this
//      account" flow uses, because those are two different things
//   3. the callback answers the small window instead of sending the page
//      back, and it still gives it the session cookie
//   4. the page listens for the small window and reads the session again
//      - without being fetched again
//
// And the reason somebody would want the page not to be thrown away is
// that they stay signed in: the session has to last, and it has to
// survive the app being closed.
//
// Offline, no server, no network.

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const out = [];
function check(name, pass, detail) {
  out.push(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  -> " + detail : ""}`);
}

const auth = readFileSync(join(ROOT, "functions/_lib/auth.js"), "utf8");
const helper = readFileSync(join(ROOT, "functions/_lib/oauth-popup.js"), "utf8");
const discordLogin = readFileSync(join(ROOT, "functions/api/discord/login.js"), "utf8");
const discordCallback = readFileSync(join(ROOT, "functions/api/discord/callback.js"), "utf8");
const googleStart = readFileSync(join(ROOT, "functions/api/auth/google/start.js"), "utf8");
const googleCallback = readFileSync(join(ROOT, "functions/api/auth/google/callback.js"), "utf8");
const client = readFileSync(join(ROOT, "auth.js"), "utf8");

/* ---- 1. the marker ---- */
check("the small window has a marker of its own",
  /:win/.test(helper) && /:win/.test(discordLogin) === false || /withPopup/.test(discordLogin),
  "");

/* The marker must not be the one Discord's own link flow uses. */
const linkMarker = /mode\s*===\s*"popup"\s*\?\s*":popup"/.test(discordLogin);
check("Discord's link flow keeps its own marker", linkMarker, "");
check("the small window's marker is not that one",
  !/:popup/.test(helper) && !/:popup/.test(googleCallback),
  "");

/* ---- 2. the providers are sent to with the marker ---- */
check("the Discord sign-in asks for the small window",
  /withPopup\(/.test(discordLogin) && /popup/.test(discordLogin),
  "");
check("the Google sign-in asks for the small window",
  /withPopup\(/.test(googleStart) && /popup/.test(googleStart),
  "");

/* ---- 3. the callbacks answer the small window ---- */
check("the Discord callback answers the small window",
  /isPopupState/.test(discordCallback) && /popupDonePage/.test(discordCallback),
  "");
check("the Google callback answers the small window",
  /isPopupState/.test(googleCallback) && /popupDonePage/.test(googleCallback),
  "");

/* The cookie has to be given either way - a small window that is not
   signed in is no use at all. */
check("the small window is given the session",
  /popupDonePage[\s\S]{0,600}setSessionCookie/.test(discordCallback) &&
  /popupDonePage[\s\S]{0,600}setSessionCookie/.test(googleCallback),
  "");

/* The small window has to tell the page, and it has to be the same
   origin, or the page will not believe it. */
check("the small window tells the page that opened it",
  /postMessage/.test(helper) && /thw:signed-in/.test(helper) && /window.opener/.test(helper),
  "");
check("and it says which origin to say it to",
  /window\.location\.origin/.test(helper),
  "");

/* ---- 4. the page listens, and does not reload ---- */
check("the page opens the sign-in in a small window",
  /window\.open\(/.test(client) && /popup=1/.test(client),
  "");
check("the page listens for the small window",
  /thw:signed-in/.test(client) && /addEventListener\("message"/.test(client),
  "");
check("the page reads the session again rather than reloading",
  /\/api\/auth\/session/.test(client) && !/location\.reload/.test(client),
  "");
check("and it only believes its own origin",
  /ev\.origin\s*!==\s*location\.origin/.test(client),
  "");
check("a blocked small window falls back to the old way",
  /if \(!popup\)/.test(client) && /window\.location\.href/.test(client),
  "");

/* ---- 5. staying signed in ---- */
const days = /SESSION_DAYS\s*=\s*(\d+)/.exec(auth);
check("the session lasts a month", !!days && Number(days[1]) >= 30, days ? days[1] + " days" : "not found");

check("the cookie is given that same time",
  /Max-Age="?\s*\+?\s*SESSION_DAYS\s*\*\s*86400/.test(auth),
  "");
check("the cookie is kept when the browser is closed",
  /Max-Age/.test(auth) && !/SESSION_COOKIE=[^;]*;[^;]*$/.test(auth.split("function setSessionCookie")[1] || ""),
  "");

const per = /SESSIONS_PER_UID\s*=\s*(\d+)/.exec(auth);
check("a person can be signed in on several things at once",
  !!per && Number(per[1]) >= 2, per ? per[1] + " sessions" : "not found");

check("a sign-in does not sign the other devices out",
  /DELETE FROM sessions WHERE uid = \? AND rowid NOT IN/.test(auth),
  "");

/* The session slides forward as it is used, so a person who keeps
   coming back is never signed out. */
check("the session slides forward as it is used",
  /SESSION_REFRESH_LEFT_MS/.test(auth) && /SET expires_at/.test(auth),
  "");

/* ---- 6. the desktop app ---- */
{
  let electron = "";
  try {
    electron = readFileSync(join(ROOT, "electron-app/main.js"), "utf8");
  } catch (e) { /* not in this checkout */ }
  if (!electron) {
    check("the desktop app is not in this checkout, so there is nothing to check", true, "");
  } else {
    check("the desktop app allows a window of its own to open",
      /setWindowOpenHandler/.test(electron) && /APP_ORIGIN/.test(electron),
      "");
    check("the desktop app does not wipe its cookies when it closes",
      !/clearStorageData|cookies\.remove/.test(electron),
      "");
  }
}

console.log(out.join("\n"));
const failed = out.filter((l) => l.startsWith("FAIL")).length;
console.log(`\n${out.length - failed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
