/* ============================================================================
   THEHIGHWRLD - FAILED PROJECTS DATA
   ----------------------------------------------------------------------------
   Plain data, no logic. failed-projects.js reads window.THW_FAILED_PROJECTS.

   A "failed project" is something that was built, started, or promised here and
   then dropped - not something that was merely never started. Keep every entry
   honest: say what it was, and say why it went away. The point is to stop the
   same dead end getting picked up a second time.

   reason: one of removed | replaced | broken | abandoned  (see REASONS below)
   category: any key from CATEGORIES below
   ========================================================================== */
(function () {
  "use strict";

  /* Why it failed. The label + icon pair is what the page shows on every card,
     so keep them readable on their own - colour is never the only signal. */
  var REASONS = {
    removed: { label: "Removed", icon: "fas fa-trash" },
    replaced: { label: "Replaced", icon: "fas fa-right-left" },
    broken: { label: "Didn't Work", icon: "fas fa-bug" },
    abandoned: { label: "Abandoned", icon: "fas fa-ban" }
  };

  var CATEGORIES = {
    media: { label: "Media", icon: "fas fa-music" },
    community: { label: "Community", icon: "fas fa-users" },
    ui: { label: "Interface", icon: "fas fa-layer-group" },
    infra: { label: "Infrastructure", icon: "fas fa-server" },
    account: { label: "Account", icon: "fas fa-user" }
  };

  var ITEMS = [
    {
      id: "public-playlists",
      title: "Public Playlists",
      reason: "removed",
      category: ["media", "community"],
      description:
        "A Community page that listed every public playlist with search, sorting and paging, and opened any one of them with its track list.",
      why:
        "Removed on request. It duplicated what personal playlists already do and needed its own API surface to keep in sync."
    },
    {
      id: "public-playlist-links",
      title: "Shareable Links to Single Playlists",
      reason: "abandoned",
      category: ["media", "community"],
      description:
        "Every public playlist getting its own address, so a link drops someone straight into that playlist's track list instead of the browse page.",
      why:
        "Dropped with public playlist browsing. There was nothing left for it to link into, and a public-by-default playlist surface wasn't wanted."
    },
    {
      id: "juicify",
      title: "Juicify",
      reason: "abandoned",
      featured: true,
      category: ["media", "infra"],
      description:
        "A self-hosted music server — library, player, synced lyrics, 30 themes, OAuth, S3 storage.",
      why:
        "Built Juicify as a standalone app, then needed a real server to be reachable. Every host cost money or accounts, so it stayed on localhost and reached nobody — including me.",
      tags: ["Self-hosted", "React", "Fastify", "Postgres"],
      /* The archive lives on the Juicify release, not in this repo, so it is
         an absolute URL. "file" stays separate: it is what the visitor is told
         they are downloading, while "url" is where it actually comes from.
         GitHub serves this with Content-Disposition: attachment, so it saves
         rather than navigating away from the page. */
      download: {
        url: "https://github.com/Lightsky1356/TheHighWRLD-Dashboard/releases/download/Juicify/Juicify-v1.0.0.zip",
        file: "Juicify-v1.0.0.zip",
        label: "Download Juicify",
        size: "402 KB",
        note: "no trackers, no secrets"
      }
    }
  ];

  window.THW_FAILED_PROJECTS = {
    reasons: REASONS,
    categories: CATEGORIES,
    items: ITEMS
  };
})();