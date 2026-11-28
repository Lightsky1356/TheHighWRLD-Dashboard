/* Grid/Compact switch for the Favorites panel on your own and other profiles.
   The choice is saved locally and reapplied every time a profile renders. */
(function () {
  "use strict";

  var KEY = "favLayout";
  var mode = "compact";
  try { mode = (window.wrldPlayerSettings && window.wrldPlayerSettings.get(KEY)) || "compact"; } catch (e) {}

  function grids() {
    var out = [];
    ["pvFavGrid", "favGrid", "pv2Fav"].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) out.push(el);
    });
    Array.prototype.forEach.call(document.querySelectorAll(".cmp-fav-grid"), function (el) {
      if (out.indexOf(el) === -1) out.push(el);
    });
    return out;
  }

  function apply() {
    grids().forEach(function (g) {
      g.classList.toggle("fav-compact", mode === "compact");
      var card = g.closest(".cmp-sec-card") || g.parentElement;
      var btn = card && card.querySelector(".fav-layout-btn");
      if (btn) {
        btn.textContent = mode === "compact" ? "Grid" : "Compact";
        btn.setAttribute("aria-pressed", mode === "compact" ? "true" : "false");
      }
    });
  }

  function mount() {
    var panels = Array.prototype.slice.call(document.querySelectorAll('.cmp-sec-card[data-pnl="favorites"]'));
    Array.prototype.forEach.call(document.querySelectorAll(".cmp-sec-title, .pv2-card-h"), function (title) {
      var text = title.textContent || "";
      if (text.indexOf("favorites") < 0 && text.indexOf("Favorites") < 0 &&
          text.indexOf("favourites") < 0 && text.indexOf("Favourites") < 0) return;
      var card = title.closest(".cmp-sec-card, .pv2-card");
      if (!card || card.querySelector(".fav-layout-btn")) return;
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "fav-layout-btn";
      btn.setAttribute("aria-pressed", "false");
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        mode = mode === "compact" ? "grid" : "compact";
        try { window.wrldPlayerSettings.set(KEY, mode); } catch (err) {}
        apply();
      });
      title.appendChild(btn);
      panels.push(card);
    });
    apply();
  }

  if (document.readyState !== "loading") mount();
  else document.addEventListener("DOMContentLoaded", mount);
  if (typeof MutationObserver === "function") {
    new MutationObserver(mount).observe(document.body, { childList: true, subtree: true });
  }
})();
