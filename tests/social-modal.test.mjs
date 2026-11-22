// FRIENDS & MESSAGES PANEL - MODAL ONLY WHERE IT IS MODAL
//
// The panel is a full-screen dialog on a phone and a side sheet on a desktop,
// and it used to be treated as modal at every width. Two of the consequences
// were invisible until someone reported that the WRLD Player and the nav "did
// not work" with the panel open:
//
//   - every direct child of <body> was marked inert while the panel was open,
//     so <nav> and <main> - the entire player page - answered no clicks and no
//     keys at any desktop width (91 inert elements)
//   - a capture-phase listener swallowed clicks on the Community trigger, and
//     social.css hid the dropdown outright, so one nav button did nothing but
//     raise a toast telling you to close the panel
//
// The Tab loop and aria-modal were wrong in the same direction: a keyboard user
// was kept inside the sheet while the page beside it stayed fully usable, and
// aria-modal="true" claimed otherwise.
//
// All of it now hangs off one predicate, panelIsModal(), which is the same
// breakpoint social.css uses to switch the panel to full-screen. This test
// checks the wiring rather than the pixels: that the gate exists, that inert
// has exactly one call site and it is gated, that the Tab loop is gated, that
// aria-modal follows, that a resize re-settles it (a rotation must not strand
// an inert <main> on a wide window), and that the desktop-only workarounds
// really are gone.
//
// Offline, no server, no network.

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const js = readFileSync(join(ROOT, "social-panel.js"), "utf8");
const css = readFileSync(join(ROOT, "social.css"), "utf8");

let failures = 0;
const fail = (m) => { console.log("  FAIL  " + m); failures++; };
const ok = (m) => console.log("  PASS  " + m);

const count = (haystack, needle) => haystack.split(needle).length - 1;

/* 1. One predicate, and it is the CSS breakpoint. */
if (!/function panelIsModal\(\)\s*\{[\s\S]{0,160}matchMedia\("\(max-width: 680px\)"/.test(js)) {
  fail("panelIsModal() is missing or no longer reads the (max-width: 680px) breakpoint");
} else {
  ok("panelIsModal() reads the (max-width: 680px) breakpoint");
}

if (!/function panelLocksScroll\(\)\s*\{\s*return panelIsModal\(\);/.test(js)) {
  fail("panelLocksScroll() no longer delegates to panelIsModal() - the scroll lock and the modality gate can drift apart");
} else {
  ok("the scroll lock shares the same predicate");
}

/* The two files must agree on where the panel becomes full-screen. */
if (/@media\s*\(\s*max-width:\s*680px\s*\)/.test(css) && /max-width: 680px/.test(js)) {
  ok("social.css and social-panel.js use the same full-screen breakpoint (680px)");
} else {
  fail("social.css and social-panel.js disagree about the 680px breakpoint - the panel could be inerting a background it is not covering");
}

/* 2. inert has one call site and it is gated on modality. */
const inertWrites = count(js, 'setAttribute("inert"');
if (inertWrites !== 1) {
  fail('the inert attribute is set in ' + inertWrites + " places - there must be exactly one, inside setBackgroundInert()");
} else {
  ok("inert is written in exactly one place");
}

const inertCalls = count(js, "setBackgroundInert(");
if (inertCalls !== 2) {
  fail("setBackgroundInert() is called " + (inertCalls - 1) + " times; expected 1, from syncPanelModality() only (a second call site can inert the page without consulting panelIsModal())");
} else {
  ok("setBackgroundInert() has a single call site");
}

/* Messages is now a full page rather than an overlay. The !PAGE_MODE guard is
   deliberate: a page has no background to inert, and inerting <body> there
   freezes the whole site (including the WRLD Log close button). */
if (!/var modal = !PAGE_MODE && !!state\.open && panelIsModal\(\);[\s\S]{0,200}setBackgroundInert\(modal\)/.test(js)) {
  fail("syncPanelModality() no longer gates inert on !PAGE_MODE && state.open && panelIsModal()");
} else {
  ok("inert is applied only to the overlay panel, never to the full-page mode");
}

/* 3. aria-modal follows the same gate rather than sitting true forever. */
if (!/panel\.setAttribute\("aria-modal", modal \? "true" : "false"\)/.test(js)) {
  fail('aria-modal is no longer set from the modality gate - it would claim "true" over a background the reader can walk into');
} else {
  ok("aria-modal is set from the same gate");
}

/* 4. The Tab loop is released where the page is live. */
if (!/if \(event\.key !== "Tab" \|\| !panelIsModal\(\)\) return;/.test(js)) {
  fail('the Tab loop is not gated on panelIsModal() - on desktop a keyboard user cannot Tab out of the sheet to the WRLD Player');
} else {
  ok("Tab is held only while the panel is modal");
}

/* 5. A resize re-settles it: crossing 680px while open must not strand state. */
const resizeBlock = /addEventListener\("resize", function \(\) \{([\s\S]{0,400}?)\}\);/.exec(js);
if (!resizeBlock) {
  fail("no resize listener found - crossing 680px while the panel is open leaves stranded state");
} else {
  const body = resizeBlock[1];
  const missing = ["syncPanelScrollLock()", "syncPanelModality()"].filter((f) => body.indexOf(f) === -1);
  if (missing.length) fail("the resize listener does not re-run " + missing.join(", "));
  else ok("a resize re-settles the scroll lock and the modality gate");
}

/* 6. The desktop workarounds are gone now that the menu can be reached. */
if (css.indexOf("html.thw-social-open .nav-comm-menu") !== -1) {
  fail("social.css still hides the Community dropdown while the panel is open - the nav is missing that button on desktop again");
} else {
  ok("social.css no longer hides the Community dropdown");
}

if (js.indexOf('closest("#page-nav-wanted")') !== -1 || js.indexOf("notifyCommunityMenuBlocked") !== -1) {
  fail('the click interceptor on the Community trigger is still present - it swallows toggleCommMenu() and shows a toast instead');
} else {
  ok("the Community trigger is no longer intercepted");
}

/* The Community dropdown was hidden and neutralised at the owner's request;
   its clearance shim went with it. There must be no half-wired remnants. */
if (js.indexOf("syncCommMenuClearance") !== -1) {
  fail("the removed Community-menu clearance shim is still wired in social-panel.js");
} else {
  ok("the Community dropdown is gone, so no clearance shim is needed");
}

console.log(failures ? "\n  " + failures + " modal-gating problem(s)\n" : "\n  social panel modality: all good\n");
process.exit(failures ? 1 : 0);
