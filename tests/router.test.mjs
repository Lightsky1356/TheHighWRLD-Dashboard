// Behavioural test for router.js, run against a stubbed browser environment.
//
// WHY THIS IS A vm AND NOT A BROWSER TEST
// The routing behaviour - boot redirect, pushState, popstate - is the part most
// likely to be wrong and the part a static check cannot see at all. parse-gate
// proves the route table names real sections and that the file parses; it cannot
// prove that /partner actually lands on the partnership page.
//
// router.js is a plain script whose only globals are window, location, history,
// setTimeout and console, so it runs unmodified inside a vm context with those
// five replaced. That keeps the test honest: the file under test is the shipped
// file, loaded and executed as written, not a reimplementation of it.
//
// The one behaviour worth calling out is the timer. router.js clears its boot flag
// from a setTimeout(0) registered after script.js registers its own boot
// setTimeout(0), relying on equal-delay timers firing in registration order. Here
// the timers are a queue the test drains explicitly, so that ordering is asserted
// rather than assumed.

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = readFileSync(join(ROOT, "router.js"), "utf8");

const out = [];
function check(name, pass, detail) {
  out.push(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  -> " + detail : ""}`);
}

/* A window whose timers are drained on demand, so boot ordering is observable. */
function boot(pathname, opts = {}) {
  const pushed = [];
  const popListeners = [];
  let timers = [];

  const location = { pathname };

  const win = {
    // Stands in for the switchAppPage funnel script.js installs, including the
    // mobile-nav wrapper it adds. All the test cares about is that the router
    // calls through to it rather than touching the DOM itself.
    __calls: [],
    switchAppPage(page) {
      win.__calls.push(page);
    },
    addEventListener(type, fn) {
      if (type === "popstate") popListeners.push(fn);
    },
  };
  win.window = win;

  const history = {
    pushState(_state, _title, url) {
      pushed.push(url);
      location.pathname = url;
    },
  };

  const context = {
    window: win,
    location,
    history,
    console: { warn() {}, log() {}, error() {} },
    setTimeout(fn) {
      timers.push(fn);
      return timers.length;
    },
    clearTimeout() {},
    // Needed so a failing test surfaces as an exception rather than a hang.
    Map,
    Set,
    String,
    Object,
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(SRC, context, { filename: "router.js" });

  return {
    win,
    pushed,
    location,
    pop() {
      for (const fn of popListeners) fn();
    },
    runTimers() {
      const queue = timers;
      timers = [];
      for (const fn of queue) fn();
    },
    pendingTimers: () => timers.length,
  };
}

/* ---- boot: a deep link must win over the hard-coded "home" ---- */
{
  const t = boot("/partner");
  check("booting on /partner issues no history entry", t.pushed.length === 0, `pushed=${JSON.stringify(t.pushed)}`);
  t.win.switchAppPage("home"); // exactly what script.js's boot does
  check("boot's switchAppPage(\"home\") resolves to the routed page", t.win.__calls[0] === "partner", `called=${JSON.stringify(t.win.__calls)}`);
  check("the route exists on window for debugging", typeof t.win.__thwRouter === "object" && t.win.__thwRouter.PATHS.size === 2);
  check("a timer is queued to clear the boot flag", t.pendingTimers() === 1);
}
{
  const t = boot("/");
  t.win.switchAppPage("home");
  check("booting on / still lands on home", t.win.__calls[0] === "home", `called=${JSON.stringify(t.win.__calls)}`);
}
{
  const t = boot("/nosuchroute");
  t.win.switchAppPage("home");
  check("an unknown path falls back to home", t.win.__calls[0] === "home", `called=${JSON.stringify(t.win.__calls)}`);
}
{
  const t = boot("/About/");
  t.win.switchAppPage("home");
  check("path matching ignores case and a trailing slash", t.win.__calls[0] === "about", `called=${JSON.stringify(t.win.__calls)}`);
}
{
  const t = boot("/about-us");
  t.win.switchAppPage("home");
  check("a longer path sharing a prefix is not treated as the route", t.win.__calls[0] === "home", `called=${JSON.stringify(t.win.__calls)}`);
}

/* ---- navigation after boot ---- */
{
  const t = boot("/");
  t.win.switchAppPage("home");
  t.runTimers();

  t.win.switchAppPage("about");
  check("navigating to About pushes /about", t.pushed[0] === "/about", `pushed=${JSON.stringify(t.pushed)}`);
  check("and still calls through to the original switchAppPage", t.win.__calls[t.win.__calls.length - 1] === "about");

  t.win.switchAppPage("about");
  check("re-entering About does not stack history entries", t.pushed.length === 1, `pushed=${JSON.stringify(t.pushed)}`);

  t.win.switchAppPage("partner");
  check("navigating to Partnership pushes /partner", t.pushed[1] === "/partner", `pushed=${JSON.stringify(t.pushed)}`);

  t.win.switchAppPage("home");
  check("an unrouted page leaves the URL alone", t.pushed.length === 2 && t.location.pathname === "/partner", `path=${t.location.pathname} pushed=${JSON.stringify(t.pushed)}`);

  t.win.switchAppPage("tos");
  check("a transient page like ToS leaves the URL alone", t.pushed.length === 2);
}

/* ---- back and forward ---- */
{
  const t = boot("/");
  t.win.switchAppPage("home");
  t.runTimers();
  t.win.switchAppPage("about");
  t.win.switchAppPage("partner");
  check("two entries pushed before going back", t.pushed.length === 2);

  t.location.pathname = "/about";
  t.pop();
  check("back to /about shows About", t.win.__calls[t.win.__calls.length - 1] === "about", `called=${JSON.stringify(t.win.__calls)}`);
  check("back does not push a new entry", t.pushed.length === 2, `pushed=${JSON.stringify(t.pushed)}`);

  t.location.pathname = "/";
  t.pop();
  check("back to / shows home", t.win.__calls[t.win.__calls.length - 1] === "home");
}

/* ---- robustness ---- */
{
  const t = boot("/");
  t.win.switchAppPage("home");
  t.runTimers();

  /* switchAppPage is called with values from the DOM and from stored data. A plain
     object route table would answer ROUTES["toString"] with a function, which is
     truthy, and then try to use it as a URL. A Map answers undefined. */
  for (const junk of ["toString", "constructor", "hasOwnProperty", "__proto__", "", null, undefined, 0]) {
    let threw = null;
    try {
      t.win.switchAppPage(junk);
    } catch (e) {
      threw = e;
    }
    check(`page ${JSON.stringify(junk)} does not throw and does not touch the URL`, !threw && t.pushed.length === 0, threw ? threw.message : "");
  }
}
{
  /* If script.js has not run yet there is no funnel to wrap. The router must say
     so rather than install a half-working hook. */
  const win = { __calls: [], addEventListener() {} };
  win.window = win;
  const warnings = [];
  const context = {
    window: win,
    location: { pathname: "/" },
    history: { pushState() {} },
    console: { warn: (m) => warnings.push(m) },
    setTimeout: (fn) => fn,
    Map, Set, String, Object,
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(SRC, context, { filename: "router.js" });
  check("a missing switchAppPage produces one warning, not a broken hook", warnings.length === 1 && /switchAppPage is missing/.test(warnings[0]), JSON.stringify(warnings));
}

/* ---- report ---- */
console.log(out.join("\n"));
const failed = out.filter((l) => l.startsWith("FAIL")).length;
console.log(`\n${out.length - failed}/${out.length} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);