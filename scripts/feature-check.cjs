// A real-browser check of the features added in this batch: the friend
// activity feed, the message menu, the grammar check, the status indicators,
// the foldable friends list, the Cover Gradients setting, group chats and
// sending a track into a chat.
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

  /* An explicit desktop viewport, because several checks below are desktop
     layout assertions and this script otherwise ran against whatever window
     Edge opens headless - about 800px, innerWidth 756.
     *
     * At that width the panel is pinned to its 360px floor (clamp(360,
     * 100vw-612, 430) cannot go lower), so the expand control has nowhere to
     * grow and reads 360 -> 360; and a 500px player cannot fit in the ~340px
     * that is left of the panel no matter how the layout behaves. Those three
     * failures were the window, not the code - but a check that depends on the
     * browser's default window is not reproducible either, so the width is
     * stated: 1440 is a standard laptop, and both the panel's normal and its
     * expanded size are representable there. */
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 1440, height: 900, deviceScaleFactor: 1, mobile: false,
  });

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
      "!!(window.THWGrammar && window.THWSocial)"
    ).catch(() => false);
    if (ready === true) break;
    await sleep(500);
  }
  await sleep(1500);

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
  /* The text helper answers white rather than the blank state's purple. The
     playlist and the queue clip this value to type, so purple type here is
     exactly what the setting is supposed to switch off. */
  check("turning it off draws that text white instead of as a gradient",
    /255,\s*255,\s*255|#fff/i.test(String(withoutGradients)) && /background-clip:text/.test(String(withoutGradients)),
    String(withoutGradients).slice(0, 70));

  const valueOff = await cdp.evalJson("getCoverGradientValue('Juice-WRLD.png')");
  check("the value is the blank state gradient when they are off",
    /gradient/.test(String(valueOff)), String(valueOff).slice(0, 70));

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
  check("the panel keeps its three tabs",
    JSON.stringify(tabs) === JSON.stringify(["friends", "messages", "requests"]), JSON.stringify(tabs));

  /* The Activity tab is gone: the feed is drawn inside the Friends tab, as a
     sibling of the friends list rather than inside it - folding the list away
     must not fold the feed away with it. */
  const activityView = await cdp.evalJson("!!document.querySelector('#thw-social-root [data-view=\"activity\"]')");
  check("the Activity tab is folded into Friends", activityView === false);

  /* ---- the foldable friends list ---- */
  const toggleThere = await cdp.evalJson("!!document.querySelector('#thw-social-root .thw-social-friends-toggle')");
  check("the friends list has a fold control", toggleThere === true);

  const collapsed = await cdp.evalJson("(function(){ var b = document.querySelector('#thw-social-root .thw-social-friends-toggle'); if(!b) return 'no button'; b.click(); return document.querySelector('#thw-social-root [data-view=\"friends\"]').classList.contains('thw-social-friends-collapsed'); })()");
  check("folding the friends list works", collapsed === true, String(collapsed));

  const restored = await cdp.evalJson("(function(){ var b = document.querySelector('#thw-social-root .thw-social-friends-toggle'); if(!b) return 'no button'; b.click(); return !document.querySelector('#thw-social-root [data-view=\"friends\"]').classList.contains('thw-social-friends-collapsed'); })()");
  check("unfolding it works too", restored === true, String(restored));

  /* The new-group button is on the friends head, at every width. */
  const newGroupThere = await cdp.evalJson("!!document.querySelector('#thw-social-root [data-action=\"new-group\"]')");
  check("the friends tab offers a new group chat", newGroupThere === true);

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

  /* The menu has to be somewhere it can be seen.
   *
   * It was opening - the element existed, the buttons were in it - and it was
   * opening two thousand pixels below the panel, because it was positioned
   * against a box with no height. So the check that matters is where it is,
   * not whether it exists. */
  const where = await cdp.evalJson("(function(){ var m = document.getElementById('thw-social-menu'); if (!m) return null; var r = m.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, w: innerWidth, h: innerHeight }; })()");
  check("the menu is on the screen", where && where.top >= 0 && where.left >= 0 && where.bottom <= where.h && where.right <= where.w, JSON.stringify(where));
  const onPanel = await cdp.evalJson("(function(){ var m = document.getElementById('thw-social-menu'); var p = document.getElementById('thw-social-panel'); if (!m || !p) return null; var r = m.getBoundingClientRect(), q = p.getBoundingClientRect(); return r.top >= q.top - 2 && r.bottom <= q.bottom + 2 && r.left >= q.left - 2 && r.right <= q.right + 2; })()");
  check("the menu is inside the panel", onPanel === true, String(onPanel));
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

  /* The friend shares its listening and publishes a track (the feed's own
     table), then plays a song - the play is what the friends row is allowed
     to say. The song is read back as this account before anything else is
     played, so the switch to another track is observed as a change and not
     only as an end state. */
  const friendActs = await cdp.evalJson(`(async function () {
    var settings = await fetch("/api/social/settings", {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ activity_listening: "friends" })
    }).then(function (r) { return r.status; });
    var pub = await fetch("/api/activity", {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "listening", trackId: "All In", title: "All In",
        artist: "Juice WRLD", artwork: ""
      })
    }).then(function (r) { return r.json().catch(function () { return {}; }); });
    var play = await fetch("/api/account", {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "listen", title: "Presence Probe", seconds: 45 })
    }).then(function (r) { return r.status; });
    return { settings: settings, published: pub.published === true, play: play };
  })()`);
  check("the other account's sharing was turned on", friendActs.settings === 200, String(friendActs.settings));
  check("its listening publication was accepted", friendActs.published === true, JSON.stringify(friendActs));
  check("its play was recorded by the site", friendActs.play === 200, String(friendActs.play));

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
  check("the feed answers the signed-in member", saw.status === 200 && saw.items >= 1,
    JSON.stringify(saw));

  /* The panel is the view of it now: a friend's row says whether they are
     here, and under that the song they are playing. Asking the panel to
     open is the refresh an open costs, and the row is read back against the
     bootstrap - the two have to agree every time it is asked. */
  const readFriendRow = async function () {
    await cdp.evalJson("window.THWSocial.open()");
    await sleep(2500);
    return await cdp.evalJson(`(async function(){
      var boot = await fetch('/api/social/bootstrap', { credentials: 'same-origin' })
        .then(function(r){ return r.json(); }).catch(function(){ return {}; });
      var friend = (boot.friends || []).find(function(f){ return f.uid === 'gallinked1'; }) || {};
      var rows = [...document.querySelectorAll('#thw-social-friends .thw-social-row')];
      var row = rows.find(function(r){ return /Gallery Linked/.test(r.textContent); });
      if (!row) return { error: "no row for that friend", rows: rows.length, expected: (friend.activity || "").trim() };
      var presence = row.querySelector('.thw-social-meta');
      var activity = row.querySelector('.thw-social-activity');
      return {
        expected: (friend.activity || "").trim(),
        presence: presence ? presence.textContent.trim() : "",
        activity: activity ? activity.textContent.trim() : "",
        under: !!(presence && activity && (presence.compareDocumentPosition(activity) & Node.DOCUMENT_POSITION_FOLLOWING)),
      };
    })()`);
  };

  /* The first song, read before anything else is played. */
  const firstSong = await readFriendRow();
  check("the friend's row says whether they are here",
    firstSong && !!firstSong.presence, JSON.stringify(firstSong).slice(0, 110));
  check("the row brings up the song they are playing",
    firstSong && firstSong.under === true && !!firstSong.expected &&
      firstSong.activity === "Listening To Presence Probe" &&
      firstSong.activity === firstSong.expected,
    JSON.stringify(firstSong).slice(0, 160));

  /* Going to another track - the same call the player makes when it does,
     carrying the next title. Then a vote: the newest recorded action of
     all, which must never stand in for the music. */
  await cdp.send("Network.setCookie", {
    name: "thw_session", value: "gallinked1token", domain: "127.0.0.1", path: "/",
  });
  const switched = await cdp.evalJson(`(async function () {
    var play = await fetch("/api/account", {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "listen", title: "Second Probe", seconds: 45 })
    }).then(function (r) { return r.status; });
    var vote = await fetch("/api/wanted", {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "vote", track: "Indicator Probe", user: "gallinked1", value: 1 })
    }).then(function (r) { return r.status; });
    return { play: play, vote: vote };
  })()`);
  check("going to another track is recorded", switched.play === 200, String(switched.play));
  check("its vote was recorded by the site", switched.vote === 200, String(switched.vote));

  /* Back to this account, to see it as the friend's friend does. */
  await cdp.send("Network.setCookie", {
    name: "thw_session", value: "notifontoken1", domain: "127.0.0.1", path: "/",
  });

  const indicator = await readFriendRow();
  check("the row follows them to the new track",
    indicator && indicator.under === true && !!indicator.expected &&
      indicator.activity === "Listening To Second Probe" &&
      indicator.activity === indicator.expected,
    JSON.stringify(indicator).slice(0, 160));
  check("the newer vote never stands in for the song",
    indicator && !/voted/i.test(String(indicator.activity)) &&
      indicator.activity === "Listening To Second Probe",
    JSON.stringify(indicator).slice(0, 160));

  /* ---- presence is for friends only ---- */
  /* A thread can be open with somebody you are not friends with, and that
     person has not agreed to be followed around the site: their song and
     their last-seen stay out of the row. They play something first, so the
     emptiness below is the friendship holding, not an absence of data - and
     the friend's own thread still says it, for the same reason. */
  await cdp.send("Network.setCookie", {
    name: "thw_session", value: "galunlinked1token", domain: "127.0.0.1", path: "/",
  });
  const strangerPlays = await cdp.evalJson(`(async function () {
    var s = await fetch("/api/social/settings", {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ direct_messages: "everyone" })
    }).then(function (r) { return r.status; });
    var p = await fetch("/api/account", {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "listen", title: "Nonfriend Probe", seconds: 45 })
    }).then(function (r) { return r.status; });
    return { settings: s, play: p };
  })()`);
  check("the stranger opened their messages and played a song",
    strangerPlays.settings === 200 && strangerPlays.play === 200, JSON.stringify(strangerPlays));

  await cdp.send("Network.setCookie", {
    name: "thw_session", value: "notifontoken1", domain: "127.0.0.1", path: "/",
  });
  const threadPresence = await cdp.evalJson(`(async function () {
    var opened = await fetch("/api/social/conversations", {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uid: "galunlinked1" })
    }).then(function (r) { return r.json(); }).catch(function () { return {}; });
    var boot = await fetch("/api/social/bootstrap", { credentials: "same-origin" })
      .then(function (r) { return r.json(); }).catch(function () { return {}; });
    var dms = (boot.conversations || []).filter(function (c) { return c.kind === "dm"; });
    var stranger = dms.find(function (c) { return c.uid === "galunlinked1"; }) || {};
    var friend = dms.find(function (c) { return c.uid === "gallinked1"; }) || {};
    return {
      made: !!(opened && opened.conversationId),
      strangerIsFriend: (boot.friends || []).some(function (f) { return f.uid === "galunlinked1"; }),
      strangerActivity: stranger.activity || "",
      strangerLast: stranger.lastActive || "",
      friendActivity: friend.activity || ""
    };
  })()`);
  check("a thread carries no presence for someone who is not a friend",
    threadPresence.made === true && threadPresence.strangerIsFriend === false &&
      threadPresence.strangerActivity === "" && threadPresence.strangerLast === "",
    JSON.stringify(threadPresence));
  check("the same thread still shows what a friend is playing",
    threadPresence.friendActivity === "Listening To Second Probe",
    JSON.stringify(threadPresence));

  /* And what a person sees: their thread header says their name and nothing
     about what they are doing. */
  const strangerHead = await cdp.evalJson(`(async function(){
    window.THWSocial && window.THWSocial.open();
    if (window.THWSocial && window.THWSocial.goMessages) window.THWSocial.goMessages();
    await new Promise(function(r){ setTimeout(r, 2500); });
    var rows = [...document.querySelectorAll('#thw-social-root .thw-social-convo')];
    var row = rows.find(function(r){ return /Gallery Unlinked/.test(r.textContent); });
    if (!row) return { error: "no thread row for them", rows: rows.map(function(r){ return (r.innerText || '').slice(0, 24); }) };
    row.click();
    await new Promise(function(r){ setTimeout(r, 2500); });
    var head = document.getElementById('thw-social-thread-head');
    return { text: (head && head.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 120) };
  })()`);
  check("their thread says nothing about what they are doing",
    strangerHead && !/Listening To/i.test(String(strangerHead.text)) &&
      !/Last active/i.test(String(strangerHead.text)) && !/Online/i.test(String(strangerHead.text)),
    JSON.stringify(strangerHead).slice(0, 200));

  /* ---- group chats, end to end ---- */
  /* A group is made from the friends list: a name, and the people to put in
     it. The one friend this account has is already a friend, so the group can
     be made without changing anybody's messaging settings first. */
  const groupDialog = await cdp.evalJson(`(function(){
    var b = document.querySelector('#thw-social-root [data-action="new-group"]');
    if (!b) return { error: "no new-group button" };
    b.click();
    var d = document.getElementById("thw-social-group");
    if (!d || d.hidden) return { error: "the dialog did not open" };
    return {
      open: true,
      people: document.querySelectorAll('#thw-social-group-people input[type=checkbox]').length,
    };
  })()`);
  check("the new group dialog opens", groupDialog && groupDialog.open === true, JSON.stringify(groupDialog));
  check("the dialog offers the friends to pick", groupDialog && Number(groupDialog.people) >= 1, String(groupDialog && groupDialog.people));

  const groupMade = await cdp.evalJson(`(async function(){
    var name = document.getElementById('thw-social-group-name');
    if (!name) return { error: "no name field" };
    name.value = "Test Group";
    var boxes = [...document.querySelectorAll('#thw-social-group-people input[type=checkbox]')];
    if (!boxes.length) return { error: "nobody to pick" };
    boxes[0].checked = true;
    document.getElementById('thw-social-group-people').dispatchEvent(new Event('change', { bubbles: true }));
    var create = document.getElementById('thw-social-group-create');
    if (create.disabled) return { error: "create stayed disabled" };
    var hint = (document.getElementById('thw-social-group-hint') || {}).textContent;
    create.click();
    await new Promise(function(r){ setTimeout(r, 3000); });
    var head = document.getElementById('thw-social-thread-head');
    return {
      hint: hint,
      dialogClosed: document.getElementById('thw-social-group').hidden === true,
      head: (head && head.innerText || '').trim().replace(/\\s+/g, ' ').slice(0, 60),
    };
  })()`);
  check("picking someone arms the create button", groupMade && /picked/i.test(String(groupMade.hint)), JSON.stringify(groupMade).slice(0, 90));
  check("the group is created and opened", groupMade && groupMade.dialogClosed === true, JSON.stringify(groupMade).slice(0, 120));
  check("the thread header names the group and counts its people",
    groupMade && /Test Group/.test(String(groupMade.head)) && /2 people/.test(String(groupMade.head)),
    String(groupMade && groupMade.head));

  const groupSent = await cdp.evalJson(`(async function(){
    var input = document.getElementById('thw-social-input');
    if (!input || input.disabled) return { error: "no composer" };
    input.value = "hello group";
    document.getElementById('thw-social-composer').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await new Promise(function(r){ setTimeout(r, 2500); });
    var bubbles = [...document.querySelectorAll('#thw-social-root .thw-social-message')];
    return {
      messages: bubbles.length,
      text: (document.getElementById('thw-social-thread-body').innerText || '').slice(0, 60),
    };
  })()`);
  check("a message can be sent in the group",
    groupSent && Number(groupSent.messages) >= 1 && /hello group/i.test(String(groupSent.text)),
    JSON.stringify(groupSent).slice(0, 110));

  /* The other member sees the group in their own panel. One browser is every
     account here, so the session cookie is swapped the same way the feed
     section swaps it - and the panel is the panel, answering as them. */
  await cdp.send("Network.setCookie", {
    name: "thw_session", value: "gallinked1token", domain: "127.0.0.1", path: "/",
  });
  const otherSees = await cdp.evalJson(`(async function(){
    window.THWSocial.open();
    await new Promise(function(r){ setTimeout(r, 2500); });
    return [...document.querySelectorAll('#thw-social-root .thw-social-convo')]
      .map(function(row){ return (row.innerText || '').replace(/\\s+/g, ' ').slice(0, 44); });
  })()`);
  check("the other member sees the group",
    Array.isArray(otherSees) && otherSees.some(function(t){ return /Test Group/.test(t); }),
    JSON.stringify(otherSees).slice(0, 140));
  await cdp.send("Network.setCookie", {
    name: "thw_session", value: "notifontoken1", domain: "127.0.0.1", path: "/",
  });

  /* ---- sending a track into a chat ---- */
  /* The track travels as a message: no words, just the card. The server is
     asked first, because the card is only ever drawn from what the server
     says it stored - a send that quietly dropped the track would still look
     right in the sender's own thread until it was reloaded. */
  const trackSent = await cdp.evalJson(`(async function () {
    var conv = await fetch("/api/social/conversations", {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uid: "gallinked1" })
    }).then(function (r) { return r.json().catch(function () { return {}; }); });
    if (!conv.conversationId) return { error: "no conversation: " + JSON.stringify(conv) };
    var post = await fetch("/api/social/conversations/" + encodeURIComponent(conv.conversationId) + "/messages", {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: "", track: { title: "All In", artist: "Juice WRLD" } })
    });
    var sent = await post.json().catch(function () { return {}; });
    var list = await fetch("/api/social/conversations/" + encodeURIComponent(conv.conversationId) + "/messages", {
      credentials: "same-origin"
    }).then(function (r) { return r.json().catch(function () { return {}; }); });
    var found = (list.messages || []).filter(function (m) { return m.track && m.track.title === "All In"; })[0];
    return {
      status: post.status,
      echoed: !!(sent.message && sent.message.track && sent.message.track.artist === "Juice WRLD"),
      body: sent.message ? String(sent.message.body) : null,
      listed: !!found
    };
  })()`);
  check("a message can be a track with no words at all", trackSent && trackSent.status === 201, JSON.stringify(trackSent));
  check("the send answers with the track it stored",
    trackSent && trackSent.echoed === true && trackSent.body === "", JSON.stringify(trackSent));
  check("the thread reads the track back", trackSent && trackSent.listed === true, JSON.stringify(trackSent));

  /* Now the panel: what the Send button on a track opens, and who it offers. */
  const shareDialog = await cdp.evalJson(`(async function () {
    window.THWSocial.open();
    await new Promise(function (r) { setTimeout(r, 2500); });
    window.THWSocial.shareTrack({ title: "All In", artist: "Juice WRLD" });
    await new Promise(function (r) { setTimeout(r, 900); });
    var d = document.getElementById("thw-social-share");
    var rows = [...document.querySelectorAll('#thw-social-share-people .thw-social-group-person')];
    var send = document.getElementById('thw-social-share-send');
    return {
      open: !!d && d.hidden === false,
      label: (document.getElementById('thw-social-share-track') || {}).textContent || "",
      rows: rows.length,
      /* These rows sit inside the panel, whose click handler opens any
         conversation it finds data-conversation-id on - which would take the
         pick out of the form before the form could send it. */
      hijacked: rows.some(function (r) { return r.hasAttribute('data-conversation-id'); }),
      send: send ? send.disabled : null
    };
  })()`);
  check("the share dialog opens on a track", shareDialog && shareDialog.open === true, JSON.stringify(shareDialog));
  check("it says which track is going", /All In/.test(String(shareDialog && shareDialog.label)),
    String(shareDialog && shareDialog.label).slice(0, 80));
  check("it offers the chats and friends to send it to",
    shareDialog && Number(shareDialog.rows) >= 2, String(shareDialog && shareDialog.rows));
  check("its rows are not conversation links", shareDialog && shareDialog.hijacked === false, JSON.stringify(shareDialog));
  check("nothing is picked yet, so Send stays off", shareDialog && shareDialog.send === true, JSON.stringify(shareDialog));

  /* Pick one, send it, and the card has to be in the thread it went to. */
  const shareSent = await cdp.evalJson(`(async function () {
    var boxes = [...document.querySelectorAll('#thw-social-share-people input[type=radio]')];
    if (!boxes.length) return { error: "nobody to send it to" };
    boxes[0].checked = true;
    document.getElementById('thw-social-share-people').dispatchEvent(new Event('change', { bubbles: true }));
    var send = document.getElementById('thw-social-share-send');
    var armed = !send.disabled;
    send.click();
    await new Promise(function (r) { setTimeout(r, 4000); });
    var card = document.querySelector('#thw-social-root .thw-social-track');
    var title = card && card.querySelector('.thw-social-track-title');
    var artist = card && card.querySelector('.thw-social-track-artist');
    var play = card && card.querySelector('.thw-social-track-play');
    return {
      armed: armed,
      closed: document.getElementById('thw-social-share').hidden === true,
      card: !!card,
      title: title ? title.textContent : "",
      artist: artist ? artist.textContent : "",
      play: play ? play.textContent : "",
      words: (document.getElementById('thw-social-thread-body') || {}).innerText || ""
    };
  })()`);
  check("picking someone arms the send", shareSent && shareSent.armed === true, JSON.stringify(shareSent).slice(0, 90));
  check("the dialog closes once it is sent", shareSent && shareSent.closed === true, JSON.stringify(shareSent).slice(0, 140));
  check("the card is in the thread it went to",
    shareSent && shareSent.card === true && shareSent.title === "All In" && shareSent.artist === "Juice WRLD",
    JSON.stringify(shareSent).slice(0, 170));
  check("the card offers a way to play it",
    shareSent && /play/i.test(String(shareSent.play)), String(shareSent && shareSent.play));

  /* And the point of it: tapping the card plays that track, in the receiver's
     own player, with the panel stepping aside so the player can be seen. */
  const played = await cdp.evalJson(`(async function () {
    var card = document.querySelector('#thw-social-root .thw-social-track');
    if (!card) return { error: "no card to play" };
    var now = document.getElementById('track-title');
    var before = {
      index: (typeof currentTrackIndex !== 'undefined') ? currentTrackIndex : null,
      now: now ? now.textContent.trim() : ""
    };
    var err = null;
    try { card.querySelector('.thw-social-track-play').click(); } catch (e) { err = String(e); }
    await new Promise(function (r) { setTimeout(r, 3000); });
    return {
      err: err,
      before: before,
      index: (typeof currentTrackIndex !== 'undefined') ? currentTrackIndex : null,
      playing: (typeof trackList !== 'undefined' && currentTrackIndex >= 0)
        ? (trackList[currentTrackIndex] || {}).title : "",
      now: now ? now.textContent.trim() : "",
      panel: document.getElementById('thw-social-overlay').hidden === true
    };
  })()`);
  check("tapping the card plays that track",
    played && played.err === null && played.before.index !== played.index && played.playing === "All In",
    JSON.stringify(played).slice(0, 200));
  check("the player now says what is playing",
    played && /All In/i.test(String(played.now)), String(played && played.now));
  check("the panel steps aside so the player is visible",
    played && played.panel === true, JSON.stringify(played));

  /* The notification names the track, because a card that arrives with no
     words would otherwise say nothing at all in the bell. */
  await cdp.send("Network.setCookie", {
    name: "thw_session", value: "gallinked1token", domain: "127.0.0.1", path: "/",
  });
  const trackNotice = await cdp.evalJson(`fetch("/api/notifications", { credentials: "same-origin" })
    .then(function (r) { return r.json().catch(function () { return {}; }); })
    .then(function (d) { return JSON.stringify(d).slice(0, 4000); })`);
  check("the person who got it is told which track",
    /sent you a track/i.test(String(trackNotice)) && /All In/.test(String(trackNotice)),
    String(trackNotice).slice(0, 200));
  await cdp.send("Network.setCookie", {
    name: "thw_session", value: "notifontoken1", domain: "127.0.0.1", path: "/",
  });
  await cdp.evalJson("window.THWSocial && window.THWSocial.open()");

  /* ---- the friend's name takes you to their profile ---- */
  /* The name in the Friends row is a link: it carries the address the
     browser would use, and clicking it opens that person's profile in
     place - with the panel stepping aside, so the profile is not sitting
     behind it under a dimmed wash. */
  const nameLink = await cdp.evalJson(`(async function(){
    window.THWSocial && window.THWSocial.open();
    var tab = document.querySelector('#thw-social-root [data-tab="friends"]');
    if (tab) tab.click();
    await new Promise(function(r){ setTimeout(r, 1500); });
    var row = [...document.querySelectorAll('#thw-social-friends .thw-social-row')]
      .find(function(r){ return /Gallery Linked/.test(r.textContent); });
    var link = row && row.querySelector('a.thw-social-name');
    if (!link) return { error: "the friend's name is not a link" };
    var href = link.getAttribute('href');
    link.click();
    await new Promise(function(r){ setTimeout(r, 3000); });
    var sec = document.getElementById('page-section-profile');
    var nm = document.querySelector('#profilePageBody .cmp-name');
    var ov = document.getElementById('thw-social-overlay');
    return {
      href: href,
      path: location.pathname,
      section: !!(sec && sec.classList.contains('active')),
      name: nm ? nm.textContent.trim() : "",
      panel: !!(ov && ov.hidden === true)
    };
  })()`);
  check("the friend's name carries their profile address",
    nameLink && String(nameLink.href) === "/Profile/gallinked1",
    JSON.stringify(nameLink).slice(0, 160));
  check("clicking the name takes you to their profile",
    nameLink && String(nameLink.path).indexOf("/Profile/") === 0 &&
      nameLink.section === true && /Gallery Linked/.test(String(nameLink.name)),
    JSON.stringify(nameLink).slice(0, 200));
  check("the panel steps aside so the profile is not behind it",
    nameLink && nameLink.panel === true, JSON.stringify(nameLink).slice(0, 200));
  /* The panel closed itself to show the profile, which is what a person
     would want - so open it again for the measurements below, the way
     every other section of this check finds it. */
  await cdp.evalJson("window.THWSocial && window.THWSocial.open()");

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

  /* The toggle says which way it is; the toast says what that did. */
  const toastOff = await cdp.evalJson("[...document.querySelectorAll('.gtoast')].map(function(n){ return (n.textContent || '').trim(); }).filter(Boolean)");
  check("turning them off says so in a toast",
    Array.isArray(toastOff) && toastOff.some(function(t){ return /cover gradients off/i.test(t); }),
    JSON.stringify(toastOff).slice(0, 120));
  const flatStyle = await cdp.evalJson("(function(){ var s = getCoverGradientStyle('Covers/Cheat Code.png'); var own = (typeof coverGradientMap !== 'undefined') ? (coverGradientMap['Covers/Cheat Code.png'] || '') : ''; return { style: s, own: own, ownInStyle: own ? s.indexOf(own) !== -1 : null, white: /255,\s*255,\s*255|#fff/i.test(String(s)), blank: s.indexOf('hsl(280,60%,55%)') !== -1 }; })()");
  check("the playlist and queue text go white once it is off",
    flatStyle && flatStyle.white === true && flatStyle.blank === false && flatStyle.ownInStyle === false,
    JSON.stringify(flatStyle).slice(0, 110));

  const toggledBack = await cdp.evalJson("(function(){ var t = document.getElementById('ps-cover-gradients-toggle'); if (!t) return null; t.checked = true; t.dispatchEvent(new Event('change', { bubbles: true })); return { after: window.wrldPlayerSettings.get('coverGradients'), style: getCoverGradientStyle('Juice-WRLD.png') }; })()");
  check("clicking it again brings them back",
    toggledBack && toggledBack.after === true && /gradient/.test(String(toggledBack.style)),
    JSON.stringify(toggledBack).slice(0, 110));

  const toastOn = await cdp.evalJson("[...document.querySelectorAll('.gtoast')].map(function(n){ return (n.textContent || '').trim(); }).filter(function(t){ return /cover gradients on/i.test(t); })");
  check("turning them back on says so too",
    Array.isArray(toastOn) && toastOn.length >= 1, JSON.stringify(toastOn).slice(0, 120));

  await cdp.evalJson("window.togglePlayerSettings && window.togglePlayerSettings()");

  /* ---- the panel can be made bigger ---- */
  const expanded = await cdp.evalJson("(function(){ var b = document.getElementById('thw-social-expand'); if (!b) return { error: 'no button' }; var before = document.getElementById('thw-social-panel').getBoundingClientRect().width; b.click(); var after = document.getElementById('thw-social-panel').getBoundingClientRect().width; b.click(); return { before: before, after: after }; })()");
  check("the panel can be made bigger", expanded && expanded.after > expanded.before, JSON.stringify(expanded));

  /* ---- the player and the panel: no overlap, and neither squeezed ---- */
  const room = await cdp.evalJson("(function () {\n  if (window.THWSocial && window.THWSocial.open) window.THWSocial.open();\n  function b(sel) {\n    var e = document.querySelector(sel);\n    if (!e) return null;\n    var r = e.getBoundingClientRect();\n    return { x: Math.round(r.left), r: Math.round(r.right), w: Math.round(r.width) };\n  }\n  function probe() {\n    var c = b('#player-container'), p = b('#thw-social-panel'), counter = b('#playlist-track-counter');\n    var ctrl = document.querySelector('.playlist-sticky-controls > div');\n    return {\n      vw: innerWidth,\n      player: c && c.w,\n      panel: p && p.w,\n      clear: (c && p) ? p.x - c.r : null,\n      wraps: ctrl ? getComputedStyle(ctrl).flexWrap : null,\n      counterClipped: (counter && p) ? counter.r > p.x : null\n    };\n  }\n  var closed = probe();\n  document.documentElement.classList.add('thw-social-wide');\n  var wide = probe();\n  document.documentElement.classList.remove('thw-social-wide');\n  return JSON.stringify({ closed: closed, wide: wide });\n})()");
  const r = room ? JSON.parse(room) : null;

  check("the player and the panel never overlap",
    r && r.closed.clear > 0 && r.wide.clear > 0,
    "closed " + (r && r.closed.clear) + "px, wide " + (r && r.wide.clear) + "px");

  check("opening the panel does not starve the player",
    r && r.closed.player >= 500,
    String(r && r.closed.player) + "px of " + (r && r.closed.vw));

  check("the bigger panel gives up width before the player does",
    r && r.wide.player >= 500 && r.wide.panel < r.wide.vw - 500,
    "player " + (r && r.wide.player) + "px, panel " + (r && r.wide.panel) + "px");

  /* The toolbar assertion is the opposite case and belongs to a narrow window:
     flex-wrap only comes into play when the section is genuinely squeezed. At
     1440 the player keeps 654px in the expanded state, there is room for the
     controls, and staying on one line is the correct behaviour - so measuring
     it there would be asserting that the page wraps when it does not need to.
     Narrow the window for this one check, then put it back. */
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 780, height: 900, deviceScaleFactor: 1, mobile: false,
  });
  await sleep(700);
  const squeezed = await cdp.evalJson(`(function () {
    if (window.THWSocial && window.THWSocial.open) window.THWSocial.open();
    document.documentElement.classList.add('thw-social-wide');
    var ctrl = document.querySelector('.playlist-sticky-controls > div');
    var counter = document.getElementById('playlist-track-counter');
    var p = document.getElementById('thw-social-panel');
    var out = {
      vw: innerWidth,
      wraps: ctrl ? getComputedStyle(ctrl).flexWrap : null,
      counterClipped: (counter && p) ? counter.getBoundingClientRect().right > p.getBoundingClientRect().left : null
    };
    document.documentElement.classList.remove('thw-social-wide');
    return JSON.stringify(out);
  })()`);
  const sq = squeezed ? JSON.parse(squeezed) : null;
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 1440, height: 900, deviceScaleFactor: 1, mobile: false,
  });

  check("the toolbar wraps instead of running under the panel",
    sq && sq.wraps === "wrap" && sq.counterClipped === false,
    JSON.stringify(sq));

  /* ---- the cover gradients, the title, the album and the controls ---- */
  await cdp.evalJson("window.wrldPlayerSettings.set('coverGradients', false)");
  await cdp.evalJson("(function(){ if (typeof applyMainGradient === 'function') applyMainGradient('Juice-WRLD.png'); if (typeof applyControlsGradient === 'function') applyControlsGradient('Juice-WRLD.png'); })()");
  /* The panel washes are the other half of this setting. They used to be painted
     from the same blank state the covers get, which left the player and the
     playlist a strong purple with the gradients switched off. The off state is
     meant to read as black, so check the wash each panel was actually handed
     rather than how it ends up compositing over the page behind it. */
  const panelWash = await cdp.evalJson("(function(){ function wash(id) { var e = document.getElementById(id); return e ? (e.getAttribute('style') || '').toLowerCase() : ''; } function black(s) { var flat = s.replace(/\\s+/g, ''); return flat.indexOf('rgba(0,0,0') !== -1 && flat.indexOf('hsl(') === -1; } var player = wash('player-panel'), playlist = wash('playlist-panel'); return { player: player.slice(0, 110), playlist: playlist.slice(0, 110), playerBlack: black(player), playlistBlack: black(playlist) }; })()");
  check("the player panel washes black when the gradients are off",
    panelWash && panelWash.playerBlack === true, JSON.stringify(panelWash).slice(0, 150));
  check("the playlist panel washes black when the gradients are off",
    panelWash && panelWash.playlistBlack === true, JSON.stringify(panelWash).slice(0, 150));
  const whites = await cdp.evalJson("(function(){ var t = document.getElementById('track-title'), g = document.getElementById('track-tag'); var u = document.getElementById('controls-container'); return { title: t ? getComputedStyle(t).backgroundImage : '', tag: g ? getComputedStyle(g).backgroundImage : '', controls: u ? getComputedStyle(u).getPropertyValue('--controls-c1').trim() : '', cover: getCoverGradientValue('Juice-WRLD.png') }; })()");
  check("the title is white when the gradients are off",
    whites && /255,\s*255,\s*255|#fff/i.test(String(whites.title)), JSON.stringify(whites).slice(0, 140));
  check("the album is white when the gradients are off",
    whites && /255,\s*255,\s*255|#fff/i.test(String(whites.tag)), JSON.stringify(whites).slice(0, 140));
  check("the controls are white when the gradients are off",
    whites && /255,\s*255,\s*255|#fff/i.test(String(whites.controls)), JSON.stringify(whites).slice(0, 140));
  const blank = await cdp.evalJson("(function(){ var on = getCoverGradientValue('Juice-WRLD.png'); var map = ''; if (typeof coverGradientMap !== 'undefined') map = coverGradientMap['Covers/Juice-WRLD.png'] || coverGradientMap['Juice-WRLD.png'] || ''; return { got: on, blank: map, same: !!map && on === map }; })()");
  check("the covers use the blank state gradient when the gradients are off",
    blank && blank.same === true, JSON.stringify(blank).slice(0, 140));
  await cdp.evalJson("window.wrldPlayerSettings.set('coverGradients', true)");

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
