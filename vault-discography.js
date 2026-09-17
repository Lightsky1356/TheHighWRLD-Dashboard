(function () {
  var projects = [
    { title: "Goodbye & Good Riddance", date: "May 23, 2018", type: "Studio album", label: "Grade A Productions / Interscope Records" },
    { title: "Death Race for Love", date: "March 8, 2019", type: "Studio album", label: "Grade A Productions / Interscope Records" },
    { title: "Legends Never Die", date: "July 10, 2020", type: "Studio album", label: "Grade A Productions / Interscope Records" },
    { title: "Fighting Demons", date: "December 10, 2021", type: "Studio album", label: "Grade A Productions / Interscope Records" }
  ];
  var mixtapes = [
    { title: "JuiceWRLD 9 9 9", date: "June 15, 2017", type: "Mixtape" },
    { title: "What Is Love?", date: "2015", type: "Mixtape" }
  ];
  var eps = [
    { title: "The Pre-Party", date: "September 2024", type: "Extended play", label: "Grade A Productions / Interscope Records" }
  ];
  var singles = [
    ["All Girls Are the Same", "2018"], ["Lucid Dreams", "2018"], ["Lean wit Me", "2018"],
    ["Wasted", "2018"], ["Armed and Dangerous", "2018"], ["Robbery", "2019"],
    ["Bandit", "2019"], ["Righteous", "2020"], ["Come & Go", "2020"],
    ["Wishing Well", "2020"], ["Already Dead", "2021"], ["In My Head", "2022"]
  ];
  var charted = [
    ["Hate Me", "Ellie Goulding featuring Juice WRLD", "2019"],
    ["Without Me (Remix)", "Halsey featuring Juice WRLD", "2019"],
    ["Godzilla", "Eminem featuring Juice WRLD", "2020"],
    ["Suicidal (Remix)", "YNW Melly featuring Juice WRLD", "2020"]
  ];
  var guests = [
    ["Nuketown", "Ski Mask the Slump God featuring Juice WRLD", "2018"],
    ["MoshPit", "Kodak Black featuring Juice WRLD", "2018"],
    ["Hide", "Juice WRLD and Seezyn", "2018"],
    ["The Way", "Jhené Aiko featuring Juice WRLD", "2020"]
  ];
  var videos = [
    ["All Girls Are the Same", "2018"], ["Lucid Dreams", "2018"], ["Lean wit Me", "2018"],
    ["Armed and Dangerous", "2018"], ["Robbery", "2019"], ["Come & Go", "2020"]
  ];
  function esc(value) {
    return String(value == null ? "" : value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function projectCard(item) {
    return '<article class="vault-release-card"><div class="vault-release-mark"><i class="fas fa-compact-disc"></i></div><div><h3>' + esc(item.title) + '</h3><p class="vault-release-date">' + esc(item.date) + '</p><span class="vault-release-type">' + esc(item.type) + '</span>' + (item.label ? '<p class="vault-release-label">' + esc(item.label) + '</p>' : '') + '</div></article>';
  }
  function rows(items, guest) {
    return items.map(function (item) {
      return '<li><strong>' + esc(item[0]) + '</strong><span>' + esc(guest ? item[1] + ' · ' + item[2] : item[1]) + '</span></li>';
    }).join("");
  }
  function section(title, content, extra) {
    return '<section class="vault-discography-section' + (extra || '') + '"><div class="vault-section-heading"><span></span><h3>' + title + '</h3></div>' + content + '</section>';
  }
  function buildView() {
    var view = document.createElement("div");
    view.id = "vault-discography-view";
    view.className = "relative bg-gradient-to-br from-[#1a1118] via-[#1c1420] to-[#0f0d14] vault-discography-view";
    view.hidden = true;
    view.innerHTML = '<div class="vault-discography-intro"><span>THE HIGHWRLD ARCHIVE</span><h2>Juice WRLD Discography</h2><p>Releases, collaborations, and visual work collected inside The Vault.</p></div>' +
      section("Studio Albums", '<div class="vault-release-grid">' + projects.map(projectCard).join("") + '</div>') +
      section("Mixtapes", '<div class="vault-release-grid">' + mixtapes.map(projectCard).join("") + '</div>') +
      section("Extended Plays / EPs", '<div class="vault-release-grid">' + eps.map(projectCard).join("") + '</div>') +
      section("Singles", '<ul class="vault-fact-list">' + rows(singles) + '</ul>') +
      section("Other Charted and Certified Songs", '<ul class="vault-fact-list">' + rows(charted, true) + '</ul>') +
      section("Guest Appearances", '<ul class="vault-fact-list">' + rows(guests, true) + '</ul>') +
      section("Music Videos", '<ul class="vault-fact-list">' + rows(videos) + '</ul>');
    return view;
  }
  function init() {
    var root = document.getElementById("community-updates");
    if (!root || root.dataset.discographyReady) return;
    var bio = root.querySelector(".juice-bio-top");
    var bioPanel = bio && bio.closest(".mb-6");
    if (!bioPanel) return;
    root.dataset.discographyReady = "1";
    var switcher = document.createElement("div");
    switcher.className = "vault-view-switch";
    switcher.setAttribute("role", "tablist");
    switcher.innerHTML = '<button type="button" class="vault-view-btn active" data-vault-view="biography" role="tab" aria-selected="true">Biography</button><button type="button" class="vault-view-btn" data-vault-view="discography" role="tab" aria-selected="false">Discography</button>';
    var panel = bioPanel.firstElementChild;
    var bioContent = panel && panel.firstElementChild;
    if (!panel || !bioContent) return;
    bioContent.classList.add("vault-bio-content");
    bioContent.insertBefore(switcher, bioContent.firstChild);
    var view = buildView();
    panel.id = "vault-biography-view";
    panel.appendChild(view);
    switcher.addEventListener("click", function (event) {
      var button = event.target.closest("[data-vault-view]");
      if (!button) return;
      var discography = button.getAttribute("data-vault-view") === "discography";
      bioContent.classList.toggle("vault-bio-hidden", discography);
      view.hidden = !discography;
      switcher.querySelectorAll(".vault-view-btn").forEach(function (item) {
        var active = item === button;
        item.classList.toggle("active", active);
        item.setAttribute("aria-selected", active ? "true" : "false");
      });
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();