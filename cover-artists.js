// Cover artists and cover credits recovered from the MEGA comp folder
// "01 Rubixo's Cover Art Comp juicevault.xyz" - one subfolder per cover artist.
//
// Two separate things live here, kept apart on purpose:
//
//   ARTISTS  every artist folder in the comp. The root listing was scrolled to
//            its actual bottom before this was taken, so it is complete: 119 artists.
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

  var NEW_ARTISTS = ["360NoScope","abnyart","AlreadyDavid999","antiwrld999","Aogiritrap","Ayoub","babydragon7746","Batsy","Big_Bag_1266","Blejdon","cccc c cCcc cCCc CC c","Centi","Cgofran","Cheerio","Christian Asano","Cody","coffeedih","Dan","danteh.arts","Dawids.Graphix","DiegoPSD","Dyl","Echo","Emvy","Exzey","Felipe","flame","Flashh","Formats","Fracayaso","Frank McNally","Fuegotoons","fvtal","Guwac","HirotoGODZ","Hollycoverworld","HRiiLSS","HunterMfckr","icedood","iCorrupt","inspiredus","Jamothy","Jareddior","Jleo","josiahxinfinite","JP","Juan_Wick","jxck","krishagraiya","kurtfr3d","LDH","lemonjah","Leo","Liddlemuffin","Linco","LongStoryShorts","luisitxo","Majinboof","malupias","melodic.media","Miqeo","Neonxraa","novah","Novanityneo","nxfour","Outlyning","PC","pludo","Quaza","Rafa","Rappulse","RealS3R","Revo","RockstarKnight","Rubixo","Samz","Shadore","Shai Graphics","ShroomTweak","Snovex","StacxActivist","The Roach","Thraxjpg","tiz","tommyygig","tree.o","TuckGFX","TxmpestFaltered","Vexed","VilentCow","Vro","Vumpkin","Wraith","XDVivid","YDS","Zek","ZS"];

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
  var SHARED_BUCKETS = ["Cover WRLD","Official Covers","Unknown Unsorted","WRLD Covers"];

  // Credits already on the site that the comp folder contradicts, and where
  // exactly one artist holds the file. These are MOVED, not duplicated - the
  // cover is removed from whoever held it and given to the artist the comp
  // names, so the lookup cannot report two names for one cover.
  //
  // 5 of them. Each was confirmed on a live search with controls: one already-correct
  // single-artist cover still resolved to its credited artist, and one known
  // three-way cover still came back ambiguous. The remaining contradicted
  // credits are held by two to six artists and are deliberately left alone.
  var CORRECTIONS = [{"cover":"Lit.png","from":"Deej","to":"AGreatIstone","title":"Lit"},{"cover":"Love Ain't Meant For Demons.png","from":"Raiden","to":"Brook","title":"Love Ain't Meant For Demons (Sessions)"},{"cover":"On My Ex Dont Know How To Act.png","from":"Brook","to":"AGreatIstone","title":"On My Ex"},{"cover":"Reach.png","from":"Raiden","to":"Isa","title":"Reach (Sessions)"},{"cover":"You Ain't Safe.png","from":"Carson","to":"Rashy","title":"You Ain't Safe"}];

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

  console.log(
    "[cover-artists] " + artistData.length + " artists (" + addedArtists + " new), " +
    addedCredits + " credits applied, " + skipped + " already present, " +
    moved + " corrected, " + renamed + " renamed (" + renameDropped + " skipped)"
  );

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
// Generating it is what lets 119 artists be listed instead of 22, and it means the
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

  // Only artists with a credited cover get a button. The 97 comp artists whose work is
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
