(function () {
  "use strict";

  var cfg = { google: false, discord: false, hcaptchaSiteKey: "", hcaptchaConfigured: false };
  var user = null;
  var captchaWidgets = {};
  var captchaLoaded = false;
  var booted = false;

  function $(id) { return document.getElementById(id); }

  function toast(msg, type) {
    var box = document.getElementById("toasts");
    if (!box) return;
    var el = document.createElement("div");
    el.className = "toast " + (type || "info");
    var ico = type === "success" ? "fa-circle-check" : type === "error" ? "fa-circle-exclamation" : "fa-circle-info";
    el.innerHTML = '<i class="fas ' + ico + '"></i>' + msg;
    box.appendChild(el);
    setTimeout(function () { el.style.opacity = "0"; el.style.transform = "translateX(30px)"; setTimeout(function () { el.remove(); }, 300); }, 3200);
  }

  function setErr(el, msg) {
    if (!el) return;
    if (msg) { el.textContent = msg; el.style.display = "block"; } else { el.style.display = "none"; }
  }

  function fetchJson(url, opts) {
    return fetch(url, opts).then(function (r) {
      return r.json().catch(function () { return {}; });
    });
  }

  /* ---------- hCaptcha ---------- */
  function loadCaptchaScript() {
    if (captchaLoaded || window.hcaptcha || !cfg.hcaptchaSiteKey) return;
    captchaLoaded = true;
    var s = document.createElement("script");
    s.src = "https://hcaptcha.com/1/api.js?render=explicit&onload=__onHcaptchaReady";
    s.async = true;
    s.defer = true;
    document.head.appendChild(s);
  }

  function renderCaptcha(containerId) {
    var el = $(containerId);
    if (!el) return;
    if (!cfg.hcaptchaConfigured || !window.hcaptcha) {
      el.style.display = "none";
      return;
    }
    el.style.display = "";
    try {
      captchaWidgets[containerId] = window.hcaptcha.render(el, { sitekey: cfg.hcaptchaSiteKey, theme: "dark", size: "normal" });
    } catch (e) {}
  }

  function captchaToken(containerId) {
    if (!cfg.hcaptchaConfigured) return "";
    try {
      if (window.hcaptcha && captchaWidgets[containerId] != null) {
        return window.hcaptcha.getResponse(captchaWidgets[containerId]);
      }
    } catch (e) {}
    return "";
  }

  /* ---------- State UI ---------- */
  function applyLoggedIn(u) {
    user = u;
    try {
      localStorage.setItem("wantedUserId", u.uid);
      localStorage.setItem("wantedAuthUser", JSON.stringify(u));
    } catch (e) {}
    if (window._wantedUserId !== undefined) window._wantedUserId = u.uid;
    if (typeof window.__setAccountUid === "function") window.__setAccountUid(u.uid);
    var signedInGroup = $("navAccountSignedIn"), sUp = $("authNavSignup"), sIn = $("authNavSignin"), sOut = $("authNavSignout");
    var mUp = $("authMNavSignup"), mIn = $("authMNavSignin"), mOut = $("authMNavSignout");
    var wrap = $("nav-account-wrap"), navBtn = $("navPillAuthBtn"), menu = $("nav-account-menu");
    if (wrap) wrap.style.display = "flex";
    if (navBtn) navBtn.style.display = "none";
    if (menu) menu.style.display = "block";
    if (signedInGroup) signedInGroup.style.display = "flex";
    if (sUp) sUp.style.display = "none";
    if (sIn) sIn.style.display = "none";
    if (sOut) sOut.style.display = "flex";
    if (mUp) mUp.style.display = "none";
    if (mIn) mIn.style.display = "none";
    if (mOut) mOut.style.display = "";
    var ppUp = $("ppSignupBtn"), ppIn = $("ppSigninBtn"), ppPr = $("ppProfileBtn"), ppAc = $("ppAccountBtn"), ppSe = $("ppSep"), ppOut = $("ppSignoutBtn");
    if (ppUp) ppUp.style.display = "none";
    if (ppIn) ppIn.style.display = "none";
    if (ppPr) ppPr.style.display = "";
    if (ppAc) ppAc.style.display = "";
    if (ppSe) ppSe.style.display = "";
    if (ppOut) ppOut.style.display = "";
    var av = $("navAvatarInner");
    if (av) {
      var name = u.name || u.email || "9";
      av.textContent = name.trim().charAt(0).toUpperCase();
    }
    if (typeof window.setNotifBell === "function") window.setNotifBell(true);
  }

  function applyLoggedOut() {
    user = null;
    try { localStorage.removeItem("wantedAuthUser"); } catch (e) {}
    var signedInGroup = $("navAccountSignedIn"), sUp = $("authNavSignup"), sIn = $("authNavSignin"), sOut = $("authNavSignout");
    var mUp = $("authMNavSignup"), mIn = $("authMNavSignin"), mOut = $("authMNavSignout");
    var wrap = $("nav-account-wrap"), navBtn = $("navPillAuthBtn"), menu = $("nav-account-menu");
    if (wrap) wrap.style.display = "none";
    if (navBtn) navBtn.style.display = "flex";
    if (menu) menu.style.display = "none";
    if (signedInGroup) signedInGroup.style.display = "none";
    if (sUp) sUp.style.display = "flex";
    if (sIn) sIn.style.display = "flex";
    if (sOut) sOut.style.display = "none";
    if (mUp) mUp.style.display = "";
    if (mIn) mIn.style.display = "";
    if (mOut) mOut.style.display = "none";
    var ppUp2 = $("ppSignupBtn"), ppIn2 = $("ppSigninBtn"), ppPr2 = $("ppProfileBtn"), ppAc2 = $("ppAccountBtn"), ppSe2 = $("ppSep"), ppOut2 = $("ppSignoutBtn");
    if (ppUp2) ppUp2.style.display = "";
    if (ppIn2) ppIn2.style.display = "";
    if (ppPr2) ppPr2.style.display = "none";
    if (ppAc2) ppAc2.style.display = "none";
    if (ppSe2) ppSe2.style.display = "none";
    if (ppOut2) ppOut2.style.display = "none";
    var av = $("navAvatarInner");
    if (av) av.textContent = "9";
    if (typeof window.setNotifBell === "function") window.setNotifBell(false);
  }

  function newAnonUid() {
    return "u" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  /* ---------- OAuth ---------- */
  function oauthTo(url, label) {
    if (!cfg[label]) {
      toast(label === "google" ? "Google login isn't configured yet." : "Discord login isn't configured yet.", "error");
      return;
    }
    window.location.href = url;
  }

  /* ---------- Forms ---------- */
  function bindForm(formId, errId, action, onOk) {
    var form = $(formId);
    if (!form) return;
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var errEl = $(errId);
      var inputs = form.querySelectorAll("input");
      var payload = { hcaptcha: captchaToken(formId === "registerForm" ? "hcaptcha-register" : "hcaptcha-login") };
      for (var i = 0; i < inputs.length; i++) {
        if (inputs[i].name) payload[inputs[i].name] = inputs[i].value;
      }
      if (cfg.hcaptchaConfigured && !payload.hcaptcha) {
        setErr(errEl, "Please complete the captcha to continue.");
        return;
      }
      var btn = form.querySelector("button[type=submit]");
      if (btn) { btn.disabled = true; btn.style.opacity = ".6"; }
      fetchJson("/api/auth/" + action, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }).then(function (d) {
        if (btn) { btn.disabled = false; btn.style.opacity = ""; }
        if (d && d.ok && d.uid) {
          onOk(d);
        } else {
          setErr(errEl, (d && d.error) || "Something went wrong. Please try again.");
        }
      }).catch(function () {
        if (btn) { btn.disabled = false; btn.style.opacity = ""; }
        setErr(errEl, "Network error. Please try again.");
      });
    });
  }

  /* ---------- Entry ---------- */
  window.showAuthPage = function (view) {
    if (view !== "register") view = "login";
    if (typeof window.switchAppPage === "function") window.switchAppPage(view);
    setErr($("authError"), "");
    setErr($("authErrorReg"), "");
    renderCaptcha("hcaptcha-login");
    renderCaptcha("hcaptcha-register");
  };

  window.authGateSignIn = function () { window.showAuthPage("login"); };
  window.authGateRegister = function () { window.showAuthPage("register"); };

  window.authRoute = function (kind) {
    var signedIn = !!user;
    if (kind === "profile") {
      if (signedIn && typeof window.acctJump === "function") window.acctJump("profile");
      else if (typeof window.switchAppPage === "function") window.switchAppPage("profile");
    } else if (kind === "settings") {
      if (signedIn && typeof window.acctJump === "function") window.acctJump("settings");
      else if (typeof window.switchAppPage === "function") window.switchAppPage("settings");
    } else if (kind === "account") {
      if (signedIn) { if (typeof window.switchAppPage === "function") window.switchAppPage("account"); }
      else if (typeof window.switchAppPage === "function") window.switchAppPage("account-gate");
    } else if (kind === "login") {
      window.showAuthPage("login");
    } else if (kind === "register") {
      window.showAuthPage("register");
    }
  };

  function signOut() {
    fetch("/api/auth/logout", { method: "POST" }).catch(function () {}).then(function () {
      var anon = newAnonUid();
      try { localStorage.setItem("wantedUserId", anon); } catch (e) {}
      if (window._wantedUserId !== undefined) window._wantedUserId = anon;
      if (typeof window.__setAccountUid === "function") window.__setAccountUid(anon);
      applyLoggedOut();
      toast("Signed out. 999 forever.", "success");
      if (typeof window.authRoute === "function") window.authRoute("account");
      else if (typeof window.switchAppPage === "function") window.switchAppPage("account-gate");
    });
  }
  window.authSignOut = signOut;

  function bindStatic() {
    var b = $("btnGoogleLogin"); if (b) b.addEventListener("click", function () { oauthTo("/api/auth/google/start", "google"); });
    var br = $("btnGoogleRegister"); if (br) br.addEventListener("click", function () { oauthTo("/api/auth/google/start", "google"); });
    var d = $("btnDiscordLogin"); if (d) d.addEventListener("click", function () { oauthTo("/api/discord/login?mode=login", "discord"); });
    var dr = $("btnDiscordRegister"); if (dr) dr.addEventListener("click", function () { oauthTo("/api/discord/login?mode=login", "discord"); });
    var sUp = $("authNavSignup"); if (sUp) sUp.addEventListener("click", function () { window.showAuthPage("register"); });
    var navBtn = $("navPillAuthBtn"); if (navBtn) navBtn.addEventListener("click", function () { window.showAuthPage("login"); });
    var mUp = $("authMNavSignup"); if (mUp) mUp.addEventListener("click", function () { window.showAuthPage("register"); });
    var sIn = $("authNavSignin"); if (sIn) sIn.addEventListener("click", function () { window.showAuthPage("login"); });
    var mIn = $("authMNavSignin"); if (mIn) mIn.addEventListener("click", function () { window.showAuthPage("login"); });
    var sOut = $("authNavSignout"); if (sOut) sOut.addEventListener("click", signOut);
    var mOut = $("authMNavSignout"); if (mOut) mOut.addEventListener("click", signOut);
  }

  function boot() {
    if (booted) return;
    booted = true;
    bindStatic();
    bindForm("loginForm", "authError", "login", function (d) {
      applyLoggedIn({ uid: d.uid, email: d.email, name: d.name });
      toast("Welcome back, " + (d.name || "999") + "!", "success");
      if (typeof window.switchAppPage === "function") window.switchAppPage("account");
    });
    bindForm("registerForm", "authErrorReg", "register", function (d) {
      applyLoggedIn({ uid: d.uid, email: d.email, name: d.name });
      toast("Account created. Welcome to the WRLD, " + (d.name || "999") + "!", "success");
      if (typeof window.switchAppPage === "function") window.switchAppPage("account");
    });

    fetchJson("/api/auth/config").then(function (d) {
      if (!d || typeof d !== "object") return;
      cfg.google = !!d.google;
      cfg.discord = !!d.discord;
      cfg.hcaptchaSiteKey = d.hcaptchaSiteKey || "";
      cfg.hcaptchaConfigured = !!d.hcaptchaConfigured;
      if (cfg.hcaptchaConfigured) {
        window.__onHcaptchaReady = function () { renderCaptcha("hcaptcha-login"); renderCaptcha("hcaptcha-register"); };
        loadCaptchaScript();
      } else {
        renderCaptcha("hcaptcha-login");
        renderCaptcha("hcaptcha-register");
      }
    });

    fetchJson("/api/auth/session").then(function (d) {
      if (d && d.user && d.user.uid) {
        applyLoggedIn(d.user);
      } else {
        applyLoggedOut();
      }
      if (pendingPage) window.authRoute(pendingPage);
    });

    var qs = new URLSearchParams(window.location.search);
    if (qs.get("auth") === "ok") {
      try { history.replaceState(null, "", window.location.pathname); } catch (e) {}
      setTimeout(function () { toast("You're signed in!", "success"); }, 800);
    }
    if (qs.get("page")) pendingPage = qs.get("page");
  }

  var pendingPage = null;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
