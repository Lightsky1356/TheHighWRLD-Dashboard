/* ============================================================================
   COVER PREFERENCE - "Song covers" / "Era art" in Settings > Appearance
   ---------------------------------------------------------------------------
   'song'  Every track wears its own cover. This is the vault's historic look.
   'era'   Every track wears its era's cover, where the vault holds one
           (GB&GR, DRFL, JW3, POST, 999). Tracks whose era has no art keep
           their own cover.

   The vault stores one cover per track in trackList[].cover, so the
   preference is applied at the three call sites that fetch it for the
   UI the listener stares at: the player, Now Playing art and the track
   page. Track lists keep song art either way - swapping hundreds of
   background-images for a preference nobody can see until they click
   Settings would be worse than honest copy.
   --------------------------------------------------------------------------- */
(function () {
  "use strict";

  var ERA_ART = {
    "GB&GR": "AlbumArt/goodbye.jpg",
    "DRFL": "AlbumArt/death.jpg",
    "JW3": "AlbumArt/legends.jpg",
    "POST": "AlbumArt/party.jpg",
    "999": "AlbumArt/999.jpg",
    "JW999": "AlbumArt/999.jpg"
  };
  /* Strip the ANSI leftovers some tags carry, then take era tags - the
     form is do"..." (title words) ... (ERA) with spaces between. */
  function eraOf(track) {
    if (!track) return null;
    var tag = String(track.tag || track.title || "").replace(/\[?\d+m/g, "");
    var m = tag.match(/\((999|JW999|GB&GR|WOD|DRFL|JW3|POST|OUT|AF|ND|BDM|HIH)\)(?:\s*[)\]]?)*\s*$/i);
    if (!m) m = tag.match(/\((999|JW999|GB&GR|WOD|DRFL|JW3|POST|OUT|AF|ND|BDM|HIH)\)/i);
    return m ? m[1].toUpperCase().replace(/^JW999$/, "999") : null;
  }

  function pref() {
    try {
      return (window.wrldPlayerSettings && window.wrldPlayerSettings.get("coversPref")) || "song";
    } catch (e) { return "song"; }
  }

  window.wrldCoverFor = function (track) {
    var own = (track && track.cover) || "Juice-WRLD.png";
    if (pref() !== "era") return own;
    var era = eraOf(track);
    return (era && ERA_ART[era]) ? ERA_ART[era] : own;
  };
})();
