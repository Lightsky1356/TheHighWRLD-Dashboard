/* ============================================================================
   COVER GRADIENTS
   Per-cover background gradients, derived from the artwork itself.

   WHY THIS EXISTS
   getCoverGradientValue() looks a cover's filename up in coverGradientMap and
   falls back to a HASH OF THE FILENAME when it misses. So a cover with no
   entry got a colour chosen by its name, not by its picture: 'Smile (Sessions)
   came out pink because S is early in the alphabet.

   16 covers were missing an entry and fell through to that hash, covering 26
   tracks - several share era artwork (Covers/DRFL.png, Covers/WOD.png,
   Covers/GB&GR.png) so one gap hid five tracks at a time. A further 7 had an
   entry that did not match the cover. Floating and Heart Racing also ship
   .jpg covers where every other cover is .png, so they missed on the extension.

   HOW THE VALUES WERE CHOSEN
   Each cover was decoded, drawn to a canvas and sampled. Hues are bucketed into
   10-degree bins weighted by saturation, so a vivid subject beats a large grey
   background, and near-grey pixels are ignored because they carry no hue signal.
   The second stop is the next heaviest bin at least 25 degrees away. Saturation
   and lightness are held inside the ranges the existing 269 entries already use,
   and every value keeps the 135deg two-stop linear-gradient shape.

   Registered under both the bare filename and the Covers/ path, because
   getCoverGradientValue tries the bare key first and the prefixed one second.

   gradientCache is cleared on load: a lookup that already missed would have
   cached the fallback, and the new value would never be read.
   ========================================================================== */
(function () {
  "use strict";

  /* coverGradientMap is declared with `var` in script.js, so it is already a
     window property by the time this runs. */
  if (typeof coverGradientMap !== "object" || coverGradientMap === null) return;

  var GRADIENTS = {
    "734.png": "linear-gradient(135deg,hsl(220,35%,36%),hsl(60,29%,30%))",
    "Covers/734.png": "linear-gradient(135deg,hsl(220,35%,36%),hsl(60,29%,30%))",
    "Heart Racing.jpg": "linear-gradient(135deg,hsl(40,49%,49%),hsl(219,43%,42%))",
    "Covers/Heart Racing.jpg": "linear-gradient(135deg,hsl(40,49%,49%),hsl(219,43%,42%))",
    "Hop Out.png": "linear-gradient(135deg,hsl(29,41%,51%),hsl(189,35%,43%))",
    "Covers/Hop Out.png": "linear-gradient(135deg,hsl(29,41%,51%),hsl(189,35%,43%))",
    "Floating.jpg": "linear-gradient(135deg,hsl(39,53%,38%),hsl(240,47%,32%))",
    "Covers/Floating.jpg": "linear-gradient(135deg,hsl(39,53%,38%),hsl(240,47%,32%))",
    "Candles.png": "linear-gradient(135deg,hsl(299,47%,40%),hsl(28,41%,34%))",
    "Covers/Candles.png": "linear-gradient(135deg,hsl(299,47%,40%),hsl(28,41%,34%))",
    "Cigarettes.png": "linear-gradient(135deg,hsl(12,30%,36%),hsl(219,24%,30%))",
    "Covers/Cigarettes.png": "linear-gradient(135deg,hsl(12,30%,36%),hsl(219,24%,30%))",
    "DRFL.png": "linear-gradient(135deg,hsl(19,49%,36%),hsl(319,43%,30%))",
    "Covers/DRFL.png": "linear-gradient(135deg,hsl(19,49%,36%),hsl(319,43%,30%))",
    "Feeling.png": "linear-gradient(135deg,hsl(207,55%,36%),hsl(46,49%,30%))",
    "Covers/Feeling.png": "linear-gradient(135deg,hsl(207,55%,36%),hsl(46,49%,30%))",
    "Flintstones.png": "linear-gradient(135deg,hsl(30,55%,45%),hsl(160,49%,38%))",
    "Covers/Flintstones.png": "linear-gradient(135deg,hsl(30,55%,45%),hsl(160,49%,38%))",
    "Flaws & Sins.png": "linear-gradient(135deg,hsl(19,49%,36%),hsl(228,43%,31%))",
    "Covers/Flaws & Sins.png": "linear-gradient(135deg,hsl(19,49%,36%),hsl(228,43%,31%))",
    "WOD.png": "linear-gradient(135deg,hsl(351,48%,52%),hsl(47,42%,46%))",
    "Covers/WOD.png": "linear-gradient(135deg,hsl(351,48%,52%),hsl(47,42%,46%))",
    "GB&GR.png": "linear-gradient(135deg,hsl(50,38%,52%),hsl(200,32%,46%))",
    "Covers/GB&GR.png": "linear-gradient(135deg,hsl(50,38%,52%),hsl(200,32%,46%))",
    "Legends.png": "linear-gradient(135deg,hsl(208,44%,52%),hsl(27,38%,46%))",
    "Covers/Legends.png": "linear-gradient(135deg,hsl(208,44%,52%),hsl(27,38%,46%))",
    "Move The Bale.png": "linear-gradient(135deg,hsl(23,54%,52%),hsl(171,48%,46%))",
    "Covers/Move The Bale.png": "linear-gradient(135deg,hsl(23,54%,52%),hsl(171,48%,46%))",
    "Nightmare.png": "linear-gradient(135deg,hsl(50,55%,47%),hsl(239,49%,40%))",
    "Covers/Nightmare.png": "linear-gradient(135deg,hsl(50,55%,47%),hsl(239,49%,40%))",
    "Okay.png": "linear-gradient(135deg,hsl(193,36%,38%),hsl(42,30%,32%))",
    "Covers/Okay.png": "linear-gradient(135deg,hsl(193,36%,38%),hsl(42,30%,32%))",
    "Percs.png": "linear-gradient(135deg,hsl(251,55%,36%),hsl(23,49%,30%))",
    "Covers/Percs.png": "linear-gradient(135deg,hsl(251,55%,36%),hsl(23,49%,30%))",
    "Quitter.png": "linear-gradient(135deg,hsl(19,36%,46%),hsl(228,30%,39%))",
    "Covers/Quitter.png": "linear-gradient(135deg,hsl(19,36%,46%),hsl(228,30%,39%))",
    "Rotate.png": "linear-gradient(135deg,hsl(30,40%,40%),hsl(82,34%,34%))",
    "Covers/Rotate.png": "linear-gradient(135deg,hsl(30,40%,40%),hsl(82,34%,34%))",
    "Take No Chance.png": "linear-gradient(135deg,hsl(249,33%,36%),hsl(10,27%,30%))",
    "Covers/Take No Chance.png": "linear-gradient(135deg,hsl(249,33%,36%),hsl(10,27%,30%))",
    "Wishing Well.png": "linear-gradient(135deg,hsl(338,52%,47%),hsl(310,46%,40%))",
    "Covers/Wishing Well.png": "linear-gradient(135deg,hsl(338,52%,47%),hsl(310,46%,40%))",
    "Sometimes.png": "linear-gradient(135deg,hsl(240,55%,36%),hsl(210,49%,30%))",
    "Covers/Sometimes.png": "linear-gradient(135deg,hsl(240,55%,36%),hsl(210,49%,30%))",
    "My Life In A Nutshell.png": "linear-gradient(135deg,hsl(20,30%,36%),hsl(218,24%,30%))",
    "Covers/My Life In A Nutshell.png": "linear-gradient(135deg,hsl(20,30%,36%),hsl(218,24%,30%))",
  };

  for (var key in GRADIENTS) {
    if (Object.prototype.hasOwnProperty.call(GRADIENTS, key)) coverGradientMap[key] = GRADIENTS[key];
  }

  if (typeof gradientCache === "object" && gradientCache !== null) gradientCache = {};

  window.__thwCoverGradients = GRADIENTS;
})();
