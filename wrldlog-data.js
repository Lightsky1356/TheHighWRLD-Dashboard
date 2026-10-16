/* ==== WRLD LOG - SINGLE SOURCE OF TRUTH ====

   Every release note for TheHighWRLD Dashboard, newest first.

   WHY THIS FILE EXISTS
   The history used to live as inline HTML inside one 18KB line of index.html, in
   two places that never agreed: #changelog-list stopped at v4.5 while the modal
   badge read v4.6. Adding a release meant editing two distant, unlinked spots and
   hoping you found both.

   It is extracted mechanically by the build step that generated it, not retyped.
   Thirty-one hand-copied release notes is thirty-one chances to silently change
   someone's words.

   ENTRY SHAPE
     version   string   "v4.6" - the literal label shown to users
     title     string   one-line headline. Only v4.6 has one today; every other
                        entry's headline is derived from its notes at render time.
     notes     string   the full release note, exactly as it was written

   RULES
     - Never invent a version, a date, or a note. If a version is not in this
       file it did not ship.
     - There are deliberately NO categories. The original notes carry none, and
       inventing "Features"/"Fixes" labels would be fabricating release
       information, so the panel offers search only.
     - v1.7 is absent from the sequence. It was already absent at this
       repository's root commit (2026-08-30), so it is a gap in the numbering,
       not content that was lost. Nothing has been inserted to fill it.

   Read by wrldlog.js. Nothing else may hard-code a version list.
*/

window.THW_WRLDLOG = [
  {
    version: "v4.6",
    title: "Friends & Messages, House Rules & Failed Projects",
    chips: ["Friends & Messages — add friends, see who is around, and hold private conversations, from a panel beside the Community menu", "House Rules — a Rules panel inside Friends & Messages: what is allowed, what to do if something goes wrong, and how to block or report someone", "Failed Projects — a new Community page collecting the features that were built and then dropped, and why each one went away, so the same dead ends do not get picked up twice", "The Rules panel locks the page behind it, and on phones the Friends & Messages panel does too, so neither can scroll out from under you"],
    notes: "Friends & Messages, House Rules & Failed Projects · Friends & Messages — add friends, see who is around, and hold private conversations, from a panel beside the Community menu · House Rules — a Rules panel inside Friends & Messages: what is allowed, what to do if something goes wrong, and how to block or report someone · Failed Projects — a new Community page collecting the features that were built and then dropped, and why each one went away, so the same dead ends do not get picked up twice · The Rules panel locks the page behind it, and on phones the Friends & Messages panel does too, so neither can scroll out from under you",
  },
  {
    version: "v4.5",
    title: "",
    notes: "8 new tracks: Lean Wit' Me, Move The Bale, I Want It, Not Enough, Quitter, Wasted, Play Fair & Percs — each with its own cover & gradient · The Roadmap page, with a shareable link for every item · Discord Rich Presence, plus fixes for it lagging a track behind and having no paused state",
  },
  {
    version: "v4.4",
    title: "",
    notes: "Richer Profiles · WRLD Player performance (virtualised track list, 18 rows in the page instead of all 281) · Mobile player layout fix (touch-first controls, draggable seek bar, swipe down to close) · Info panel layout rebuilt for desktop & mobile",
  },
  {
    version: "v4.3",
    title: "",
    notes: "Search suggestions while typing, blocked & muted accounts filtered from search, Recently Played on profiles & player, richer track info panel, server playlists with sharing, profile visibility controls, monthly listening summaries",
  },
  {
    version: "v4.2",
    title: "",
    notes: "WRLD Stats page (plays, streaks, top tracks & rank), track credits modal, first-visit onboarding tour, Drops & Events with countdowns, Lobby shoutbox, reply notifications in the bell, trending strip & command palette in search",
  },
  {
    version: "v4.1",
    title: "",
    notes: "Global search overhaul: search toggle sits next to the DRP pill, press K / Ctrl+K / / to open a blurred search panel, match highlighting, arrow-key navigation, recent searches, suggestions board results, grouped counts & result footer",
  },
  {
    version: "v4.0",
    title: "",
    notes: "Multi-platform desktop apps (Windows, Mac & Linux), Discord Rich Presence integration, Night Light toggle, 9 new unreleased tracks added to the vault",
  },
  {
    version: "v3.9",
    title: "",
    notes: "Profile is now its own page - playlists, favorites & analytics moved onto it, account dashboard cleaned into a single column, hover your profile photo to change it, new 999 Cyan default theme",
  },
  {
    version: "v3.8",
    title: "",
    notes: "Owner dashboard: site-wide visit stats, votes, replies, top tracks & Discord links behind a passcode",
  },
  {
    version: "v3.7",
    title: "",
    notes: "Wanted Vault revamped: 176 unreleased tracks & sessions (only unreleased, 69 session recordings deep-linked from JuiceVault Sessions), filter tabs (All / Leaks / Sessions) and live search, Listen on JuiceVault links on every track",
  },
  {
    version: "v3.6",
    title: "",
    notes: "Wanted Vault is now a live community server: votes, replies & nominations stored on Cloudflare D1 (no more local saves), 20 more archive tracks added (36 total, all deep-linked to JuiceVault)",
  },
  {
    version: "v3.5",
    title: "",
    notes: "Wanted Vault replies can now be edited and deleted by anyone (pencil / trash buttons on each reply)",
  },
  {
    version: "v3.4",
    title: "",
    notes: "Wanted Vault redesigned as a live community server: votes reset to 0, reply threads on every track, JuiceVault archive links, works on PC & mobile",
  },
  {
    version: "v3.3",
    title: "",
    notes: "New Wanted Vault tab (vote on & nominate unreleased tracks), fixed the Cover Artist </> arrows, fixed \"Cover made by N/A\" credits in the Info Panel",
  },
  {
    version: "v3.2",
    title: "",
    notes: "Fixed WRLD Player categories (Sessions filter, tab state, stale 219 track counter now 241), fixed glitchy glass effect on the nav tabs",
  },
  {
    version: "v3.1",
    title: "",
    notes: "WRLD LOG popup opens by clicking the panel or pressing U, popup only closes via X or the button",
  },
  {
    version: "v3.0",
    title: "",
    notes: "8 new tracks (AP TikTok, Autograph, Carry It, K Like A Russian, Remind Me Of The Summer, Rental, Tales Of The Toxic, Talk Too Much), new alt names (Hope U Understand: Hope You Understand, My Bad: Revenge In The Air, Let It Buss: Let It Bust), covers now hosted on GitHub, tracks.js cleaned up, Tsunami Soul 2 & X-Mas List covers fixed",
  },
  {
    version: "v2.9",
    title: "",
    notes: "11 new tracks (Codeine Casket, Codeine Cobain v3, Codeine Guzzler, Codeine Music, Don't Go, Don't Know What I'm On, Lost Myself, Mr. Heartbreak, Rush, Wavy, Will), category filter bug fixed, hero background restored, cover credits for new artwork, Wavy alt name: Last Time",
  },
  {
    version: "v2.8",
    title: "",
    notes: "Full encoding cleanup (261 FFFD and double-? chars removed), artist panel bullet fixes, keyboard shortcuts restored (arrows), legal text § symbols fixed, track rename: I Wanna → I Wanna (Sessions) (AF), password placeholder dots fixed",
  },
  {
    version: "v2.7",
    title: "",
    notes: "Encoding corruption fixed across all panels (Info, Vault, Keyboard Shortcuts, Footer, Rules, Comps, TOS/PP, Credits), Rules panel re-written with 16 rules, all arrows replaced with HTML entities, Rules overflow-x-hidden, cover art separators cleaned",
  },
  {
    version: "v2.6",
    title: "",
    notes: "Mobile-friendly overhaul (dvh, touch targets, landscape, scrollbar, overflow safety), queue animations (stagger entry, slide-out removal, badge pop), player panel revamp (new control/play buttons, progress bar, vinyl, mini-player, blank state), TOS/PP revamp, lyrics removed, Tsunami Soul 2 added",
  },
  {
    version: "v2.5",
    title: "",
    notes: "Visual polish: glassmorphism on all panels, 93→62 inline styles removed, artist/captcha/lightbox CSS cleanup",
  },
  {
    version: "v2.4",
    title: "",
    notes: "Missing tracks added (Devil Horns Sessions/v1, Emotional Overdose Sessions/v2), join panel revamp, juicewrldapi.com streaming, recorded→year rename",
  },
  {
    version: "v2.3",
    title: "",
    notes: "Favorites/likes system, cover glow/zoom, background gradient shifts, missing file handling, scroll arrows removed, info button moved, vault tab fix",
  },
  {
    version: "v2.2",
    title: "",
    notes: "Cloudflare protocol fixes, emoji corruption fixed, gradients work on https",
  },
  {
    version: "v2.1",
    title: "",
    notes: "Year/producer fix, era descriptions (click to show), info panel hides on tab switch, tracks.js syntax fix",
  },
  {
    version: "v2.0",
    title: "",
    notes: "Executive Lounge, gold aesthetic, vault stats, daily curation",
  },
  {
    version: "v1.9",
    title: "",
    notes: "Cover gradients extracted from real artwork, text readability boost",
  },
  {
    version: "v1.8",
    title: "",
    notes: "9 missing tracks added (Bottle, Dukes, Haze, Heavy, The Race, etc.)",
  },
  {
    version: "v1.6",
    title: "",
    notes: "Comps list expanded from 26 to 61 entries across all categories",
  },
  {
    version: "v1.5",
    title: "",
    notes: "Captcha, Home tab cards, mobile support",
  }
];
