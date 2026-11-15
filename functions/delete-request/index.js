/* /delete-request - the page the Danger Zone button sends people to.
 *
 * Deleting an account is irreversible, so it is never a button on the site: this
 * page walks someone through joining the server and putting in a request, and a
 * person does the removal. Everything you might want to change is in the CONFIG
 * block below - the invite, the form, the channel, and how long it takes. */

const CONFIG = {
  invite: "https://discord.gg/eBSTvCUgBp",
  /* Paste your delete-request form here. Until you do, the page does not pretend
     one exists: it hides the form button and tells people to ask in the channel
     instead, rather than sending them to a second copy of the same invite. */
  form: "",
  channel: "#delete-requests",
  eta: "48 hours",
  site: "/",
};

const HAS_FORM = !!CONFIG.form;

/* One accent pair per theme so the page matches whatever the visitor picked in
   Appearance. Anything unmapped falls back to the site's cyan. */
const ACCENTS = {
  default: ["#22d3ee", "#6366f1"],
  violet: ["#a78bfa", "#7c3aed"],
  ultraviolet: ["#c084fc", "#7e22ce"],
  galaxy: ["#a5b4fc", "#6d28d9"],
  blood: ["#f87171", "#dc2626"],
  dragon: ["#fb923c", "#dc2626"],
  lava: ["#fb923c", "#e11d48"],
  sunset: ["#fdba74", "#f97316"],
  tangerine: ["#fdba74", "#f59e0b"],
  pumpkin: ["#fbbf24", "#ea580c"],
  pharaoh: ["#fcd34d", "#d97706"],
  gold: ["#fcd34d", "#ca8a04"],
  royal: ["#fde68a", "#b45309"],
  matrix: ["#4ade80", "#16a34a"],
  toxic: ["#bef264", "#65a30d"],
  forest: ["#4ade80", "#15803d"],
  mint: ["#6ee7b7", "#059669"],
  ocean: ["#60a5fa", "#1d4ed8"],
  midnight: ["#7dd3fc", "#1e40af"],
  storm: ["#93c5fd", "#334155"],
  ice: ["#bae6fd", "#0284c7"],
  cyber: ["#f472b6", "#a21caf"],
  neon: ["#f472b6", "#db2777"],
  candy: ["#fda4af", "#e11d48"],
  sakura: ["#fbcfe8", "#db2777"],
  rose: ["#fda4af", "#be123c"],
  grape: ["#c4b5fd", "#7e22ce"],
  silver: ["#e2e8f0", "#64748b"],
  obsidian: ["#94a3b8", "#334155"],
  oled: ["#e5e7eb", "#111827"],
};

/* Inline SVG beats an emoji here: it inherits the accent and needs no icon font. */
const ICON_TRASH =
  '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 10v6M14 10v6"/></svg>';
const ICON_DISCORD =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">' +
  '<path d="M19.3 5.3A16.9 16.9 0 0 0 15.1 4l-.2.4c1.5.4 2.3.9 3.1 1.5a11.7 11.7 0 0 0-9.9 0c.8-.6 1.6-1.1 3.1-1.5L10.9 4c-1.5.2-3 .7-4.2 1.3A16.8 16.8 0 0 0 3.5 14a16.8 16.8 0 0 1 5.1-2.7c.4-.2.7-.4 1-.5-.6-.3-1.3-.5-2-.6.1 0 .1 0 .1-.1a11.6 11.6 0 0 1 8.3 0s.1 0 .1.1c-.7.1-1.4.3-2 .6.3.1.6.3 1 .5a16.7 16.7 0 0 1 5.1 2.7 16.8 16.8 0 0 0-3.2-8.7zM9.3 14.2c-.8 0-1.4-.7-1.4-1.6s.6-1.6 1.4-1.6 1.5.7 1.4 1.6c0 .9-.6 1.6-1.4 1.6zm5.4 0c-.8 0-1.4-.7-1.4-1.6s.6-1.6 1.4-1.6 1.5.7 1.4 1.6c0 .9-.6 1.6-1.4 1.6z"/></svg>';
const ICON_COPY =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/></svg>';
const ICON_ARROW =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6"/></svg>';

const esc = (s) =>
  String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const HTML = `<!DOCTYPE html>
<html lang="en" data-theme="default">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Delete your account - TheHighWRLD</title>
<meta name="description" content="Deleting your TheHighWRLD account is handled by a person. ${HAS_FORM ? "Join the server and fill out the delete-request form." : "Join the server and tell us in the channel."}">
<meta name="theme-color" content="#020617">
<meta property="og:title" content="Delete your account - TheHighWRLD">
<meta property="og:description" content="${HAS_FORM ? "Join the server and fill out the delete-request form." : "Join the server and tell us in the channel."} Requests are processed within ${CONFIG.eta}.">
<link rel="icon" href="/favicon.ico">
<style>
  :root {
    color-scheme: dark;
    --bg: #020617;
    --panel: #0b1220;
    --panel-2: #0f172a;
    --line: #1e293b;
    --text: #e2e8f0;
    --muted: #94a3b8;
    --dim: #64748b;
    --accent: #22d3ee;
    --accent-2: #6366f1;
    --danger: #f87171;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { min-height: 100%; }
  body {
    background: var(--bg);
    color: var(--text);
    font-family: "Segoe UI", system-ui, -apple-system, sans-serif;
    line-height: 1.6;
    padding: 0 20px 72px;
    -webkit-text-size-adjust: 100%;
  }
  /* two soft accent washes so the page is not a flat black rectangle */
  body::before, body::after {
    content: ""; position: fixed; z-index: 0; pointer-events: none;
    width: 620px; height: 620px; border-radius: 50%; filter: blur(90px); opacity: .16;
  }
  body::before { top: -260px; left: -160px; background: var(--accent); }
  body::after { bottom: -300px; right: -180px; background: var(--accent-2); }
  .wrap { position: relative; z-index: 1; max-width: 780px; margin: 0 auto; }

  .top { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 22px 0 18px; flex-wrap: wrap; }
  .brand { display: inline-flex; align-items: center; gap: 9px; text-decoration: none; color: var(--text); font-weight: 800; letter-spacing: .16em; font-size: 12px; }
  .brand-dot { width: 9px; height: 9px; border-radius: 50%; background: linear-gradient(135deg, var(--accent), var(--accent-2)); box-shadow: 0 0 14px var(--accent); }
  .top-back { color: var(--dim); text-decoration: none; font-size: 12.5px; border: 1px solid var(--line); border-radius: 999px; padding: 6px 13px; transition: color .15s, border-color .15s; }
  .top-back:hover, .top-back:focus-visible { color: var(--text); border-color: var(--accent); }

  .card {
    background: linear-gradient(180deg, var(--panel), var(--panel-2));
    border: 1px solid var(--line); border-radius: 18px;
    padding: 30px 28px; margin-bottom: 18px;
    box-shadow: 0 22px 55px rgba(0,0,0,.45);
  }
  .ico { width: 60px; height: 60px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
         background: linear-gradient(135deg, rgba(248,113,113,.22), rgba(239,68,68,.10)); color: var(--danger);
         border: 1px solid rgba(248,113,113,.28); margin-bottom: 18px; }
  .eyebrow { font-size: 11px; letter-spacing: .2em; text-transform: uppercase; color: var(--accent); font-weight: 700; margin-bottom: 8px; }
  h1 { font-size: 27px; line-height: 1.25; letter-spacing: -.01em; margin-bottom: 12px; }
  h2 { font-size: 15px; letter-spacing: .01em; margin-bottom: 12px; }
  .lead { color: var(--muted); font-size: 14.5px; }
  .lead b { color: var(--text); font-weight: 600; }

  .ctas { display: flex; gap: 11px; flex-wrap: wrap; margin: 22px 0 4px; }
  .btn { display: inline-flex; align-items: center; justify-content: center; gap: 9px; text-decoration: none;
         font-weight: 700; font-size: 14px; padding: 13px 22px; border-radius: 12px; border: 1px solid transparent;
         transition: transform .12s ease, filter .15s ease, border-color .15s ease; cursor: pointer; }
  .btn:hover, .btn:focus-visible { transform: translateY(-1px); }
  .btn-primary { background: linear-gradient(135deg, var(--accent), var(--accent-2)); color: #04121a;
                 box-shadow: 0 12px 30px rgba(34,211,238,.22); }
  .btn-primary:hover, .btn-primary:focus-visible { filter: brightness(1.08); }
  .btn-ghost { background: rgba(255,255,255,.04); color: var(--text); border-color: var(--line); }
  .btn-ghost:hover, .btn-ghost:focus-visible { border-color: var(--accent); color: var(--accent); }
  .btn-blurple { background: linear-gradient(135deg, #5865f2, #7289da); color: #fff; }
  .btn-blurple:hover, .btn-blurple:focus-visible { filter: brightness(1.08); }
  .btn:focus-visible, .top-back:focus-visible, .copy:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

  .steps { list-style: none; margin: 24px 0 0; display: grid; gap: 10px; }
  .steps li { display: flex; align-items: flex-start; gap: 12px; font-size: 14px; color: var(--muted); }
  .steps b { color: var(--text); }
  .steps .n { flex: 0 0 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
              font-size: 11.5px; font-weight: 700; color: #04121a; background: linear-gradient(135deg, var(--accent), var(--accent-2)); }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color: var(--accent); }

  .eta { margin-top: 20px; font-size: 12.5px; color: var(--dim); border-top: 1px solid var(--line); padding-top: 16px; }

  .handle { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 18px; padding: 13px 15px;
            border: 1px dashed var(--line); border-radius: 12px; background: rgba(255,255,255,.02); font-size: 13px; color: var(--muted); }
  /* the hidden attribute has to beat display:flex, or a signed-out visitor gets
     an empty "use this handle" box */
  .handle[hidden] { display: none; }
  .handle .who { color: var(--text); font-weight: 700; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  .copy { display: inline-flex; align-items: center; gap: 6px; background: rgba(255,255,255,.05); color: var(--muted);
          border: 1px solid var(--line); border-radius: 8px; font-size: 11.5px; padding: 5px 10px; cursor: pointer; font-family: inherit; }
  .copy:hover { color: var(--accent); border-color: var(--accent); }

  .split { display: grid; grid-template-columns: 1fr 1fr; gap: 22px; }
  .split ul { list-style: none; display: grid; gap: 8px; }
  .split li { font-size: 13.5px; color: var(--muted); padding-left: 20px; position: relative; }
  .split li::before { content: ""; position: absolute; left: 4px; top: 9px; width: 6px; height: 6px; border-radius: 50%; background: var(--accent); }
  .split .keep li::before { background: var(--dim); }
  .note { margin-top: 16px; font-size: 12.5px; color: var(--dim); }

  .pitch { text-align: center; border-color: rgba(34,211,238,.22); background: linear-gradient(180deg, rgba(34,211,238,.06), var(--panel-2)); }
  .pitch p { color: var(--muted); font-size: 14px; max-width: 52ch; margin: 0 auto; }
  .perks { list-style: none; display: flex; gap: 10px; flex-wrap: wrap; justify-content: center; margin: 22px 0 24px; }
  .perks li { font-size: 12.5px; color: var(--muted); border: 1px solid var(--line); border-radius: 999px; padding: 7px 14px; background: rgba(255,255,255,.03); }

  footer { text-align: center; font-size: 12px; color: var(--dim); padding-top: 6px; }
  footer a { color: var(--dim); text-decoration: none; border-bottom: 1px solid transparent; }
  footer a:hover { color: var(--accent); border-bottom-color: var(--accent); }
  footer .sep { margin: 0 8px; opacity: .5; }

  @media (max-width: 620px) {
    body { padding: 0 15px 56px; }
    .card { padding: 24px 19px; border-radius: 16px; }
    h1 { font-size: 23px; }
    .split { grid-template-columns: 1fr; gap: 18px; }
    .ctas .btn { width: 100%; }
  }
</style>
</head>
<body>
<div class="wrap">
  <div class="top">
    <a class="brand" href="${CONFIG.site}"><span class="brand-dot"></span>THEHIGHWRLD</a>
    <a class="top-back" href="${CONFIG.site}">Back to the dashboard</a>
  </div>

  <section class="card">
    <div class="ico">${ICON_TRASH}</div>
    <p class="eyebrow">Account deletion</p>
    <h1>Delete your account</h1>
    <p class="lead">We remove accounts by hand, not by button. That way nothing of yours gets wiped by a misclick, and there is always someone who can answer for it. <b>Join the server</b>, open <span class="mono">${esc(CONFIG.channel)}</span>${HAS_FORM ? " and fill out the delete-request form" : " and tell us what you want removed"} - a real person handles it from there.</p>

    <div class="ctas">
      <a class="btn btn-blurple" href="${esc(CONFIG.invite)}" target="_blank" rel="noopener nofollow">${ICON_DISCORD}Join the Server</a>
      ${HAS_FORM ? `<a class="btn btn-ghost" href="${esc(CONFIG.form)}" target="_blank" rel="noopener nofollow" id="formBtn">Fill out the delete-request form${ICON_ARROW}</a>` : ""}
    </div>

    <div class="handle" id="handle" hidden>
      <span>Use this handle ${HAS_FORM ? "in the form" : "in your message"}:</span>
      <span class="who" id="who"></span>
      <button class="copy" type="button" id="copyBtn">${ICON_COPY}Copy</button>
    </div>

    <ol class="steps">
      <li><span class="n">1</span><span><b>Join the server</b> with the button above - it takes about twenty seconds.</span></li>
      <li><span class="n">2</span><span>Open <span class="mono">${esc(CONFIG.channel)}</span>${HAS_FORM ? " and fill out the delete-request form." : " and tell us you want your account removed."}</span></li>
      <li><span class="n">3</span><span><b>Put your handle in it</b>${HAS_FORM ? "" : " as a message"} so we know which account to remove, then wait for the confirmation.</span></li>
    </ol>

    <p class="eta">Requests are processed within <b>${esc(CONFIG.eta)}</b>. You will get a confirmation in the server once it is done.</p>
  </section>

  <section class="card">
    <div class="split">
      <div>
        <h2>What gets removed</h2>
        <ul>
          <li>Your profile, bio, avatar, banner and links</li>
          <li>Your playlists and the tracks in them</li>
          <li>Favourites and bookmarks</li>
          <li>Listening history, plays and downloads</li>
          <li>Your community posts and replies</li>
          <li>Follows, votes and suggestions</li>
          <li>Your Discord link and every signed-in session</li>
        </ul>
      </div>
      <div class="keep">
        <h2>What stays</h2>
        <ul>
          <li>Replies other people left under your posts - they stop being visible rather than being deleted</li>
          <li>Your Discord messages, which we cannot reach from here - delete those in the server too if you want them gone</li>
          <li>The tracks themselves; only what belongs to your account goes</li>
        </ul>
        <p class="note">If you only want to stop the profile being seen, change your privacy settings instead - that is instant and reversible.</p>
      </div>
    </div>
  </section>

  <section class="card pitch">
    <h2>Come for the deletion, stay for the rest of it</h2>
    <p>The server is where the unreleased drops land first, where the next batch of tracks gets voted on, and where most of the people who built this actually are. Deleting an account is a two-minute errand - the rest of the place is worth the trip.</p>
    <ul class="perks">
      <li>Unreleased Sessions drops</li>
      <li>Vote on what gets added next</li>
      <li>Direct line to the team</li>
    </ul>
    <a class="btn btn-blurple" href="${esc(CONFIG.invite)}" target="_blank" rel="noopener nofollow">${ICON_DISCORD}Join the Server</a>
  </section>

  <footer>
    <a href="${CONFIG.site}">Dashboard</a><span class="sep">&middot;</span>
    <a href="${CONFIG.site}" data-legal="tos">Terms</a><span class="sep">&middot;</span>
    <a href="${CONFIG.site}" data-legal="pp">Privacy</a><span class="sep">&middot;</span>
    <a href="${CONFIG.site}" data-legal="dmca">DMCA</a>
  </footer>
</div>
<script>
  (function () {
    /* Paint the accent the visitor already picked in Appearance, so this page does
       not feel like a different website. */
    var t = "default";
    try { t = localStorage.getItem("wantedTheme") || "default"; } catch (e) {}
    var accents = ${JSON.stringify(ACCENTS)};
    var pair = accents[t] || accents.default;
    document.documentElement.setAttribute("data-theme", t);
    var root = document.documentElement.style;
    root.setProperty("--accent", pair[0]);
    root.setProperty("--accent-2", pair[1]);

    /* Show the handle they need to put in the form. Read from this device only -
       nothing is sent anywhere. */
    var who = document.getElementById("who"), box = document.getElementById("handle");
    if (who && box) {
      var name = "";
      try {
        var raw = JSON.parse(localStorage.getItem("wantedAuthUser") || "null");
        if (raw && raw.username) name = String(raw.username);
      } catch (e) {}
      if (!name) {
        try { name = String(JSON.parse(localStorage.getItem("wantedAuthUser") || "{}").name || ""); } catch (e) {}
      }
      if (name) { who.textContent = "@" + name.replace(/^@/, ""); box.hidden = false; }
    }
    var copy = document.getElementById("copyBtn");
    if (copy && who) {
      copy.addEventListener("click", function () {
        var done = function () { copy.textContent = "Copied"; setTimeout(function () { copy.textContent = "Copy"; }, 1600); };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(who.textContent).then(done, function () {});
        else done();
      });
    }

    /* The legal pages live on the dashboard as modals. */
    Array.prototype.forEach.call(document.querySelectorAll("[data-legal]"), function (a) {
      a.addEventListener("click", function (e) {
        if (typeof window.openLegal !== "function") return;
        e.preventDefault();
        window.openLegal(a.getAttribute("data-legal"));
      });
    });
  })();
</script>
</body>
</html>`;

export async function onRequest() {
  return new Response(HTML, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=0, must-revalidate",
    },
  });
}