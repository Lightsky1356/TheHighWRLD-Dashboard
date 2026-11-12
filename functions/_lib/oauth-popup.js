/*
 * Signing in without throwing the page away.
 *
 * Signing in with Discord or Google used to be a whole navigation: the
 * site sent the person to the provider and the provider sent them back,
 * and the page was fetched and drawn again from the top. Everything that
 * was happening stopped - the music, the position in the track, the scroll,
 * the panel that was open.
 *
 * So the sign-in happens in a small window instead. The window is the same
 * origin as the site, so the session cookie it is given is the site's
 * cookie, and when it is finished it tells the page that opened it. The
 * page then reads the session again and redraws the bit that says who is
 * signed in - without being fetched again, and without the music stopping.
 *
 * On the desktop app the same thing happens: the window opens as a small
 * window of the app, with the same cookies.
 *
 * If a browser blocks the small window, the sign-in falls back to the
 * old way - a full navigation - because a sign-in that cannot happen is
 * worse than one that interrupts the music.
 */

/* The state carries whether the sign-in is in a small window. */
export function withPopup(state, popup) {
  return popup ? String(state || "") + ":win" : String(state || "");
}

export function isPopupState(state) {
  return /:win$/.test(String(state || ""));
}

/* The state without the small-window marker. */
export function bareState(state) {
  return String(state || "").replace(/:win$/, "");
}

/* The little window's page: it tells the page that opened it and closes
   itself. */
export function popupDonePage(provider, message) {
  const who = provider || "the provider";
  const say = message || "You are signed in.";
  return (
    "<!DOCTYPE html><html><head><meta charset=\"utf-8\">" +
    "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">" +
    "<title>Signed in</title><style>" +
    "html,body{margin:0;height:100%;background:#08050f;color:#e9e6f5;" +
    "font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;display:flex;align-items:center;justify-content:center}" +
    ".card{text-align:center;padding:34px 28px;max-width:330px}" +
    ".mark{width:54px;height:54px;margin:0 auto 16px;border-radius:50%;" +
    "background:radial-gradient(circle at 35% 30%,rgba(34,211,238,.9),rgba(147,51,234,.85));" +
    "display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:800;color:#04070f}" +
    "h1{font-size:17px;margin:0 0 8px;font-weight:800}" +
    "p{font-size:12.5px;line-height:1.6;color:rgba(233,230,245,.55);margin:0}" +
    "</style></head><body><div class=\"card\">" +
    "<div class=\"mark\">&#10003;</div>" +
    "<h1>" + escHtml(say) + "</h1>" +
    "<p>This window closes by itself. You can close it now too.</p>" +
    "</div><script>(function(){" +
    "try{if(window.opener&&!window.opener.closed){" +
    "window.opener.postMessage({type:'thw:signed-in',provider:'" + escHtml(who) + "'},window.location.origin);" +
    "}}catch(e){}" +
    "setTimeout(function(){try{window.close();}catch(e){}},900);" +
    "})();</script></body></html>"
  );
}

function escHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
