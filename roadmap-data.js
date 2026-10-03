/* ============================================================================
   THEHIGHWRLD - ROADMAP DATA  (single source of truth)
   ----------------------------------------------------------------------------
   This is the ONLY file you need to edit to change the Roadmap page.
   Add, remove or edit items in ITEMS; the page renders whatever is here.

   ITEM SHAPE
     id          string   unique, used for anchors + keys ("kebab-case")
     title       string   card heading
     description string   1-2 plain sentences
     status      string   "in-progress" | "planned" | "considering" | "completed"
     category    array    one or more keys from CATEGORIES
     featured    boolean  optional - pins the item to the "What's Next?" panel
                          (only meaningful for in-progress items)
     progress    number   optional 0-100. Omit it and no progress bar is drawn.
                          "completed" items always show 100% automatically.
     lastUpdated string   optional "YYYY-MM-DD". Omit it and no date is drawn.

   RULES
     - Nothing is hard-coded on the page: badges, counts, sections, filters,
       search and the "What's Next?" panel all read from this file.
     - Keep statuses honest. Only mark something "completed" when it is
       actually live on the site.
   ========================================================================== */
(function (global) {
  "use strict";

  /* Status definitions drive every badge on the page. */
  var STATUSES = {
    "in-progress": {
      label: "In Progress",
      badge: "IN PROGRESS",
      icon: "fas fa-circle-notch",
      emoji: "🚀",
      color: "#22d3ee" /* cyan - the site's primary accent */
    },
    planned: {
      label: "Planned",
      badge: "PLANNED",
      icon: "far fa-calendar",
      emoji: "📅",
      color: "#fbbf24" /* amber */
    },
    considering: {
      label: "Considering",
      badge: "CONSIDERING",
      icon: "fas fa-lightbulb",
      emoji: "🔮",
      color: "#a78bfa" /* violet */
    },
    completed: {
      label: "Completed",
      badge: "COMPLETED",
      icon: "fas fa-check",
      emoji: "✅",
      color: "#4ade80" /* green */
    }
  };

  /* Section order on the page (the four major sections). */
  var STATUS_ORDER = ["in-progress", "planned", "considering", "completed"];

  var CATEGORIES = {
    player: { label: "Player", icon: "fas fa-compact-disc" },
    mobile: { label: "Mobile", icon: "fas fa-mobile-screen" },
    desktop: { label: "Desktop", icon: "fas fa-display" },
    performance: { label: "Performance", icon: "fas fa-gauge-high" },
    community: { label: "Community", icon: "fas fa-users" },
    profiles: { label: "Profiles", icon: "fas fa-user" },
    navigation: { label: "Navigation", icon: "fas fa-compass" },
    media: { label: "Media", icon: "fas fa-layer-group" },
    authentication: { label: "Authentication", icon: "fas fa-shield-halved" },
    other: { label: "Other", icon: "fas fa-shapes" }
  };

  var ITEMS = [
    /* ------------------------------ IN PROGRESS ----------------------------- */
    {
      id: "mobile-wrld-player",
      title: "Mobile WRLD Player",
      description: "A dedicated full-screen player for phones with touch-first controls, a mobile-optimised track list and a simplified control row. Remaining work is final spacing and gesture polish.",
      status: "in-progress",
      category: ["mobile"],
      featured: true,
      progress: 85,
      lastUpdated: "2026-10-03"
    },
    {
      id: "player-performance",
      title: "WRLD Player performance",
      description: "Virtualised track list, on-demand CAPTCHA loading, decorative motion paused while scrolling and asynchronous cover decoding. Next: profile the slowest devices and clear the remaining main-thread work.",
      status: "in-progress",
      category: ["performance"],
      progress: 70,
      lastUpdated: "2026-10-03"
    },
    {
      id: "discord-rich-presence",
      title: "Discord Rich Presence",
      description: "The presence controls already ship inside the player settings panel. The desktop bridge that actually reports the current track to Discord is the next piece to wire up.",
      status: "in-progress",
      category: ["desktop"],
      progress: 35,
      lastUpdated: "2026-10-03"
    },
    {
      id: "roadmap-system",
      title: "Roadmap",
      description: "This page: one central data file, status sections, status and category filters, client-side search and layouts for desktop, tablet and mobile.",
      status: "in-progress",
      category: ["other"],
      progress: 90,
      lastUpdated: "2026-10-03"
    },

    /* -------------------------------- PLANNED ------------------------------- */
    {
      id: "public-playlist-browsing",
      title: "Public playlist browsing",
      description: "Share links for playlists already work. Browsing and featuring other people's public playlists is the missing half.",
      status: "planned",
      category: ["media", "community"],
      progress: 50,
      lastUpdated: "2026-10-03"
    },
    {
      id: "offline-pwa",
      title: "Offline caching and installable app",
      description: "The service worker and its precache manifest are already in place. Registering it, plus the install prompt and the update flow, is what is left.",
      status: "planned",
      category: ["performance"],
      progress: 40,
      lastUpdated: "2026-10-03"
    },
    {
      id: "richer-profiles",
      title: "Richer profiles",
      description: "Your own profile now shows your real activity feed, and your picture and social links can be changed right on the profile page - saved to your account instead of the browser, with the platform and link checked server-side.",
      status: "completed",
      category: ["profiles"],
      lastUpdated: "2026-10-03"
    },
    {
      id: "playlist-improvements",
      title: "Playlist improvements",
      description: "Drag to reorder, custom playlist artwork and playlist descriptions.",
      status: "planned",
      category: ["media"]
    },
    {
      id: "browser-notifications",
      title: "Browser notifications",
      description: "Opt-in notifications for wanted-vault votes, replies to your posts and new suggestions.",
      status: "planned",
      category: ["community"]
    },
    {
      id: "era-metadata",
      title: "Expanded era and credit metadata",
      description: "Wider era coverage and per-track credits so the timeline and the track info panel stay accurate as the archive grows.",
      status: "planned",
      category: ["media"]
    },

    /* ------------------------------ CONSIDERING ----------------------------- */
    {
      id: "desktop-app-wrapper",
      title: "Desktop app wrapper",
      description: "An Electron shell for the dashboard already exists in the repository. Packaging it and keeping it in sync with the site is being scoped.",
      status: "considering",
      category: ["desktop"]
    },
    {
      id: "offline-audio-cache",
      title: "Offline audio cache",
      description: "Letting the player keep recently played tracks available without a connection.",
      status: "considering",
      category: ["player"]
    },
    {
      id: "public-track-api",
      title: "Public track API",
      description: "A documented read-only endpoint for the track data so other fan projects can build on it.",
      status: "considering",
      category: ["other"]
    },
    {
      id: "community-themes",
      title: "Community themes",
      description: "Letting people publish and share theme presets - the site already ships 32 built-in themes.",
      status: "considering",
      category: ["other"]
    },
    {
      id: "light-theme",
      title: "Light theme",
      description: "The site is dark-first across all 32 themes. A proper light palette is being considered.",
      status: "considering",
      category: ["other"]
    },

    /* ------------------------------- COMPLETED ------------------------------ */
    {
      id: "wrld-player",
      title: "WRLD Player",
      description: "The main player: full discography playback with a virtualised track list, shuffle and repeat, filters, search, presets and a queue.",
      status: "completed",
      category: ["player"],
      lastUpdated: "2026-08-30"
    },
    {
      id: "track-info-panel",
      title: "Track Info panel redesign",
      description: "Rebuilt for desktop and mobile: cover art, live stats, alternate names, credits and actions, on a readable panel tinted from the cover art.",
      status: "completed",
      category: ["player", "desktop"],
      lastUpdated: "2026-10-03"
    },
    {
      id: "favorites",
      title: "Favorites",
      description: "Favorite tracks from the player or the info panel. Stored per account and gated behind a linked Discord account.",
      status: "completed",
      category: ["player", "profiles"],
      lastUpdated: "2026-10-03"
    },
    {
      id: "queue",
      title: "Queue",
      description: "Add tracks to a queue from the track list or the info panel and play the queue back from the player.",
      status: "completed",
      category: ["player", "desktop"],
      lastUpdated: "2026-08-30"
    },
    {
      id: "mobile-ui-cleanup",
      title: "Mobile UI cleanup",
      description: "Removed the player controls that do not work on touch, hid favorite and info while the player is empty, and rebalanced the secondary control row.",
      status: "completed",
      category: ["mobile"],
      lastUpdated: "2026-10-03"
    },
    {
      id: "the-vault",
      title: "The Vault",
      description: "The complete in-player discography with release browsing, era grouping and a written biography.",
      status: "completed",
      category: ["media"],
      lastUpdated: "2026-09-17"
    },
    {
      id: "era-explorer",
      title: "Era Explorer & Timeline",
      description: "Walk the archive by era and year, from the earliest sessions through to the newest releases.",
      status: "completed",
      category: ["media"]
    },
    {
      id: "wanted-vault",
      title: "Wanted Vault",
      description: "The community voting vault for unreleased tracks, with replies and realtime updates.",
      status: "completed",
      category: ["community"],
      lastUpdated: "2026-08-30"
    },
    {
      id: "suggestions",
      title: "Suggestions",
      description: "A public board for submitting unreleased ideas and leaks for the community to vote on.",
      status: "completed",
      category: ["community"],
      lastUpdated: "2026-08-30"
    },
    {
      id: "discord-authentication",
      title: "Discord authentication",
      description: "Sign in and register through Discord, with account-linked favorites, playlists and follows.",
      status: "completed",
      category: ["authentication"],
      lastUpdated: "2026-08-30"
    },
    {
      id: "community-hub",
      title: "Community",
      description: "The realtime community hub: posts, replies and threads with live updates, moderation and owner announcements.",
      status: "completed",
      category: ["community"],
      lastUpdated: "2026-08-30"
    },
    {
      id: "following",
      title: "Following",
      description: "Follow other members and see who is following you, straight from their profile.",
      status: "completed",
      category: ["community", "profiles"]
    },
    {
      id: "moderation",
      title: "Block, mute and moderation",
      description: "Block or mute members, plus the ban, strike, appeal and owner moderation tools behind them.",
      status: "completed",
      category: ["community"],
      lastUpdated: "2026-09-16"
    },
    {
      id: "reports",
      title: "Reports",
      description: "Report posts and members, and follow the status of every report you filed.",
      status: "completed",
      category: ["community"],
      lastUpdated: "2026-09-10"
    },
    {
      id: "profile-system",
      title: "Profile system",
      description: "Profiles with member details, favorites, playlists, listening history, personal stats and privacy controls.",
      status: "completed",
      category: ["profiles"],
      lastUpdated: "2026-08-30"
    },
    {
      id: "personal-stats",
      title: "Personal WRLD stats",
      description: "Your own listening numbers on the profile page: top tracks, eras and totals.",
      status: "completed",
      category: ["profiles"]
    },
    {
      id: "privacy-controls",
      title: "Privacy controls",
      description: "Choose what other members can see on your profile.",
      status: "completed",
      category: ["profiles"]
    },
    {
      id: "playlists",
      title: "Playlists",
      description: "Create and edit playlists that sync across devices, with shareable links.",
      status: "completed",
      category: ["media", "profiles"]
    },
    {
      id: "listening-history",
      title: "Listening history",
      description: "Recently played tracks, kept on your account and shown in the player.",
      status: "completed",
      category: ["player"]
    },
    {
      id: "notification-center",
      title: "Notification center",
      description: "One bell for wanted-vault votes, replies, reports, profile activity and owner announcements.",
      status: "completed",
      category: ["community", "profiles"]
    },
    {
      id: "global-search",
      title: "Global search",
      description: "Search the site from the navigation and jump straight to a track, member or page.",
      status: "completed",
      category: ["navigation"]
    },
    {
      id: "mobile-navigation",
      title: "Mobile navigation",
      description: "A five-tab bottom bar - Lobby, Player, Vault, Community and Profile - with popups for the Community and Profile sections.",
      status: "completed",
      category: ["navigation", "mobile"],
      lastUpdated: "2026-08-30"
    },
    {
      id: "gallery",
      title: "Gallery",
      description: "A community image gallery with its own uploads and browsing.",
      status: "completed",
      category: ["media"],
      lastUpdated: "2026-09-26"
    },
    {
      id: "drops",
      title: "Drops",
      description: "Scheduled releases and announcements surfaced on the lobby.",
      status: "completed",
      category: ["media"]
    },
    {
      id: "trending",
      title: "Trending",
      description: "What is being played most right now, docked under the player track list.",
      status: "completed",
      category: ["player", "media"]
    },
    {
      id: "themes",
      title: "Themes",
      description: "32 built-in themes, switchable per account and saved to your profile.",
      status: "completed",
      category: ["other"],
      lastUpdated: "2026-08-30"
    }
  ];

  global.THW_ROADMAP = {
    updated: "2026-10-03",
    statuses: STATUSES,
    statusOrder: STATUS_ORDER,
    categories: CATEGORIES,
    items: ITEMS
  };
})(typeof window !== "undefined" ? window : this);