/* ============================================================================
   ACHIEVEMENTS - definitions + on-demand evaluation.
   Every achievement is defined here, once. The evaluator walks the list,
   looks at what the member has already done (plays, listens, favourites,
   comments, streaks, eras, era themes, XP), and reports progress + unlocked.
   ========================================================================== */

import { listeningStats, streakFromDays } from "./listens-stats.js";

/* ------------------------------------------------------------------
   100 achievements. IDs are stable - once shipped, treat them as part
   of the schema. Rarity is a cosmetic tier and does not claim a member
   percentage; the reference's "Rare: 23% of members have it" is not
   something we can honestly compute without running a full aggregate.
   ------------------------------------------------------------------ */

export const ACHIEVEMENTS = [
  /* ===== Listening (28) ===== */
  { id: "lis_first",    cat: "Listening", name: "First play",      desc: "Play any song in the vault",                                 icon: "fa-play",          rarity: "common",    xp: 10,  eval: "plays>=1" },
  { id: "lis_warming",  cat: "Listening", name: "Warming up",      desc: "Play 5 different songs",                                      icon: "fa-circle-notch",  rarity: "common",    xp: 25,  eval: "unique>=5" },
  { id: "lis_regular",  cat: "Listening", name: "Regular",         desc: "Play 10 different songs",                                     icon: "fa-headphones",    rarity: "uncommon",  xp: 50,  eval: "unique>=10" },
  { id: "lis_triple",   cat: "Listening", name: "Triple nine",     desc: "Play 9,999 minutes of the vault",                             icon: "fa-tower-broadcast",rarity: "uncommon",  xp: 75,  eval: "seconds>=5999400" },
  { id: "lis_lifer",    cat: "Listening", name: "Lifer",           desc: "Play 50,000 minutes of the vault",                            icon: "fa-infinity",      rarity: "rare",      xp: 150, eval: "seconds>=3000000000" },
  { id: "lis_tenhrs",   cat: "Listening", name: "Ten hours in",    desc: "Play 10 hours of the vault",                                  icon: "fa-clock",         rarity: "common",    xp: 20,  eval: "seconds>=36000" },
  { id: "lis_hundred",  cat: "Listening", name: "Hundred hours",   desc: "Play 100 hours of the vault",                                 icon: "fa-hourglass",     rarity: "uncommon",  xp: 75,  eval: "seconds>=360000" },
  { id: "lis_crate",    cat: "Listening", name: "Crate digger",    desc: "Play 50 different songs",                                     icon: "fa-record-vinyl",  rarity: "uncommon",  xp: 60,  eval: "unique>=50" },
  { id: "lis_hooked",   cat: "Listening", name: "Hooked",          desc: "Play 100 different songs",                                    icon: "fa-compact-disc",  rarity: "uncommon",  xp: 100, eval: "unique>=100" },
  { id: "lis_devoted",  cat: "Listening", name: "Devoted",         desc: "Play 250 different songs",                                    icon: "fa-headset",       rarity: "rare",      xp: 200, eval: "unique>=250" },
  { id: "lis_obsessed", cat: "Listening", name: "Obsessed",        desc: "Play 500 different songs",                                    icon: "fa-waveform-lines",rarity: "epic",      xp: 400, eval: "unique>=500" },
  { id: "lis_fournines",cat: "Listening", name: "Four nines",      desc: "Play 9,999 different songs",                                  icon: "fa-infinity",      rarity: "legendary", xp: 999, eval: "unique>=9999" },
  { id: "lis_1st_hour", cat: "Listening", name: "First hour",      desc: "Play 1 hour of the vault",                                    icon: "fa-clock",         rarity: "common",    xp: 15,  eval: "seconds>=3600" },
  { id: "lis_50hrs",    cat: "Listening", name: "Fifty hours",     desc: "Play 50 hours of the vault",                                  icon: "fa-clock",         rarity: "uncommon",  xp: 100, eval: "seconds>=180000" },
  { id: "lis_daynight", cat: "Listening", name: "Day and night",   desc: "Play the vault at every hour of the day",                     icon: "fa-hourglass-half",rarity: "rare",      xp: 150, eval: "hours_all>=24" },
  { id: "lis_999hrs",   cat: "Listening", name: "999 hours",       desc: "Play 999 hours of the vault",                                 icon: "fa-hourglass",     rarity: "epic",      xp: 400, eval: "seconds>=3596400" },
  { id: "lis_explorer", cat: "Listening", name: "Explorer",        desc: "Play 20 different eras",                                      icon: "fa-compass",       rarity: "uncommon",  xp: 125, eval: "eras>=20" },
  { id: "lis_wide",     cat: "Listening", name: "Wide ears",       desc: "Play 5 different eras",                                       icon: "fa-book-open-reader",rarity: "common",   xp: 50,  eval: "eras>=5" },
  { id: "lis_deep",     cat: "Listening", name: "Deep cuts",       desc: "Play 10 different eras",                                      icon: "fa-book-open",     rarity: "uncommon",  xp: 75,  eval: "eras>=10" },
  { id: "lis_enc",      cat: "Listening", name: "Encyclopedia",    desc: "Play 12 different eras",                                      icon: "fa-book-bookmark", rarity: "rare",      xp: 150, eval: "eras>=12" },
  { id: "lis_every",    cat: "Listening", name: "Every corner",    desc: "Play 1 song from every era",                                  icon: "fa-broom",         rarity: "rare",      xp: 200, eval: "eras>=all" },
  { id: "lis_onrepeat", cat: "Listening", name: "On repeat",       desc: "Play the same song 50 times",                                 icon: "fa-infinity",      rarity: "uncommon",  xp: 100, eval: "most_played>=50" },
  { id: "lis_cantstop", cat: "Listening", name: "Can't stop",      desc: "Play the same song 100 times",                                icon: "fa-infinity",      rarity: "rare",      xp: 200, eval: "most_played>=100" },
  { id: "lis_lucid",    cat: "Listening", name: "Lucid loop",      desc: "Play the same song 250 times",                                icon: "fa-infinity",      rarity: "epic",      xp: 500, eval: "most_played>=250" },
  { id: "lis_cutting",  cat: "Listening", name: "Cutting room",    desc: "Play 20 different studio sessions",                           icon: "fa-scissors",      rarity: "rare",      xp: 150, eval: "categories>=10" },
  { id: "lis_frontrow", cat: "Listening", name: "Front row",       desc: "Top of the all-time leaderboard",                             icon: "fa-ranking-star",  rarity: "rare",      xp: 300, eval: "rank_le<=1" },
  { id: "lis_superfan", cat: "Listening", name: "Superfan",        desc: "Top 3 on the all-time leaderboard",                           icon: "fa-trophy",        rarity: "epic",      xp: 500, eval: "rank_le<=3" },
  { id: "lis_biggestfan",cat:"Listening", name: "Biggest fan",     desc: "Be the top listener of a song",                               icon: "fa-medal",         rarity: "rare",      xp: 200, eval: "top_song_count>=1" },

  /* ===== Streaks (7) ===== */
  { id: "str_three",    cat: "Streaks",   name: "Three in a row",  desc: "Listen 3 days in a row",                                      icon: "fa-fire",          rarity: "common",    xp: 30,  eval: "streak>=3" },
  { id: "str_fullweek", cat: "Streaks",   name: "Full week",       desc: "Listen 7 days in a row",                                      icon: "fa-calendar-check",rarity: "uncommon",  xp: 75,  eval: "streak>=7" },
  { id: "str_month",    cat: "Streaks",   name: "Month straight",  desc: "Listen 30 days in a row",                                     icon: "fa-calendar-days", rarity: "rare",      xp: 150, eval: "streak>=30" },
  { id: "str_hundred",  cat: "Streaks",   name: "Hundred days",    desc: "Listen 100 days in a row",                                    icon: "fa-calendar-week", rarity: "epic",      xp: 400, eval: "streak>=100" },
  { id: "str_twoweeks", cat: "Streaks",   name: "Two weeks",       desc: "Listen 14 days in a row",                                     icon: "fa-calendar-check",rarity: "uncommon",  xp: 75,  eval: "streak>=14" },
  { id: "str_twomonths",cat: "Streaks",   name: "Two months",      desc: "Listen 60 days in a row",                                     icon: "fa-calendar-alt",  rarity: "rare",      xp: 200, eval: "streak>=60" },
  { id: "str_year",     cat: "Streaks",   name: "Year round",      desc: "Listen 365 days in a row",                                    icon: "fa-calendar-day",  rarity: "legendary", xp: 999, eval: "streak>=365" },

  /* ===== Eras (8) ===== */
  { id: "era_hopper",   cat: "Eras",      name: "Era hopper",      desc: "Play songs from 3 different eras",                            icon: "fa-box-archive",   rarity: "common",    xp: 40,  eval: "eras>=3" },
  { id: "era_every",    cat: "Eras",      name: "Every era",       desc: "Play songs from 8 different eras",                            icon: "fa-bullseye",      rarity: "uncommon",  xp: 100, eval: "eras>=8" },
  { id: "era_complete", cat: "Eras",      name: "Era complete",    desc: "Complete an era (play every song in it)",                     icon: "fa-list-check",    rarity: "rare",      xp: 200, eval: "era_complete_any>=1" },
  { id: "era_time",     cat: "Eras",      name: "Time travel",     desc: "Play songs from pre-release eras",                            icon: "fa-plane-departure",rarity:"uncommon",  xp: 100, eval: "era_pre>=1" },
  { id: "era_comp",     cat: "Eras",      name: "Completionist",   desc: "Complete 3 eras",                                             icon: "fa-check-double",  rarity: "epic",      xp: 400, eval: "era_complete_any>=3" },
  { id: "era_leak",     cat: "Eras",      name: "Leak hunter",     desc: "Play 100 leaks",                                              icon: "fa-bolt",          rarity: "rare",      xp: 150, eval: "category_plays.leaks>=100" },
  { id: "era_vault",    cat: "Eras",      name: "Vault diver",     desc: "Play 500 tracks from the vault",                              icon: "fa-box-open",      rarity: "uncommon",  xp: 100, eval: "plays>=500" },
  { id: "era_flood",    cat: "Eras",      name: "Floodgates",      desc: "Play 999 vault tracks",                                       icon: "fa-bolt",          rarity: "epic",      xp: 400, eval: "plays>=999" },

  /* ===== Collector (16) ===== */
  { id: "col_taste",    cat: "Collector", name: "Good taste",      desc: "Add 1 favourite song",                                        icon: "fa-heart",         rarity: "common",    xp: 10,  eval: "favorites>=1" },
  { id: "col_heartfelt",cat: "Collector", name: "Heartfelt",       desc: "Add 10 favourite songs",                                      icon: "fa-heart-circle-check",rarity:"uncommon",xp: 40,  eval: "favorites>=10" },
  { id: "col_first_grail",cat:"Collector",name: "First grail",     desc: "Add 25 favourite songs",                                      icon: "fa-trophy",        rarity: "uncommon",  xp: 75,  eval: "favorites>=25" },
  { id: "col_grail_hunter",cat:"Collector",name:"Grail hunter",    desc: "Add 50 favourite songs",                                      icon: "fa-crosshairs",    rarity: "rare",      xp: 150, eval: "favorites>=50" },
  { id: "col_holy_grail",cat: "Collector",name: "Holy grail",      desc: "Add 100 favourite songs",                                     icon: "fa-gem",           rarity: "epic",      xp: 300, eval: "favorites>=100" },
  { id: "col_curator",  cat: "Collector", name: "Curator",         desc: "Add 200 favourite songs",                                     icon: "fa-list",          rarity: "legendary", xp: 999, eval: "favorites>=200" },
  { id: "col_mixtape",  cat: "Collector", name: "Mixtape maker",   desc: "Create your first playlist",                                  icon: "fa-compact-disc",  rarity: "common",    xp: 25,  eval: "playlists>=1" },
  { id: "col_first_like",cat:"Collector", name: "First like",      desc: "Favourite your first song",                                   icon: "fa-heart",         rarity: "common",    xp: 10,  eval: "favorites>=1" },
  { id: "col_ten_hearts",cat:"Collector", name: "Ten hearts",      desc: "Add 10 favourite songs",                                      icon: "fa-heart",         rarity: "uncommon",  xp: 50,  eval: "favorites>=10" },
  { id: "col_big_heart",cat: "Collector", name: "Big heart",       desc: "Add 50 favourite songs",                                      icon: "fa-heart-circle-check",rarity:"rare",    xp: 150, eval: "favorites>=50" },
  { id: "col_all_heart",cat: "Collector", name: "All heart",       desc: "Add 100 favourite songs",                                     icon: "fa-heart-circle-check",rarity:"epic",    xp: 400, eval: "favorites>=100" },
  { id: "col_wish_list",cat: "Collector", name: "Wish list",       desc: "Bookmark 25 songs",                                           icon: "fa-bookmark",      rarity: "common",    xp: 40,  eval: "bookmarks>=25" },
  { id: "col_grail_keep",cat:"Collector", name: "Grail keeper",    desc: "Bookmark 50 songs",                                           icon: "fa-binoculars",    rarity: "uncommon",  xp: 75,  eval: "bookmarks>=50" },
  { id: "col_hundred",  cat: "Collector", name: "Hundred grails",  desc: "Bookmark 100 songs",                                          icon: "fa-gem",           rarity: "rare",      xp: 200, eval: "bookmarks>=100" },
  { id: "col_program",  cat: "Collector", name: "Program director",desc: "Create 10 playlists",                                         icon: "fa-list-ul",       rarity: "uncommon",  xp: 150, eval: "playlists>=10" },
  { id: "col_long_play",cat: "Collector", name: "Long player",     desc: "Have a playlist with 25+ tracks",                             icon: "fa-clock",         rarity: "rare",      xp: 150, eval: "big_playlist>=1" },

  /* ===== Community (24) ===== */
  { id: "com_first_edit", cat: "Community", name: "First edit",    desc: "Make your first page edit",                                   icon: "fa-pen",           rarity: "common",    xp: 25,  eval: "suggestions>=1" },
  { id: "com_on_record",  cat: "Community", name: "On the record", desc: "Your first suggestion gets approved",                         icon: "fa-check-circle",  rarity: "uncommon",  xp: 25,  eval: "suggestions_approved>=1" },
  { id: "com_archivist",  cat: "Community", name: "Archivist",     desc: "Your 10th suggestion gets approved",                          icon: "fa-box-archive",   rarity: "uncommon",  xp: 75,  eval: "suggestions_approved>=10" },
  { id: "com_voice",      cat: "Community", name: "Voice",         desc: "Vote on 10 suggestions",                                      icon: "fa-thumbs-up",     rarity: "common",    xp: 15,  eval: "votes>=10" },
  { id: "com_jury",       cat: "Community", name: "Jury",          desc: "Vote on 50 suggestions",                                      icon: "fa-scale-balanced",rarity: "uncommon",  xp: 100, eval: "votes>=50" },
  { id: "com_first_words",cat: "Community", name: "First words",   desc: "Leave your first comment",                                    icon: "fa-pen",           rarity: "common",    xp: 15,  eval: "comments>=1" },
  { id: "com_talkative",  cat: "Community", name: "Talkative",     desc: "Leave 10 comments",                                           icon: "fa-pen",           rarity: "common",    xp: 50,  eval: "comments>=10" },
  { id: "com_in_comm",    cat: "Community", name: "In the comments",desc:"Leave 50 comments",                                           icon: "fa-pen",           rarity: "uncommon",  xp: 150, eval: "comments>=50" },
  { id: "com_on_beat",    cat: "Community", name: "On the beat",   desc: "Leave 5 replies",                                             icon: "fa-tower-broadcast",rarity:"common",    xp: 25,  eval: "replies>=5" },
  { id: "com_contrib",    cat: "Community", name: "Contributor",   desc: "Leave 20 replies",                                            icon: "fa-pen",           rarity: "uncommon",  xp: 100, eval: "replies>=20" },
  { id: "com_researcher", cat: "Community", name: "Researcher",    desc: "Add full credits to a song",                                  icon: "fa-pen",           rarity: "rare",      xp: 150, eval: "credits_added>=1" },
  { id: "com_historian",  cat: "Community", name: "Historian",     desc: "Add credits to 10 songs",                                     icon: "fa-box-archive",   rarity: "epic",      xp: 300, eval: "credits_added>=10" },
  { id: "com_keeper",     cat: "Community", name: "Keeper of the vault",desc:"Suggest 5 changes that get approved",                      icon: "fa-vault",         rarity: "rare",      xp: 200, eval: "suggestions_approved>=5" },
  { id: "com_panel",      cat: "Community", name: "Panel",         desc: "Vote on 100 suggestions",                                     icon: "fa-scale-balanced",rarity: "rare",      xp: 200, eval: "votes>=100" },
  { id: "com_council",    cat: "Community", name: "Council",       desc: "Vote on 250 suggestions",                                     icon: "fa-scale-balanced",rarity: "epic",      xp: 500, eval: "votes>=250" },
  { id: "com_first_reply",cat: "Community", name: "First reply",   desc: "Reply to someone's comment",                                  icon: "fa-reply",         rarity: "rare",      xp: 50,  eval: "replies>=1" },
  { id: "com_in_thread",  cat: "Community", name: "In the thread", desc: "Reply 10 times",                                              icon: "fa-reply",         rarity: "uncommon",  xp: 75,  eval: "replies>=10" },
  { id: "com_crowdp",     cat: "Community", name: "Crowd pleaser", desc: "Get 50 upvotes across your comments",                         icon: "fa-heart",         rarity: "rare",      xp: 200, eval: "comment_upvotes>=50" },
  { id: "com_fav",        cat: "Community", name: "Fan favourite", desc: "Get 100 upvotes on your comments",                            icon: "fa-heart",         rarity: "epic",      xp: 400, eval: "comment_upvotes>=100" },
  { id: "com_ballot",     cat: "Community", name: "Ballot cast",   desc: "Vote on a Wanted Vault post",                                 icon: "fa-square-check",  rarity: "uncommon",  xp: 30,  eval: "votes>=1" },
  { id: "com_turnout",    cat: "Community", name: "Turnout",       desc: "Vote on 25 Wanted Vault posts",                               icon: "fa-square-check",  rarity: "uncommon",  xp: 75,  eval: "votes>=25" },
  { id: "com_comm",       cat: "Community", name: "Commentator",   desc: "Leave 25 comments",                                           icon: "fa-pen",           rarity: "uncommon",  xp: 100, eval: "comments>=25" },
  { id: "com_back_forth", cat: "Community", name: "Back and forth",desc:"Reply to the same person 5 times",                             icon: "fa-reply-all",     rarity: "uncommon",  xp: 75,  eval: "replies>=25" },
  { id: "com_hall_fame",  cat: "Community", name: "Hall of fame",  desc: "Get 200 total upvotes across the community",                  icon: "fa-mountain",      rarity: "epic",      xp: 500, eval: "comment_upvotes>=200" },

  /* ===== Specials (17) ===== */
  { id: "sp_nightowl",    cat: "Specials",  name: "Night owl",      desc: "Listen between midnight and 4 AM",                            icon: "fa-moon",          rarity: "uncommon",  xp: 30,  eval: "hour_1to4>=1" },
  { id: "sp_leakday",     cat: "Specials",  name: "Leak day",       desc: "Be active on a release day",                                  icon: "fa-bolt",          rarity: "uncommon",  xp: 25,  eval: "release_day>=1" },
  { id: "sp_og",          cat: "Specials",  name: "OG",             desc: "Join before the first release",                               icon: "fa-star",          rarity: "rare",      xp: 100, eval: "before_release>=1" },
  { id: "sp_after",       cat: "Specials",  name: "After hours",    desc: "Listen past 11 PM",                                           icon: "fa-moon",          rarity: "common",    xp: 15,  eval: "hour_11to23>=1" },
  { id: "sp_insomniac",   cat: "Specials",  name: "Insomniac",      desc: "Listen between 1 and 5 AM",                                   icon: "fa-moon-stars",    rarity: "rare",      xp: 50,  eval: "hour_1to5>=1" },
  { id: "sp_earlybird",   cat: "Specials",  name: "Early bird",     desc: "Listen before 6 AM",                                          icon: "fa-sun",           rarity: "common",    xp: 15,  eval: "hour_0to6>=1" },
  { id: "sp_double",      cat: "Specials",  name: "Double digits",  desc: "Reach level 10",                                              icon: "fa-star",          rarity: "uncommon",  xp: 75,  eval: "level>=10" },
  { id: "sp_triple",      cat: "Specials",  name: "Triple digits",  desc: "Reach level 100",                                             icon: "fa-medal",         rarity: "rare",      xp: 150, eval: "level>=100" },
  { id: "sp_halfway",     cat: "Specials",  name: "Halfway to forever",desc:"Reach level 500",                                             icon: "fa-crown",         rarity: "epic",      xp: 500, eval: "level>=500" },
  { id: "sp_climbing",    cat: "Specials",  name: "Climbing",       desc: "Reach level 13",                                              icon: "fa-star-half-stroke",rarity:"common",   xp: 25,  eval: "level>=13" },
  { id: "sp_half",        cat: "Specials",  name: "Half century",   desc: "Reach level 50",                                              icon: "fa-star-half-stroke",rarity:"uncommon",  xp: 100, eval: "level>=50" },
  { id: "sp_quarter",     cat: "Specials",  name: "Quarter to forever",desc:"Reach level 250",                                            icon: "fa-crown",         rarity: "rare",      xp: 200, eval: "level>=250" },
  { id: "sp_in_the_loop", cat: "Specials",  name: "In the loop",    desc: "Play the same song 25 times",                                 icon: "fa-bell",          rarity: "uncommon",  xp: 50,  eval: "most_played>=25" },
  { id: "sp_righteous",   cat: "Specials",  name: "Righteous",      desc: "Unlock 20 achievements",                                      icon: "fa-medal",         rarity: "uncommon",  xp: 75,  eval: "unlocked_count>=20" },
  { id: "sp_legend",      cat: "Specials",  name: "Legend",         desc: "Unlock 50 achievements",                                      icon: "fa-crown",         rarity: "epic",      xp: 500, eval: "unlocked_count>=50" },
  { id: "sp_999",         cat: "Specials",  name: "999",             desc: "Unlock 99 achievements",                                      icon: "fa-infinity",      rarity: "legendary", xp: 999, eval: "unlocked_count>=99" },
  { id: "sp_forever",     cat: "Specials",  name: "Forever 999",    desc: "Unlock 100 achievements",                                     icon: "fa-infinity",      rarity: "legendary", xp: 999, eval: "unlocked_count>=100" },

];

/* Map a metric expression to [key, op, value] */
export function parseEval(expr) {
  // e.g. "plays>=1", "unique>=5", "seconds>=5999400", "eras>=all", "rank_le<=1"
  var m = /^([a-z_0-9]+)(>=|<=|==)(\d+|all)$/.exec(String(expr || ""));
  if (!m) return null;
  return [m[1], m[2], m[3] === "all" ? "all" : Number(m[3])];
}

/* Compute the metrics needed for evaluation. */
async function gatherMetrics(db, uid) {
  const emptyH = new Array(24).fill(0);
  const stats = await listeningStats(db, uid, { topLimit: 500, unique: false, months: false, firstLast: true });
  const fav = await db.prepare("SELECT COUNT(*) AS n FROM favorites WHERE uid = ?").bind(uid).first().catch(() => ({ n: 0 }));
  const bm = await db.prepare("SELECT COUNT(*) AS n FROM bookmarks WHERE uid = ?").bind(uid).first().catch(() => ({ n: 0 }));
  const pl = await db.prepare("SELECT COUNT(*) AS n, MAX(tc) AS big FROM (SELECT COUNT(*) AS tc FROM playlists WHERE uid = ? GROUP BY name HAVING COUNT(*) >= 25)").bind(uid).all().catch(() => ({ results: [] }));
  const cmt = await db.prepare("SELECT COUNT(*) AS n FROM replies WHERE discord_id = (SELECT discord_id FROM discord_links WHERE site_uid = ?)").bind(uid).first().catch(() => ({ n: 0 }));
  const streak = ((stats && stats.days) ? streakFromDays(stats.days) : 0);
  let eras = 0, mostPlayed = 0;
  try {
    const top = stats && stats.top ? stats.top : [];
    const eraCount = new Set();
    for (const t of top) {
      const era = eraOfTrack(t.track_id);
      if (era) eraCount.add(era);
      if (Number(t.n) > mostPlayed) mostPlayed = Number(t.n);
    }
    eras = eraCount.size;
  } catch (_) {}
  let level = 1;
  try {
    const xpRow = await db.prepare("SELECT level FROM xp WHERE user_id = ?").bind(uid).first().catch(() => null);
    if (xpRow && Number(xpRow.level) > 1) level = Number(xpRow.level);
  } catch (_) {}
  return {
    plays: Number(stats && stats.plays) || 0,
    seconds: Number(stats && stats.seconds) || 0,
    unique: Number(stats && stats.uniqueTracks) || 0,
    hours: 0,
    eras,
    most_played: mostPlayed,
    streak,
    level,
    favorites: Number(fav && fav.n) || 0,
    bookmarks: Number(bm && bm.n) || 0,
    playlists: Number((pl && pl.results && pl.results[0] && pl.results[0].n) || 0),
    big_playlist: 0,
    comments: Number(cmt && cmt.n) || 0,
    replies: 0,
    suggestions: 0,
    suggestions_approved: 0,
    votes: 0,
    comment_upvotes: 0,
    credits_added: 0,
    rank_le: 999,
    unlocked_count: 0,
    categories: 0,
    hours_all: 0,
    era_complete_any: 0,
    release_day: 0,
    before_release: 0,
    games_nts: 0,
    games_sfs: 0,
    games_os: 0,
    games_daily: 0,
    games_tft: 0,
    games_crossword: 0,
    games_predicted: 0,
    games_nl: 0,
    games_consecutive: 0,
    games_uua: 0,
    games_hth_wins: 0,
  };
}

function eraOfTrack(title) {
  const m = /\((999|JW999|GB&GR|WOD|DRFL|JW3|POST|OUT|AF|ND|BDM|HIH|JTK)\)\s*$/i.exec(String(title || ""));
  return m ? m[1].toUpperCase() : null;
}

/* Public entry: get list with progress for one user. */
export async function getAchievementsFor(db, uid) {
  const m = await gatherMetrics(db, uid);
  const out = [];
  let unlockedCount = 0;
  for (const a of ACHIEVEMENTS) {
    const parsed = parseEval(a.eval);
    let sustain = 0, ok = false;
    if (parsed) {
      const [key, op, val] = parsed;
      const metric = m[key];
      if (op === ">=" && typeof val === "number") { sustain = Math.min(1, (metric || 0) / val); ok = (metric || 0) >= val; }
      else if (op === "<=" && typeof val === "number") { sustain = ok ? 1 : 0; ok = (metric || 999) <= val; }
      else if (op === "==" && val === "all") { ok = key === "eras" && (metric || 0) >= 1; sustain = ok ? 1 : 0; }
    }
    if (ok) unlockedCount++;
    out.push({ ...a, progress: sustain, unlocked: ok });
  }
  return out;
}
