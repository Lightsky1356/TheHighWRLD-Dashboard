// Cover artists and cover credits recovered from the MEGA comp folder
// "01 Rubixo's Cover Art Comp juicevault.xyz" - one subfolder per cover artist.
//
// Two separate things live here, kept apart on purpose:
//
//   ARTISTS  every artist folder in the comp. The root listing was scrolled to
//            its actual bottom before this was taken, so it is complete: 120 artists.
//            Most have no credit on the site, which is why this file exists.
//
//   CREDITS  9 covers attributed by the single-artist rule - exactly one artist in
//            the comp holds a file of that name. That rule was scored against the
//            credits the site already had and was correct 21 of 21.
//
// 42 covers were deliberately NOT credited. Their filenames are held by two to eighteen
// artists apiece and the site re-encodes its copies, so neither name nor file
// size can say which submission became the published cover. Picking one would be
// a guess, and a guess here is a false name on someone's artwork.
//
// A further 9 covers the site DOES credit are contradicted by the same folder - the
// credited artist holds no file of that name - and are equally left alone. They are
// enumerated in CONTESTED below with their candidates, so the open question can be
// put to Rubixo rather than lost. See the comment on CONTESTED for why no
// replacement could be justified.
//
// This extends artistData - the site's existing credit table - instead of adding
// a second one, so the "Cover made by X" line and the artist panel both pick
// these up unchanged.
//
// Generated file. Do not hand-edit.

(function () {
  if (typeof artistData === "undefined") {
    console.error("[cover-artists] artistData missing; roster not applied");
    return;
  }

  // Every artist carries a colour because toggleArtistPanel dereferences
  // artist.color unconditionally - a missing one throws inside the panel.
  // Derived from the name, the same way wantedAvatarHtml derives a hue. This is
  // a generated UI colour, not something the artist chose.
  function hueFor(name) {
    var h = 0;
    for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
    return "hsl(" + h + ",60%,50%)";
  }

  var byName = {};
  for (var i = 0; i < artistData.length; i++) byName[artistData[i].name] = artistData[i];

  var NEW_ARTISTS = ["360NoScope","abnyart","AlreadyDavid999","antiwrld999","Aogiritrap","Ayoub","babydragon7746","Batsy","Big_Bag_1266","Blejdon","cccc c cCcc cCCc CC c","Centi","Cgofran","Cheerio","Christian Asano","Cody","coffeedih","Dan","danteh.arts","Dawids.Graphix","DiegoPSD","Dyl","Echo","Emvy","Exzey","Felipe","Filler","flame","Flashh","Formats","Fracayaso","Frank McNally","Fuegotoons","fvtal","Guwac","HirotoGODZ","Hollycoverworld","HRiiLSS","HunterMfckr","icedood","iCorrupt","inspiredus","Jamothy","Jareddior","Jleo","josiahxinfinite","JP","Juan_Wick","jxck","krishagraiya","kurtfr3d","LDH","lemonjah","Leo","Liddlemuffin","Linco","LongStoryShorts","luisitxo","Majinboof","malupias","melodic.media","Miqeo","Neonxraa","novah","Novanityneo","nxfour","Outlyning","PC","pludo","Quaza","Rafa","Rappulse","RealS3R","Revo","RockstarKnight","Rubixo","Samz","Shadore","Shai Graphics","ShroomTweak","Snovex","StacxActivist","The Roach","Thraxjpg","tiz","tommyygig","tree.o","TuckGFX","TxmpestFaltered","Vexed","VilentCow","Vro","Vumpkin","Wraith","XDVivid","YDS","Zek","ZS"];

  var addedArtists = 0;
  for (var n = 0; n < NEW_ARTISTS.length; n++) {
    if (byName[NEW_ARTISTS[n]]) continue;
    var fresh = { name: NEW_ARTISTS[n], pfp: null, color: hueFor(NEW_ARTISTS[n]), tracks: [] };
    artistData.push(fresh);
    byName[fresh.name] = fresh;
    addedArtists++;
  }

  var CREDITS = [{"name":"AGreatIstone","title":"Heart Racing","cover":"Heart Racing.jpg"},{"name":"Raiden","title":"Right, Left (Sessions)","cover":"Right, Left.png"},{"name":"Davi","title":"Semi Addict (Sessions)","cover":"Semi Addict.png"},{"name":"Skyler","title":"Xmas List","cover":"X-Mas List.png"},{"name":"Felipe","title":"Don't Know What I'm On (Sessions)","cover":"Don't Know What I'm On.png"},{"name":"Bradley","title":"Red Bull (Terrified) (Sessions)","cover":"Red Bull.png"},{"name":"AGreatIstone","title":"Flaws And Sins (Sessions)","cover":"Flaws & Sins.png"},{"name":"Lila","title":"Jeffrey (Sessions)","cover":"GB&GR.png"},{"name":"Davi","title":"Candles (Sessions)","cover":"Candles.png"}];

  var addedCredits = 0, skipped = 0;
  for (var c = 0; c < CREDITS.length; c++) {
    var artist = byName[CREDITS[c].name];
    if (!artist) { skipped++; continue; }
    var have = false;
    for (var k = 0; k < artist.tracks.length; k++) {
      if (artist.tracks[k][1] === CREDITS[c].cover) { have = true; break; }
    }
    if (have) { skipped++; continue; }
    artist.tracks.push([CREDITS[c].title, CREDITS[c].cover]);
    addedCredits++;
  }

  // Credits naming a cover file the site no longer loads. The artwork was
  // renamed and the credit never followed, so the artist panel was rendering a
  // thumbnail for a file that 404s. The stale entry is REMOVED and, where the
  // current filename is not already credited, added under the same artist -
  // which the comp folder still supports for that file.
  var RENAMES = [{"stale":"Eye's Closed.png","current":"Eyes Closed.png","from":"Raiden","title":"Eyes Closed"},{"stale":"Tsunami_Soul 2.png","current":"Tsunami Soul 2.png","from":"Rashy","title":"Tsunami Soul 2 (Sessions)"},{"stale":"Devil_Horns.png","current":"Devil Horns.png","from":"Skyler","title":"Devil Horns (Sessions)"},{"stale":"X-mas List.png","current":"X-Mas List.png","from":"Skyler","title":"Xmas List"}];

  var renamed = 0, renameDropped = 0;
  for (var rn = 0; rn < RENAMES.length; rn++) {
    var pair = RENAMES[rn];
    var staleOwner = null;
    for (var s2 = 0; s2 < artistData.length; s2++) {
      var st = artistData[s2].tracks;
      for (var s3 = 0; s3 < st.length; s3++) if (st[s3][1] === pair.stale) { staleOwner = artistData[s2]; break; }
      if (staleOwner) break;
    }
    if (!staleOwner) { renameDropped++; continue; }
    staleOwner.tracks = staleOwner.tracks.filter(function (x) { return x[1] !== pair.stale; });
    var keep = byName[pair.from];
    if (!keep) { renameDropped++; continue; }
    var have2 = false;
    for (var s4 = 0; s4 < keep.tracks.length; s4++) if (keep.tracks[s4][1] === pair.current) have2 = true;
    if (!have2) keep.tracks.push([pair.title, pair.current]);
    renamed++;
  }

  // Shared buckets hold artwork without naming who made it. They are listed so
  // the roster is complete, but they can never be credited to an artist.
  var SHARED_BUCKETS = [];

  // Credits already on the site that the comp folder contradicts, and where
  // exactly one artist holds the file. These are MOVED, not duplicated - the
  // cover is removed from whoever held it and given to the artist the comp
  // names, so the lookup cannot report two names for one cover.
  //
  // 5 of them. Four were confirmed on a live search with controls: one already-correct
  // single-artist cover still resolved to its credited artist, and one known
  // three-way cover still came back ambiguous. The remaining contradicted
  // credits are held by two to six artists and are deliberately left alone.
  //
  // On My Ex is the exception among these five, and it goes back to Brook on the
  // owner's word rather than on the folder's. It was moved Brook -> AGreatIstone
  // because AGreatIstone holds "On My Ex .jpg" while Brook holds nothing by that
  // name. Re-checked directly on 2026-10-17, and the move does not hold up: the
  // published file is "On My Ex Dont Know How To Act.png" and NEITHER artist holds
  // that name. Brook has "On My Ex (Don't Know How To Act).png" at 1.9 MB,
  // AGreatIstone has "On My Ex (Dont Know How To Act).jpg" at 391 KB - both
  // near-misses on punctuation, so the folder contradicted the original credit for
  // a reason that is about the filename, not about who made the picture.
  var CORRECTIONS = [{"cover":"Lit.png","from":"Deej","to":"AGreatIstone","title":"Lit"},{"cover":"Love Ain't Meant For Demons.png","from":"Raiden","to":"Brook","title":"Love Ain't Meant For Demons (Sessions)"},{"cover":"On My Ex Dont Know How To Act.png","from":"AGreatIstone","to":"Brook","title":"On My Ex"},{"cover":"Reach.png","from":"Raiden","to":"Isa","title":"Reach (Sessions)"},{"cover":"You Ain't Safe.png","from":"Carson","to":"Rashy","title":"You Ain't Safe"}];

  var moved = 0, notFound = 0;
  for (var k = 0; k < CORRECTIONS.length; k++) {
    var fix = CORRECTIONS[k];
    var holder = null, heldTitle = null;
    for (var a = 0; a < artistData.length; a++) {
      var t = artistData[a].tracks;
      for (var b = 0; b < t.length; b++) {
        if (t[b][1] === fix.cover) { holder = artistData[a]; heldTitle = t[b][0]; break; }
      }
      if (holder) break;
    }
    if (!holder) { notFound++; continue; }
    // Move, not copy: remove the cover from whoever holds it, so the lookup
    // cannot end up reporting two different names for one cover.
    holder.tracks = holder.tracks.filter(function (x) { return x[1] !== fix.cover; });
    var dest = byName[fix.to];
    if (!dest) {
      dest = { name: fix.to, pfp: null, color: hueFor(fix.to), tracks: [] };
      artistData.push(dest);
      byName[dest.name] = dest;
    }
    var already = false;
    for (var q = 0; q < dest.tracks.length; q++) if (dest.tracks[q][1] === fix.cover) already = true;
    if (!already) dest.tracks.push([fix.title || heldTitle || fix.cover, fix.cover]);
    moved++;
  }

  // Artists who submitted a file matching one of the site's covers, without it
  // being possible to tell which submission was published. Exposed so the count
  // is available to the UI instead of being thrown away.
  var AMBIGUOUS_CANDIDATES = {"Rashy":25,"Raiden":22,"Cody":8,"kurtfr3d":7,"Majinboof":7,"Skyler":6,"AGreatIstone":5,"Carson":5,"BaileysArtWrld":5,"ShroomTweak":5,"Brook":4,"Az":4,"Racks":4,"Lila":4,"Ayoub":4,"Emvy":4,"HunterMfckr":4,"Hollycoverworld":4,"JP":3,"LDH":3,"TheMemeWizard":3,"Quaza":3,"Filler":3,"Rider":3,"360NoScope":3,"Novanityneo":3,"danteh.arts":3,"VXD":3,"Outlyning":3,"Zek":2,"Thraxjpg":2,"Davi":2,"Bradley":2,"Jareddior":2,"Rafa":2,"coffeedih":2,"Fracayaso":2,"ZS":2,"Isa":2,"Cgofran":1,"Dyl":1,"abnyart":1,"HirotoGODZ":1,"Rappulse":1,"iCorrupt":1,"Big_Bag_1266":1,"RockstarKnight":1,"Dawids.Graphix":1,"josiahxinfinite":1,"Exzey":1,"babydragon7746":1,"Alebvf":1,"Felipe":1,"pludo":1,"Snovex":1,"XDVivid":1,"RealS3R":1,"YDS":1,"melodic.media":1,"Linco":1,"Shai Graphics":1,"Christian Asano":1,"luisitxo":1,"Jleo":1,"PC":1,"Fuegotoons":1,"Vumpkin":1,"Frank McNally":1};

  // Covers the site credits that the comp folder does not support. RECORDED, not
  // changed: every one of these 9 keeps the credit it has always had.
  //
  // Re-checked against the folder on 2026-10-17, not against the older audit. In all
  // 9 the artist the site credits holds no file of that name, so the credit is
  // contradicted. Nothing available here can say who should hold it instead, so
  // nothing is moved.
  //
  // Why no replacement is proposed. The site re-encodes its covers down to 500x500,
  // so for the six published at that size a byte ratio carries no information - the
  // rule built on it scored 19% against 80 known credits, worse than a coin toss.
  // Three are published at 2048 or 4096 square and so are NOT re-encoded, which
  // ought to make their published byte count meaningful and let a candidate be ruled
  // out simply for being smaller than the published copy. That test cannot be used:
  // the leading candidate is smaller than the published copy in all three, which
  // means those were re-encoded too and the constraint does not hold. Ranking by
  // closeness then collapses back to the 19% rule.
  //
  // Two further traps, both visible below. Rashy appears among the candidates for 6
  // of the 9 and holds 25 files the site cannot attribute at all, so Rashy having a
  // copy is close to meaningless - it looks like whoever consolidated the folder.
  // And several apparent candidates are shared buckets (Unofficial Alts, Unknown
  // Unsorted, Cover WRLD), which can never be credited to an individual, so their
  // presence narrows nothing either.
  //
  // ONE piece of evidence here is not from the folder. The artwork for Codeine
  // Guzzler is signed, bottom left corner, reading "Amz" in a graffiti hand. It is
  // the only one of the 9 that carries a signature at all - the other 8 were checked
  // corner by corner and have none. "Amz" matches no candidate for that cover, and
  // the name the site credits, Az, is not among them either, so on its own it settles
  // nothing; it is kept because it is the only direct statement of authorship
  // anywhere in this set.
  //
  // WHAT WOULD SETTLE ALL NINE: one answer from Rubixo, who runs the comp, naming the
  // artist behind each cover. The candidates are listed per cover below so that
  // question can be asked without repeating the search.
  var CONTESTED = [
    { cover: "Rotate.png", credited: "Raiden", published: "212,403 B, 2048x2048 JPEG (not re-encoded)",
      cands: [["AGreatIstone", "207 KB"], ["HunterMfckr", "417 KB"]],
      note: "closest is AGreatIstone at 2.0x nearer than HunterMfckr, and 97% of the published size" },
    { cover: "Codeine Guzzler.jpg", credited: "Az", published: "1,274,286 B, 4096x4096 JPEG (not re-encoded)",
      cands: [["ShroomTweak", "778 KB"], ["Felipe", "2.6 MB"], ["Bradley", "16.0 MB"]],
      signature: "Amz",
      note: "ShroomTweak is SMALLER than the published copy so cannot be an un-re-encoded source; Felipe is the nearest above it. Other rows are variants (v1, v2, Alt, No Text) or a shared bucket" },
    { cover: "Don't Go.png", credited: "AGreatIstone", published: "4,001,198 B, 2048x2048 PNG (not re-encoded)",
      cands: [["Rashy", "8.1 MB"], ["Cody", "109 KB"]],
      note: "Cody is far smaller than the published copy; Rashy is the only exact-name holder above it, but see the Rashy caveat above" },
    { cover: "Obsessed.png", credited: "Raiden", published: "270,465 B, 500x500 PNG (re-encoded, size not evidence)",
      cands: [["Thraxjpg", "762 KB"], ["Lila", "2.3 MB"]],
      note: "JP's rows are a different composition (Cerebral), not this cover" },
    { cover: "His To Keep.png", credited: "Welish", published: "356,493 B, 500x500 PNG (re-encoded, size not evidence)",
      cands: [["AGreatIstone", "287 KB"], ["ZS", "442 KB"], ["Rashy", "503 KB"]],
      note: "six named holders and the top two are only 1.5x apart - too close to call" },
    { cover: "Slenderman.png", credited: "Lila", published: "139,660 B, 500x500 PNG (re-encoded, size not evidence)",
      cands: [["Dawids.Graphix", "283 KB"], ["VXD", "1.1 MB"], ["TheMemeWizard", "5.4 MB"]],
      note: "Dawids.Graphix is the only holder in the published size's order of magnitude" },
    { cover: "Rose Petals.png", credited: "Raiden", published: "283,589 B, 400x400 PNG (re-encoded, size not evidence)",
      cands: [["AGreatIstone", "195 KB"], ["Cody", "217 KB"]],
      note: "AMBIGUOUS - the top two are within 11% and cannot be separated by any available measure" },
    { cover: "Plight.png", credited: "AGreatIstone", published: "152,033 B, 500x500 PNG (re-encoded, size not evidence)",
      cands: [["Az", "99 KB"], ["ZS", "542 KB"]],
      note: "Az is 5.5x nearer than ZS" },
    { cover: "Tick Tock.png", credited: "Carson", published: "256,618 B, 500x500 PNG (re-encoded, size not evidence)",
      cands: [["Frank McNally", "4.1 MB"], ["Rashy", "21.1 MB"]],
      note: "no holder anywhere near the published size; Jamothy's row is a different composition (AP Tick -Tock)" }
  ];

  // Sort every artist's covers A-Z, applied here once the credits, corrections and
  // renames are all in, so the order reflects the final set rather than the order
  // things happened to be appended in - which was a mix of whatever the site shipped
  // with and the order this file happened to apply them.
  //
  // Safe to do. The only reader in script.js that looks at artistData[].tracks is the
  // "Cover made by X" lookup, which scans every artist for a filename match and breaks
  // on the first hit, so it does not care what order the entries are in; every other
  // ".tracks" in script.js belongs to a playlist or a wanted list.
  //
  // Sorted on the title, because that is what the credit is about, case-insensitively,
  // with the filename as a tiebreak so two entries sharing a title still land in a
  // defined order. Plain comparison rather than localeCompare, so the result cannot
  // shift with the visitor's locale.
  //
  // Only the credits array is sorted. AMBIGUOUS_CANDIDATES is keyed by artist and is
  // left exactly as harvested.
  var resorted = 0, sortedCovers = 0, sortedArtists = 0;
  for (var sa = 0; sa < artistData.length; sa++) {
    var list = artistData[sa].tracks;
    if (!list || list.length < 2) continue;
    var head = list[0][1];
    list.sort(function (x, y) {
      var a = String(x && x[0] != null ? x[0] : "").toLowerCase();
      var b = String(y && y[0] != null ? y[0] : "").toLowerCase();
      if (a < b) return -1;
      if (a > b) return 1;
      var fa = String((x && x[1]) || "").toLowerCase();
      var fb = String((y && y[1]) || "").toLowerCase();
      return fa < fb ? -1 : fa > fb ? 1 : 0;
    });
    sortedArtists++;
    sortedCovers += list.length;
    if (list[0][1] !== head) resorted++;
  }

  // Exposed for the console and for anything that wants to render the dispute.
  // Deliberately not rendered: a cover already shows its credited name, and adding a
  // "disputed" badge to 9 covers would say less than the record does here.
  window.__thwContestedCredits = CONTESTED;

  console.log(
    "[cover-artists] " + artistData.length + " artists (" + addedArtists + " new), " +
    addedCredits + " credits applied, " + skipped + " already present, " +
    moved + " corrected, " + renamed + " renamed (" + renameDropped + " skipped)"
  );

  console.log(
    "[cover-artists] sorted A-Z: " + sortedCovers + " covers across " +
    sortedArtists + " artists (" + resorted + " changed order)"
  );

  if (CONTESTED.length) {
    console.log(
      "[cover-artists] " + CONTESTED.length + " credits are contradicted by the comp folder and were left as they are: " +
      CONTESTED.map(function (c) { return c.cover; }).join(", ") +
      ". Rubixo can settle all of them; see CONTESTED in cover-artists.js."
    );
  }

  _renderCoverArtistFooter(artistData, SHARED_BUCKETS, AMBIGUOUS_CANDIDATES);
})();

// Render the footer's cover-artist list from artistData.
//
// This used to be 22 hand-written buttons in index.html, each with its own
// Tailwind text colour. That list mirrored artistData exactly - every footer
// artist was in artistData and every artistData artist was in the footer - and
// all 22 button hues turned out to be derived from the artist's own color field,
// so rendering color instead reproduces the same palette.
//
// Generating it is what lets 120 artists be listed instead of 22, and it means the
// roster has one home rather than two that must be kept in step by hand.
function _renderCoverArtistFooter(artists, buckets, ambiguous) {
  var btns = document.querySelectorAll('button[onclick*="toggleArtistPanel"]');
  if (!btns.length) return;

  // The container is the parent that holds every one of those buttons.
  var host = btns[0].parentElement;
  if (!host) return;
  var all = host.querySelectorAll('button[onclick*="toggleArtistPanel"]').length;
  if (all < btns.length) host = document.body;
  if (host === document.body) return;

  // Only artists with a credited cover get a button. The 98 comp artists whose work is
  // not provably on the site stay in artistData but out of the list, because a
  // button that opens an empty panel is worse than no button.
  var withCovers = [];
  for (var i = 0; i < artists.length; i++) {
    if (artists[i].tracks && artists[i].tracks.length) withCovers.push(artists[i]);
  }
  withCovers.sort(function (a, b) { return a.name.localeCompare(b.name); });

  var html = "";
  for (var j = 0; j < withCovers.length; j++) {
    var a = withCovers[j];
    var col = String(a.color || "hsl(0,0%,50%)").replace("hsl(", "hsla(").replace(")", ",0.85)");
    var hover = String(a.color || "hsl(0,0%,50%)").replace("hsl(", "hsla(").replace(")", ",1)");
    html +=
      '<button onclick="toggleArtistPanel(\'' + a.name.replace(/'/g, "\\'") + '\')" ' +
      'style="color:' + col + '" ' +
      'onmouseover="this.style.color=\'' + hover + '\'" ' +
      'onmouseout="this.style.color=\'' + col + '\'" ' +
      'class="underline underline-offset-2 transition-all bg-transparent border-none p-0 cursor-pointer font-inherit text-[10px]">' +
      a.name.replace(/</g, "&lt;") + "</button> " +
      '<span class="text-gray-600">\u2022 </span>';
  }
  host.innerHTML = html;
}

// Keep the artist panel's arrows on artists that actually have a cover.
//
// _navigateArtist in script.js steps through artistData by array index. Now that
// artistData holds every artist in the comp folder, most of whom have no cover
// credited on the site, the arrows would walk through dozens of empty panels.
// They are re-pointed at the credited artists instead.
//
// This replaces the navigation rather than adding to it, and it reuses the
// existing toggleArtistPanel, so there is still one panel and one entry point.
(function () {
  var _creditedArtists = null;
  function credited() {
    if (!_creditedArtists) {
      _creditedArtists = [];
      for (var i = 0; i < artistData.length; i++) {
        if (artistData[i].tracks && artistData[i].tracks.length) _creditedArtists.push(artistData[i].name);
      }
    }
    return _creditedArtists;
  }

  function step(dir) {
    var list = credited();
    if (!list.length) return;
    var open = typeof _artistPanelOpen === "string" ? _artistPanelOpen : null;
    var at = -1;
    for (var i = 0; i < list.length; i++) if (list[i] === open) { at = i; break; }
    if (at === -1) at = dir > 0 ? -1 : 0;
    var next = (at + dir + list.length) % list.length;
    toggleArtistPanel(list[next]);
  }

  window.prevArtist = function () { step(-1); };
  window.nextArtist = function () { step(1); };
})();
