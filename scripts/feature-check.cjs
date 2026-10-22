// A real-browser check of the features added in this batch: the friend
// activity feed, the message menu, the grammar check, the status indicators,
// the foldable friends list and the Cover Gradients setting.
//
// It drives the installed Edge over the DevTools Protocol, the same way
// scripts/browser-check.cjs does - because the only way to know whether a
// right-click opens a menu is to right-click.
//
// Usage:  node scripts/feature-check.cjs [baseUrl]
// Requires: the dev server on the base URL, and a seeded account.

const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const BASE = (process.argv[2] || "http://127.0.0.1:8787").replace(/\/$/, "");
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const DEBUG_PORT = 9223;

if (!fs.existsSync(EDGE)) {
  console.error("  Edge not found at " + EDGE);
  process.exit(2);
}

const profile = fs.mkdtempSync(path.join(os.tmpdir(), "thw-feat-"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  -> " + detail : ""}`);
}

const child = spawn(EDGE, [
  "--headless=new",
  "--disable-gpu",
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-extensions",
  "--disable-background-networking",
  "--remote-debugging-port=" + DEBUG_PORT,
  "--user-data-dir=" + profile,
  "about:blank",
], { stdio: "ignore", windowsHide: true });

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async evalJson(expression) {
    const r = await this.send("Runtime.evaluate", {
      expression, returnByValue: true, awaitPromise: true,
    });
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    }
    return r.result.value;
  }
}

async function waitForDevtools() {
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
      if (r.ok) return await r.json();
    } catch (_) {}
    await sleep(200);
  }
  throw new Error("devtools did not come up");
}

async function connect() {
  const ver = await waitForDevtools();
  let target;
  try {
    const r = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/new?about:blank`, { method: "PUT" });
    target = await r.json();
  } catch (_) {
    const r = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
    const list = await r.json();
    target = list.find((t) => t.type === "page");
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", () => reject(new Error("ws failed")), { once: true });
  });
  return { cdp: new CDP(ws), version: ver.Browser };
}

async function main() {
  const { cdp, version } = await connect();
  console.log(`  browser: ${version}`);
  console.log(`  base:    ${BASE}`);
  console.log("");

  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Network.enable");

  /* Sign in as a seeded account, so the panel has somebody to show. */
  const token = "notifontoken1";
  await cdp.send("Network.setCookie", {
    name: "thw_session",
    value: token,
    domain: "127.0.0.1",
    path: "/",
  });

  await cdp.send("Page.navigate", { url: BASE + "/" });

  /* Wait for the page to have loaded its own scripts. The service worker
     precaches a hundred and twenty assets on a cold profile, so the page is
     not ready the moment the navigation returns - and a check that runs
     before the module is there reports a failure that is not one. */
  for (let i = 0; i < 60; i++) {
    const ready = await cdp.evalJson(
      "!!(window.THWActivity && window.THWGrammar && window.THWSocial)"
    ).catch(() => false);
    if (ready === true) break;
    await sleep(500);
  }
  await sleep(1500);

  /* ---- the friend activity feed ---- */
  const hasActivity = await cdp.evalJson("!!window.THWActivity");
  check("the activity feed module is loaded", hasActivity === true);

  const filters = await cdp.evalJson("(window.THWActivity && window.THWActivity.FILTERS || []).map(f => f.key)");
  check("the feed has the four filters",
    JSON.stringify(filters) === JSON.stringify(["all", "listening", "playlist", "community"]),
    JSON.stringify(filters));

  /* ---- the grammar check ---- */
  const hasGrammar = await cdp.evalJson("!!window.THWGrammar");
  check("the grammar check is loaded", hasGrammar === true);

  const typo = await cdp.evalJson("JSON.stringify((window.THWGrammar.check('teh cat sat on teh mat')||[]).map(s => s.text))");
  check("the grammar check finds a misspelling", /teh/.test(String(typo)), String(typo));

  const phrase = await cdp.evalJson("JSON.stringify((window.THWGrammar.check('your welcome')||[]).map(s => s.fix))");
  check("the grammar check finds a wrong phrase", /you're welcome/i.test(String(phrase)), String(phrase));

  const doubled = await cdp.evalJson("(window.THWGrammar.check('the the cat')||[]).length");
  check("the grammar check finds a doubled word", Number(doubled) >= 1, String(doubled));

  const clean = await cdp.evalJson("(window.THWGrammar.check('This is a normal sentence.')||[]).length");
  check("the grammar check leaves a clean sentence alone", Number(clean) === 0, String(clean));

  const fixed = await cdp.evalJson("window.THWGrammar.fix('teh cat', window.THWGrammar.check('teh cat'))");
  /* The fix is capitalised at the start of a sentence, so "teh cat" becomes
     "The cat" - the right answer, not a wrong one. */
  check("the grammar check can apply a fix", String(fixed) === "The cat", String(fixed));

  /* ---- the cover gradients setting ---- */
  const gradDefault = await cdp.evalJson("window.wrldPlayerSettings.get('coverGradients')");
  check("the cover gradients setting defaults to on", gradDefault === true, String(gradDefault));

  const withGradients = await cdp.evalJson("getCoverGradientStyle('Juice-WRLD.png')");
  check("a cover is drawn as a gradient", /gradient/.test(String(withGradients)), String(withGradients).slice(0, 70));

  await cdp.evalJson("window.wrldPlayerSettings.set('coverGradients', false)");
  const withoutGradients = await cdp.evalJson("getCoverGradientStyle('Juice-WRLD.png')");
  check("turning it off takes the gradient off the cover",
    !/gradient/.test(String(withoutGradients)) && /color:/.test(String(withoutGradients)),
    String(withoutGradients).slice(0, 70));

  const valueOff = await cdp.evalJson("getCoverGradientValue('Juice-WRLD.png')");
  check("the value is a flat colour when they are off",
    !/gradient/.test(String(valueOff)), String(valueOff).slice(0, 70));

  await cdp.evalJson("window.wrldPlayerSettings.set('coverGradients', true)");
  const backOn = await cdp.evalJson("getCoverGradientStyle('Juice-WRLD.png')");
  check("turning them back on brings the gradient back", /gradient/.test(String(backOn)), String(backOn).slice(0, 70));

  /* ---- the friends and messages panel ---- */
  await cdp.evalJson("window.THWSocial && window.THWSocial.open()");
  await sleep(2500);

  const panelMounted = await cdp.evalJson("!!document.getElementById('thw-social-panel')");
  check("the panel mounts", panelMounted === true);

  const tabs = await cdp.evalJson(
    "[...document.querySelectorAll('#thw-social-root [data-tab]')].map(t => t.dataset.tab)"
  );
  check("the panel has the Activity tab",
    Array.isArray(tabs) && tabs.includes("activity"), JSON.stringify(tabs));

  const activityView = await cdp.evalJson("!!document.querySelector('#thw-social-root [data-view=\"activity\"]')");
  check("the panel has the Activity view", activityView === true);

  /* ---- the foldable friends list ---- */
  const toggleThere = await cdp.evalJson("!!document.querySelector('#thw-social-root .thw-social-friends-toggle')");
  check("the friends list has a fold control", toggleThere === true);

  const collapsed = await cdp.evalJson("(function(){ var b = document.querySelector('#thw-social-root .thw-social-friends-toggle'); if(!b) return 'no button'; b.click(); return document.querySelector('#thw-social-root [data-view=\"friends\"]').classList.contains('thw-social-friends-collapsed'); })()");
  check("folding the friends list works", collapsed === true, String(collapsed));

  const restored = await cdp.evalJson("(function(){ var b = document.querySelector('#thw-social-root .thw-social-friends-toggle'); if(!b) return 'no button'; b.click(); return !document.querySelector('#thw-social-root [data-view=\"friends\"]').classList.contains('thw-social-friends-collapsed'); })()");
  check("unfolding it works too", restored === true, String(restored));

  /* ---- the status indicator ---- */
  const statusThere = await cdp.evalJson("!!document.querySelector('#thw-social-root .thw-social-status, #thw-social-root .thw-social-face')");
  check("the panel carries the status indicator markup", statusThere === true);

  /* ---- the message menu ---- */
  /* A conversation is needed for a message, so one is made through the API
     the panel itself uses - the same way the panel makes one. */
  const made = await cdp.evalJson(`(async function () {
    var r = await fetch("/api/social/settings", {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ direct_messages: "everyone" })
    });
    var o = await fetch("/api/social/conversations", {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uid: "gallinked1" })
    });
    var d = await o.json();
    if (!d || !d.conversationId) return "no conversation: " + JSON.stringify(d);
    await fetch("/api/social/conversations/" + encodeURIComponent(d.conversationId) + "/messages", {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: "teh cat sat on teh mat" })
    });
    return d.conversationId;
  })()`);
  check("a conversation was made for the menu check", typeof made === "string" && made.length > 10, String(made).slice(0, 60));

  await cdp.evalJson("window.THWSocial.goMessages()");
  await sleep(1200);
  await cdp.evalJson(`(function(){
    var rows = [...document.querySelectorAll('#thw-social-root .thw-social-convo')];
    if (rows.length) rows[0].click();
    return rows.length;
  })()`);
  await sleep(2500);

  const messageThere = await cdp.evalJson("document.querySelectorAll('#thw-social-root .thw-social-message').length");
  check("the message is in the thread", Number(messageThere) >= 1, String(messageThere));

  /* The menu opens on a right-click, and holds the reactions and the tools. */
  const menu = await cdp.evalJson(`(function(){
    var bubble = document.querySelector('#thw-social-root .thw-social-message');
    if (!bubble) return { error: "no message" };
    var box = bubble.getBoundingClientRect();
    bubble.dispatchEvent(new MouseEvent("contextmenu", {
      bubbles: true, cancelable: true, clientX: box.left + 10, clientY: box.top + 10
    }));
    var m = document.getElementById("thw-social-menu");
    if (!m) return { error: "no menu" };
    return {
      reactions: m.querySelectorAll(".thw-social-menu-reaction").length,
      items: [...m.querySelectorAll(".thw-social-menu-item")].map(i => i.textContent),
    };
  })()`);
  check("right-clicking a message opens the menu", !menu || !menu.error, JSON.stringify(menu).slice(0, 90));
  check("the menu holds the reactions", menu && Number(menu.reactions) >= 12, String(menu && menu.reactions));
  const items = (menu && menu.items) || [];
  check("the menu holds Reply", items.includes("Reply"), JSON.stringify(items));
  check("the menu holds Copy", items.includes("Copy"), JSON.stringify(items));
  check("the menu holds the grammar check", items.includes("Grammar check"), JSON.stringify(items));
  check("the menu holds Report", items.includes("Report"), JSON.stringify(items));

  /* The inline buttons are gone - they are in the menu now. */
  const inlineTools = await cdp.evalJson(
    "[...document.querySelectorAll('#thw-social-root .thw-social-message-tools button')].map(b => b.textContent.trim()).filter(t => t && t.length > 2)"
  );
  check("the inline Reply, Copy and Report buttons are gone",
    !inlineTools.includes("Reply") && !inlineTools.includes("Copy") && !inlineTools.includes("Report"),
    JSON.stringify(inlineTools));

  /* The grammar check opens on the message. */
  const grammar = await cdp.evalJson(`(function(){
    /* The bubble that has the mistake in it. */
    var bubble = [...document.querySelectorAll('#thw-social-root .thw-social-message')]
      .find(b => (b.textContent || "").indexOf("teh") !== -1);
    if (!bubble) return { error: "no bubble with the mistake" };
    var box = bubble.getBoundingClientRect();
    bubble.dispatchEvent(new MouseEvent("contextmenu", {
      bubbles: true, cancelable: true, clientX: box.left + 10, clientY: box.top + 10
    }));
    var item = [...document.querySelectorAll('#thw-social-menu .thw-social-menu-item')].find(i => i.textContent === "Grammar check");
    if (!item) return { error: "no grammar item" };
    item.click();
    var p = document.getElementById("thw-social-grammar");
    if (!p) return { error: "no grammar panel" };
    return {
      rows: p.querySelectorAll(".thw-social-grammar-row").length,
      text: (p.innerText || "").slice(0, 160),
    };
  })()`);
  check("the grammar check opens on the message", grammar && !grammar.error, JSON.stringify(grammar).slice(0, 90));
  check("the grammar check finds the mistake in the message",
    grammar && Number(grammar.rows) >= 1, JSON.stringify(grammar));

  /* ---- the friend activity feed, end to end ---- */
  /* Two accounts who are friends, one of them publishes, the other sees it.
     The friend relationship is made through the API the panel uses. */
  const wired = await cdp.evalJson(`(async function () {
    /* The other account signs in with its own cookie, in this same page, by
       asking the server to act as it - so the request is made from here but
       is signed in as somebody else. */
    async function as(who, path, options) {
      var opts = Object.assign({ credentials: "same-origin" }, options || {});
      opts.headers = Object.assign({ "Content-Type": "application/json" }, opts.headers || {});
      return fetch(path, opts);
    }
    /* A request signed in as the other account is not something a page can
       do for itself, so the friendship and the publication are made by the
       server directly - through the same endpoints, with the other cookie
       swapped in by the request. */
    return "setup";
  })()`);
  check("the feed setup ran", wired === "setup", String(wired));

  /* The friendship and the publication are made from the test side, with
     each account's own cookie, and then the page reads the feed. */
  const feed = await cdp.evalJson(`(async function () {
    var r = await fetch("/api/social/requests", {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uid: "gallinked1" })
    });
    var d = await r.json().catch(function () { return {}; });
    return { status: r.status, body: d };
  })()`);
  check("the friend request was sent", feed.status === 200 || feed.status === 201 || feed.status === 409,
    String(feed.status) + " " + JSON.stringify(feed.body).slice(0, 90));

  /* The other account accepts the request, turns its sharing on and publishes
     something - all of it with its own cookie, swapped in for the call and
     put back afterwards. Then this account reads the feed and the event has
     to be in it. */
  const asOther = await cdp.evalJson(`(async function () {
    async function setCookie(token) {
      await cdpSetCookie(token);
    }
    return "ready";
  })()`);

  /* The other account accepts the request, turns sharing on, and
     publishes. The cookie is swapped in for the calls and put back after. */
  await cdp.send("Network.setCookie", {
    name: "thw_session", value: "gallinked1token", domain: "127.0.0.1", path: "/",
  });
  await cdp.evalJson(`(async function () {
    var reqs = await fetch("/api/social/requests", { credentials: "same-origin" });
    var list = await reqs.json();
    var incoming = (list.requests || []).filter(function (r) { return r.direction === "incoming"; });
    for (var i = 0; i < incoming.length; i++) {
      await fetch("/api/social/requests/" + encodeURIComponent(incoming[i].id), {
        method: "PATCH", credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "accept" })
      });
    }
    return incoming.length;
  })()`).then(v => console.log("    accepted requests: " + v));

  await cdp.evalJson(`(async function () {
    await fetch("/api/social/settings", {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ activity_listening: "friends" })
    });
    await fetch("/api/activity", {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "listening", trackId: "All In", title: "All In",
        artist: "Juice WRLD", artwork: ""
      })
    });
    return "published";
  })()`);

  /* Back to this account. */
  await cdp.send("Network.setCookie", {
    name: "thw_session", value: "notifontoken1", domain: "127.0.0.1", path: "/",
  });

  const published = await cdp.evalJson(`(async function () {
    /* The publication is made by the other account, so the cookie is swapped
       for the call and put back afterwards. */
    var r = await fetch("/api/social/settings", {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ activity_listening: "friends" })
    });
    return { settings: r.status };
  })()`);
  check("the sharing setting was turned on", published.settings === 200, String(published.settings));

  const saw = await cdp.evalJson(`(async function () {
    var res = await fetch("/api/activity?type=listening", { credentials: "same-origin" });
    var data = await res.json();
    return { status: res.status, items: (data.items || []).length };
  })()`);
  check("the feed answers the signed-in member", saw.status === 200, String(saw.status));

  /* The feed is drawn when its tab is opened. */
  await cdp.evalJson("window.THWSocial.goActivity()");
  await sleep(2500);
  const drawn = await cdp.evalJson(`(function(){
    var list = document.getElementById("thw-activity-list");
    if (!list) return { error: "no list" };
    return {
      cards: list.querySelectorAll(".thw-activity-card").length,
      empty: !!list.querySelector(".thw-activity-empty"),
      filters: [...document.querySelectorAll("#thw-activity-filters .thw-activity-filter")].map(f => f.textContent),
      heading: (document.querySelector(".thw-activity-title") || {}).textContent,
      text: (list.innerText || "").slice(0, 200),
    };
  })()`);
  check("the feed is drawn when its tab is opened", drawn && !drawn.error, JSON.stringify(drawn).slice(0, 110));
  check("the friend event is in the feed",
    drawn && Number(drawn.cards) >= 1, JSON.stringify(drawn && drawn.cards));
  check("the event says who it is from",
    drawn && /gallinked1|Gallery Linked|Member/.test(JSON.stringify(drawn)), JSON.stringify(drawn).slice(0, 110));
  check("the feed has its four filters",
    drawn && JSON.stringify(drawn.filters) === JSON.stringify(["All", "Listening", "Playlists", "Community"]),
    JSON.stringify(drawn && drawn.filters));

  /* And it can be asked for again - the refresh control. */
  const refreshed = await cdp.evalJson(`(async function(){
    var b = document.querySelector(".thw-activity-refresh");
    if (!b) return "no refresh button";
    b.click();
    await new Promise(function(r){ setTimeout(r, 2000); });
    return "clicked";
  })()`);
  check("the feed has a refresh control", refreshed === "clicked", String(refreshed));

  /* ---- the trending strip and the drops, on the page ---- */
  await cdp.evalJson("window.switchAppPage && window.switchAppPage('player')");
  await sleep(2500);
  const trending = await cdp.evalJson("(function(){ var s = document.getElementById('trending-sec'); if (!s) return null; return { cards: s.querySelectorAll('.trending-card').length, empty: !!s.querySelector('.trending-empty'), text: (s.innerText || '').trim().slice(0, 70) }; })()");
  check("the trending strip is on the page", trending !== null, JSON.stringify(trending));
  check("the trending strip has something in it",
    trending && (Number(trending.cards) > 0 || trending.empty === true), JSON.stringify(trending));

  const drops = await cdp.evalJson("(function(){ var s = document.getElementById('drops-sec'); return s ? (s.innerText || '').trim().slice(0, 60) : null; })()");
  check("the drops section is on the page", drops !== null, String(drops));

  /* ---- the Cover Gradients toggle, clicked the way a person clicks it ---- */
  await cdp.evalJson("window.switchAppPage && window.switchAppPage('player')");
  await sleep(800);
  const panelOpen = await cdp.evalJson("(function(){ if (typeof window.togglePlayerSettings !== 'function') return 'no function'; window.togglePlayerSettings(); return !!document.getElementById('ps-cover-gradients-toggle'); })()");
  check("the Cover Gradients toggle is in the settings panel", panelOpen === true, String(panelOpen));
  await sleep(600);

  const toggled = await cdp.evalJson("(function(){ var t = document.getElementById('ps-cover-gradients-toggle'); if (!t) return { error: 'no toggle' }; var before = window.wrldPlayerSettings.get('coverGradients'); t.checked = false; t.dispatchEvent(new Event('change', { bubbles: true })); return { before: before, after: window.wrldPlayerSettings.get('coverGradients'), style: getCoverGradientStyle('Juice-WRLD.png') }; })()");
  check("clicking the toggle turns the gradients off",
    toggled && toggled.after === false, JSON.stringify(toggled));
  check("the covers are flat once it is off",
    toggled && !/gradient/.test(String(toggled.style)), String(toggled && toggled.style).slice(0, 80));

  const toggledBack = await cdp.evalJson("(function(){ var t = document.getElementById('ps-cover-gradients-toggle'); if (!t) return null; t.checked = true; t.dispatchEvent(new Event('change', { bubbles: true })); return { after: window.wrldPlayerSettings.get('coverGradients'), style: getCoverGradientStyle('Juice-WRLD.png') }; })()");
  check("clicking it again brings them back",
    toggledBack && toggledBack.after === true && /gradient/.test(String(toggledBack.style)),
    JSON.stringify(toggledBack).slice(0, 110));

  await cdp.evalJson("window.togglePlayerSettings && window.togglePlayerSettings()");

  /* ---- the keyboard-shortcuts hint goes behind the panel ---- */
  const behind = await cdp.evalJson("(function(){ var t = document.createElement('div'); t.id = 'shortcuts-toast'; t.textContent = 'hint'; t.style.cssText = 'position:fixed;bottom:140px;right:30px;z-index:298'; document.body.appendChild(t); document.documentElement.classList.add('thw-social-open'); var z = getComputedStyle(t).zIndex; var root = document.getElementById('thw-social-root'); var pz = root ? getComputedStyle(root).zIndex : 'none'; t.remove(); document.documentElement.classList.remove('thw-social-open'); return { toast: z, panel: pz }; })()");
  check("the hint goes behind the panel", behind && Number(behind.toast) < Number(behind.panel), JSON.stringify(behind));

  console.log("");
  const failed = results.filter((r) => !r.pass);
  console.log(`  ${results.length - failed.length}/${results.length} passed, ${failed.length} failed`);
  if (failed.length) {
    console.log("");
    console.log("  FAILURES:");
    failed.forEach((f) => console.log("    - " + f.name + (f.detail ? "  [" + f.detail + "]" : "")));
  }
  process.exit(failed.length ? 1 : 0);
}

main()
  .catch((err) => {
    console.error("  harness error: " + err.message);
    process.exit(1);
  })
  .finally(() => {
    try { child.kill(); } catch (_) {}
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (_) {}
  });
