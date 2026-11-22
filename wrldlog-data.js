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
      - Versions are strictly continuous, 0.1 apart: v1.5 ... v1.9, then
        v2.0 ... upward. The sequence originally had a gap where v1.7 should
        be (it predates this repository and its text was never recoverable),
        so on 2026-11-02 every version from v1.8 upward was stepped down by
        0.1 rather than leaving a hole - the numbers are labels, not history.
      - New entries come from scripts/log-release.cjs (manual, e.g. a big
        feature) and from scripts/auto-sync-tracks.cjs, which logs the batch
        of new songs it just added (threshold AUTO_SYNC_LOG_MIN, default 2).
        Both compute the next version from data[0], so it cannot skip.

   Read by wrldlog.js. Nothing else may hard-code a version list.
*/

window.THW_WRLDLOG = [
  {
    version: "v5.0",
    title: "Settings, Profile & Presence",
    chips: ["Settings rebuilt into a sidebar with tabs — Profile, Appearance, Playback, Notifications, Privacy, Account and Your suggestions; guests get a simplified panel with a link to sign in, and every section saves from within the tab it names", "Profile tab rebuilt into a real editor — a two-column preview rail beside the form: avatar & banner uploads, display name, readonly username, live 0/160 bio counter, favourite song search, banner cards (Top era default / Rank Fan '999' / your own image) · Discard & Save profile", "Live music presence — friends' rows and conversation headers show what each friend is listening to and play it with one tap · the window that silently returned nothing was fixed, so presence only appears while someone is listening and online"],
    notes: "Settings, Profile & Presence · Settings rebuilt into a sidebar with tabs — Profile, Appearance, Playback, Notifications, Privacy, Account and Your suggestions; guests get a simplified panel with a link to sign in, and every section saves from within the tab it names · Profile tab rebuilt into a real editor — a two-column preview rail beside the form: avatar & banner uploads, display name, readonly username, live 0/160 bio counter, favourite song search, banner cards (Top era default / Rank Fan '999' / your own image) · Discard & Save profile · Live music presence — friends' rows and conversation headers show what each friend is listening to and play it with one tap · the window that silently returned nothing was fixed, so presence only appears while someone is listening and online",
  },
  {
    version: "v4.9",
    title: "Inner Circle — Messages on a Real Page",
    chips: ["Inner Circle is a real page now — the messages panel no longer floats in the corner: the FAB, the wash and the overlay are gone, and the panel fills the screen full-width on desktop & mobile with the friends sidebar inline", "Composition upgrades — drag and drop any file onto the composer to attach it (audio up to 8 MB, title & artist auto-filled from embedded ID3 tags, plus images and documents) · audio messages render as inline players", "Message toolbar & blocked state — hover any message for react / reply / copy / grammar check · when you've been blocked the composer locks with 'You have been blocked' and edit, delete, react and report are all hidden & refused server-side"],
    notes: "Inner Circle — Messages on a Real Page · Inner Circle is a real page now — the messages panel no longer floats in the corner: the FAB, the wash and the overlay are gone, and the panel fills the screen full-width on desktop & mobile with the friends sidebar inline · Composition upgrades — drag and drop any file onto the composer to attach it (audio up to 8 MB, title & artist auto-filled from embedded ID3 tags, plus images and documents) · audio messages render as inline players · Message toolbar & blocked state — hover any message for react / reply / copy / grammar check · when you've been blocked the composer locks with 'You have been blocked' and edit, delete, react and report are all hidden & refused server-side",
  },
  {
    version: "v4.8",
    title: "Deck, Hero & Polish",
    chips: ["WRLD Deck — the expand button moved next to Favourite and renders as two outward arrows · the opacity dropdown gains a Solid option · the mobile deck loses its album tag", "Hero & polish — the hero title now glows as a purple-to-blue gradient · track playback no longer silently shuffles when shuffle is off (autoplaySimilar now defaults off) · Era pages show a pause icon only on the currently playing track", "Removals — Bluetooth button deleted (not a real capability) · the Community dropdown was deleted · the 999 hero/shadow and the 'F' key wire-up were cleaned up"],
    notes: "Deck, Hero & Polish · WRLD Deck — the expand button moved next to Favourite and renders as two outward arrows · the opacity dropdown gains a Solid option · the mobile deck loses its album tag · Hero & polish — the hero title now glows as a purple-to-blue gradient · track playback no longer silently shuffles when shuffle is off (autoplaySimilar now defaults off) · Era pages show a pause icon only on the currently playing track · Removals — Bluetooth button deleted (not a real capability) · the Community dropdown was deleted · the 999 hero/shadow and the 'F' key wire-up were cleaned up",
  },
  {
    version: "v4.7",
    title: "Appearance & Notifications",
    chips: ["Seasonal themes — eight handles (Halloween, Christmas, New Year, Valentine's, St. Patrick's, Easter, July 4, Thanksgiving) with live effect decals when they're on, a pure-OLED black built-in, and per-theme descriptions & histories built into the settings page", "NSFW Blur with click-to-reveal — marked covers are blurred on vault lists, the deck and both now-playing sheets; click a cover to reveal it (signed-out view keeps everything blurred) · Moving colours animates the now-playing gradients with the artwork; Era covers everywhere when you prefer them", "Notifications panel rebuilt — bubble toggles for Announcements / Wanted replies / Suggestions / Comment replies, push notifications wired end-to-end with a per-category Enabled/Disabled pill, and in-app toasts that route to the right page"],
    notes: "Appearance & Notifications · Seasonal themes — eight handles (Halloween, Christmas, New Year, Valentine's, St. Patrick's, Easter, July 4, Thanksgiving) with live effect decals when they're on, a pure-OLED black built-in, and per-theme descriptions & histories built into the settings page · NSFW Blur with click-to-reveal — marked covers are blurred on vault lists, the deck and both now-playing sheets; click a cover to reveal it (signed-out view keeps everything blurred) · Moving colours animates the now-playing gradients with the artwork; Era covers everywhere when you prefer them · Notifications panel rebuilt — bubble toggles for Announcements / Wanted replies / Suggestions / Comment replies, push notifications wired end-to-end with a per-category Enabled/Disabled pill, and in-app toasts that route to the right page",
  },
  {
    version: "v4.6",
    title: "Auto Sync, 10 New Tracks & the IFPI / RIAA Copyright Page",
    chips: ["10 new tracks added — Floating, Heart Racing, Hop Out, Smith & Wesson, Royer (Sessions), The Party Never Ends (Sessions), Spanglish (Sessions), Cheat Code (Sessions), Time (Sessions) & Calm Down (Sessions), each with its own cover & gradient", "Auto Sync — a GitHub Actions job now checks the audio repo every 30 minutes, adds new songs to the vault on its own (producer, alt names & year from metadata, gradient computed from the artwork), and repairs missing gradient keys on existing tracks", "IFPI / RIAA Copyright Information — a new /Copyright page inside Legal & Info covering rights-holder requests, ownership and non-affiliation", "Discord Rich Presence reports every track switch and keeps its progress honest after you scrub"],
    notes: "Auto Sync, 10 New Tracks & the IFPI / RIAA Copyright Page · 10 new tracks added — Floating, Heart Racing, Hop Out, Smith & Wesson, Royer (Sessions), The Party Never Ends (Sessions), Spanglish (Sessions), Cheat Code (Sessions), Time (Sessions) & Calm Down (Sessions), each with its own cover & gradient · Auto Sync — a GitHub Actions job now checks the audio repo every 30 minutes, adds new songs to the vault on its own (producer, alt names & year from metadata, gradient computed from the artwork), and repairs missing gradient keys on existing tracks · IFPI / RIAA Copyright Information — a new /Copyright page inside Legal & Info covering rights-holder requests, ownership and non-affiliation · Discord Rich Presence reports every track switch and keeps its progress honest after you scrub",
  },
  {
    version: "v4.5",
    title: "Friends & Messages, House Rules & Failed Projects",
    chips: ["Friends & Messages — add friends, see who is around, and hold private conversations, from a panel beside the Community menu", "House Rules — a Rules panel inside Friends & Messages: what is allowed, what to do if something goes wrong, and how to block or report someone", "Failed Projects — a new Community page collecting the features that were built and then dropped, and why each one went away, so the same dead ends do not get picked up twice", "The Rules panel locks the page behind it, and on phones the Friends & Messages panel does too, so neither can scroll out from under you"],
    notes: "Friends & Messages, House Rules & Failed Projects · Friends & Messages — add friends, see who is around, and hold private conversations, from a panel beside the Community menu · House Rules — a Rules panel inside Friends & Messages: what is allowed, what to do if something goes wrong, and how to block or report someone · Failed Projects — a new Community page collecting the features that were built and then dropped, and why each one went away, so the same dead ends do not get picked up twice · The Rules panel locks the page behind it, and on phones the Friends & Messages panel does too, so neither can scroll out from under you",
  },
  {
    version: "v4.4",
    title: "8 New Tracks, Roadmap & Discord Presence",
    notes: "Eight tracks joined the vault — Lean Wit' Me, Move The Bale, I Want It, Not Enough, Quitter, Wasted, Play Fair and Percs — each with its own cover and matching gradient. The Roadmap page arrived with a shareable link for every item. Discord Rich Presence was added, then corrected so it no longer lagged a track behind and so a paused song was reported as paused.",
  },
  {
    version: "v4.3",
    title: "Richer Profiles, Faster Player & Mobile Fixes",
    notes: "Profiles gained more detail and personality. The WRLD Player became faster through a virtualised track list — around 18 rows rendered in the page instead of all 281. The mobile player was rebuilt around touch-first controls, a draggable seek bar and swipe-down to close. The Info panel was relaid out for both desktop and mobile.",
  },
  {
    version: "v4.2",
    title: "Search, Recently Played & Server Playlists",
    notes: "Search began suggesting results as you type, and blocked or muted accounts were filtered out of results. Recently Played moved onto both profiles and the player, and the track Info panel grew richer. Playlists moved onto the server with sharing support, profile visibility controls were added, and monthly listening summaries appeared.",
  },
  {
    version: "v4.1",
    title: "Stats, Credits & Drops",
    notes: "The WRLD Stats page launched with plays, streaks, top tracks and rank. Track credits moved into their own modal. Drops and Events arrived with countdowns, reply alerts reached the notification bell, and search gained a trending strip and a command palette.",
  },
  {
    version: "v4.0",
    title: "Global Search Overhaul",
    notes: "Global search was overhauled. Its toggle moved next to the presence pill, and K, Ctrl+K or / opens a blurred search panel. Matches are highlighted, arrow keys navigate results, recent searches are remembered, suggestions-board results are included, and results carry grouped counts and a footer.",
  },
  {
    version: "v3.9",
    title: "Desktop Apps & Night Light",
    notes: "Desktop apps arrived for Windows, Mac and Linux with Discord Rich Presence integration. A Night Light toggle was added for easier listening in the dark, and nine new unreleased tracks joined the vault.",
  },
  {
    version: "v3.8",
    title: "Profile Page & 999 Cyan Theme",
    notes: "Profile became a page of its own, with playlists, favourites and analytics moved onto it. The account dashboard was cleaned into a single column, and 999 Cyan became the new default theme.",
  },
  {
    version: "v3.7",
    title: "Owner Dashboard",
    notes: "An owner dashboard was added behind a passcode. It gathers site-wide visit statistics, votes, replies, top tracks and linked Discord accounts in one place.",
  },
  {
    version: "v3.6",
    title: "Wanted Vault: 176 Tracks & Filters",
    notes: "The Wanted Vault was revamped with 176 unreleased tracks and sessions, including 69 session recordings reachable directly from their entries. Filter tabs for All, Leaks and Sessions were added alongside live search, and every track gained a direct play link.",
  },
  {
    version: "v3.5",
    title: "Wanted Vault on D1",
    notes: "The Wanted Vault became a live community space: votes, replies and nominations are now stored in the site's own database instead of only in the browser. Twenty more archive tracks were added, bringing the total to 36, each with a direct play link.",
  },
  {
    version: "v3.4",
    title: "Editable & Deletable Replies",
    notes: "Wanted Vault replies can now be edited and deleted by anyone, with pencil and trash controls on each reply.",
  },
  {
    version: "v3.3",
    title: "Wanted Vault Community Threads",
    notes: "The Wanted Vault was redesigned as a live community space. Votes reset to zero, every track gained reply threads and a direct play link, and the layout was made to work on both desktop and mobile.",
  },
  {
    version: "v3.2",
    title: "Wanted Vault Tab & Cover Credits",
    notes: "A new Wanted Vault tab let members vote on and nominate unreleased tracks. The cover-artist navigation arrows were fixed, and the Info panel no longer shows 'Cover made by N/A' when no credit is known.",
  },
  {
    version: "v3.1",
    title: "Player Categories & Nav Glass Fix",
    notes: "WRLD Player categories were fixed: the Sessions filter, tab state and a stale counter that read 219 now show the correct 241 tracks. The glitchy glass effect on the nav tabs was also fixed.",
  },
  {
    version: "v3.0",
    title: "WRLD LOG Popup",
    notes: "The WRLD LOG popup can now be opened by clicking the panel or pressing U. It closes only through its X button or the dedicated close button, so a stray click no longer dismisses it.",
  },
  {
    version: "v2.9",
    title: "8 New Tracks & Alt Names",
    notes: "Eight tracks were added — AP TikTok, Autograph, Carry It, K Like A Russian, Remind Me Of The Summer, Rental, Tales Of The Toxic and Talk Too Much. Alternate names were recorded for several songs, including Hope You Understand, Revenge In The Air and Let It Bust. Cover artwork moved to a stable host, the track catalogue was cleaned up, and two cover images were corrected.",
  },
  {
    version: "v2.8",
    title: "11 New Tracks & Hero Restore",
    notes: "Eleven tracks were added — Codeine Casket, Codeine Cobain v3, Codeine Guzzler, Codeine Music, Don't Go, Don't Know What I'm On, Lost Myself, Mr. Heartbreak, Rush, Wavy and Will. A category filter bug was fixed, the hero background was restored, cover credits were added for the new artwork, and Wavy gained the alternate name Last Time.",
  },
  {
    version: "v2.7",
    title: "Encoding & Shortcuts Cleanup",
    notes: "A full encoding cleanup removed 261 corrupted characters and doubled question marks across the site. Artist panel bullets were fixed, arrow-key shortcuts restored, legal text symbols corrected, one track renamed to I Wanna (Sessions) (AF), and password fields now use placeholder dots.",
  },
  {
    version: "v2.6",
    title: "Encoding Fixes & Rewritten Rules",
    notes: "Encoding corruption was fixed across every panel — Info, Vault, Keyboard Shortcuts, Footer, Rules, Comps, the legal pages and Credits. The Rules panel was rewritten with sixteen rules, arrows were replaced with HTML entities, rule overflow was contained, and cover-art separators were cleaned up.",
  },
  {
    version: "v2.5",
    title: "Mobile Overhaul & Player Revamp",
    notes: "A mobile-friendly overhaul covered viewport height, touch targets, landscape, scrollbars and overflow safety. Queue animations were added with staggered entry, slide-out removal and a badge pop. The player panel was rebuilt with new transport controls, a progress bar, vinyl, a mini-player and a blank state. The legal pages were refreshed, lyrics were removed, and one more track was added.",
  },
  {
    version: "v2.4",
    title: "Glassmorphism & Style Cleanup",
    notes: "Visual polish across the site: glassmorphism was applied to every panel, inline styles were reduced from 93 to 62, and the artist, captcha and lightbox CSS was cleaned up.",
  },
  {
    version: "v2.3",
    title: "Missing Tracks & Streaming",
    notes: "Missing tracks were added — Devil Horns in its Sessions and v1 takes, and Emotional Overdose in its Sessions and v2 takes. The join panel was refreshed, playback moved to a new streaming source, and the 'recorded' field was renamed to 'year'.",
  },
  {
    version: "v2.2",
    title: "Favorites & Cover Glow",
    notes: "A favourites and likes system was added, along with cover glow and zoom, shifting background gradients and graceful handling of missing files. Scroll arrows were removed, the info button moved, and a vault tab bug was fixed.",
  },
  {
    version: "v2.1",
    title: "Cloudflare & Emoji Fixes",
    notes: "Protocol handling was corrected for the hosted site, emoji corruption was fixed, and gradients now render correctly over HTTPS.",
  },
  {
    version: "v2.0",
    title: "Year, Producer & Era Descriptions",
    notes: "Year and producer metadata was corrected, era descriptions became clickable, the Info panel now hides when switching tabs, and a syntax error in the track catalogue was fixed.",
  },
  {
    version: "v1.9",
    title: "Gold Aesthetic & Vault Stats",
    notes: "A gold-accented look arrived alongside the vault statistics page.",
  },
  {
    version: "v1.8",
    title: "Real Cover Gradients",
    notes: "Cover gradients were derived from the real artwork instead of fixed colours, and text readability was improved throughout.",
  },
  {
    version: "v1.7",
    title: "Nine Missing Tracks",
    notes: "Nine missing tracks were added, including Bottle, Dukes, Haze, Heavy and The Race.",
  },
  {
    version: "v1.6",
    title: "Comps List Expanded",
    notes: "The compilations list grew from 26 to 61 entries across all categories.",
  },
  {
    version: "v1.5",
    title: "Captcha, Home Cards & Mobile Support",
    notes: "Captcha protection was added, the home tab gained cards for the main sections, and basic mobile support arrived.",
  }
];
