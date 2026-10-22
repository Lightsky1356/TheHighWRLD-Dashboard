/* A quick check of a message before it is sent.
 *
 * WHAT THIS IS
 * A short list of the mistakes people actually make, looked for in the text.
 * It finds the misspelling, the doubled word, the space before the comma,
 * the sentence that starts in lowercase - the things worth a second look.
 *
 * WHAT THIS IS NOT
 * It is not a grammar checker, and it does not pretend to be one. There is no
 * grammar engine behind it and there is not going to be one: it runs in the
 * page, on the text that is already there, and it does not understand what
 * you meant. It cannot tell you that your sentence is confusing or that your
 * argument does not hold. It can only point at the things it knows about.
 *
 * So it says what it is - a few suggestions - and it leaves the text alone.
 * Nothing is changed unless the person asks for it.
 *
 * AND IT NEVER SENDS THE TEXT ANYWHERE
 * The message is already going to the server - that is what a message is.
 * But the check happens here, in the page, and the text is not sent to
 * anything to be checked. There is no service to call, so there is nothing
 * to leak it to, and no request to make - which matters on a site that is
 * counting every request it makes.
 */
(function () {
  "use strict";

  if (window.THWGrammar) return;

  /* The misspellings worth pointing at.
   *
   * Only the ones that are wrong in every context. A word that is sometimes
   * right - "there" and "their", "its" and "it's" - is left alone, because
   * telling somebody they got it wrong when they did not is worse than
   * staying quiet. */
  var MISSPELLED = {
    teh: "the",
    recieve: "receive",
    recieved: "received",
    definately: "definitely",
    definitly: "definitely",
    seperate: "separate",
    seperated: "separated",
    occured: "occurred",
    occuring: "occurring",
    neccessary: "necessary",
    neccesary: "necessary",
    accomodate: "accommodate",
    accomodation: "accommodation",
    wich: "which",
    becuase: "because",
    alway: "always",
    arguement: "argument",
    begining: "beginning",
    beleive: "believe",
    buisness: "business",
    calender: "calendar",
    cemetary: "cemetery",
    collegue: "colleague",
    comming: "coming",
    concious: "conscious",
    dissapoint: "disappoint",
    embarass: "embarrass",
    enviroment: "environment",
    existance: "existence",
    firey: "fiery",
    fourty: "forty",
    goverment: "government",
    gaurd: "guard",
    harrass: "harass",
    independant: "independent",
    inteligent: "intelligent",
    knowlege: "knowledge",
    liesure: "leisure",
    libary: "library",
    maintainance: "maintenance",
    managable: "manageable",
    noticable: "noticeable",
    occassion: "occasion",
    paralel: "parallel",
    persistant: "persistent",
    posession: "possession",
    prefered: "preferred",
    priviledge: "privilege",
    publically: "publicly",
    recieveing: "receiving",
    refered: "referred",
    relevent: "relevant",
    responsability: "responsibility",
    rythm: "rhythm",
    succesful: "successful",
    succesfully: "successfully",
    supercede: "supersede",
    suprise: "surprise",
    tommorow: "tomorrow",
    truely: "truly",
    untill: "until",
    wierd: "weird",
    writting: "writing",
    writen: "written",
  };

  /* The contractions that are left out. */
  var CONTRACTIONS = {
    dont: "don't",
    doesnt: "doesn't",
    didnt: "didn't",
    cant: "can't",
    couldnt: "couldn't",
    shouldnt: "shouldn't",
    wouldnt: "wouldn't",
    wont: "won't",
    isnt: "isn't",
    arent: "aren't",
    wasnt: "wasn't",
    werent: "weren't",
    hasnt: "hasn't",
    havent: "haven't",
    hadnt: "hadn't",
    doesnt: "doesn't",
    im: "I'm",
    ive: "I've",
    ill: "I'll",
    id: "I'd",
    youre: "you're",
    youve: "you've",
    youll: "you'll",
    theyre: "they're",
    theyve: "they've",
    theyll: "they'll",
    weve: "we've",
    wellve: "we'll",
    thats: "that's",
    theres: "there's",
    whats: "what's",
    whos: "who's",
    lets: "let's",
    its: null, /* "its" is right on its own - left alone. */
    cant_: null,
  };

  /* The word pairs that are wrong together. */
  var PHRASES = [
    { wrong: /\byour welcome\b/gi, right: "you're welcome", why: "“Welcome” is a noun here, so it takes an apostrophe." },
    { wrong: /\bshould of\b/gi, right: "should have", why: "“Should of” is “should have” - “should” is a modal verb, so it is followed by “have”." },
    { wrong: /\bcould of\b/gi, right: "could have", why: "“Could of” is “could have”." },
    { wrong: /\bwould of\b/gi, right: "would have", why: "“Would of” is “would have”." },
    { wrong: /\bmust of\b/gi, right: "must have", why: "“Must of” is “must have”." },
    { wrong: /\balot\b/gi, right: "a lot", why: "“Alot” is two words." },
    { wrong: /\bin the future,? i will\b/gi, right: "in the future, I will", why: "The pronoun “I” is always capitalised." },
    { wrong: /\bfor example,? i\b/gi, right: "for example, I", why: "The pronoun “I” is always capitalised." },
    { wrong: /\bdefinately\b/gi, right: "definitely", why: "“Definitely” is spelled with an “i” before the “t”." },
  ];

  /* Does this place start a sentence?
   *
   * It matters for the fix: a misspelling at the start of a sentence is
   * fixed with a capital letter, so "teh cat" becomes "The cat" rather than
   * "the cat" - which would be a new mistake. */
  function startsSentence(body, index) {
    if (index <= 0) return true;
    var before = body.slice(0, index).replace(/\s+$/, "");
    if (!before) return true;
    var last = before.charAt(before.length - 1);
    return last === "." || last === "!" || last === "?";
  }

  /* The check itself.
   *
   * Returns a list of { text, why, start, length, fix } - the word that was
   * found, why it is worth a look, and where it is, so the caller can point
   * at it.
   *
   * Two suggestions are never allowed to cover the same words. "teh" is a
   * misspelling and "t" is a sentence that starts in lower case, and they
   * are the same three letters - so the second one is dropped rather than
   * the two fighting over the same place. */
  function check(text) {
    var body = String(text == null ? "" : text);
    var found = [];
    if (!body.trim()) return found;

    var seen = {};
    var ranges = [];

    /* Whether this place is already covered by a suggestion. */
    var covered = function (start, length) {
      for (var i = 0; i < ranges.length; i++) {
        var r = ranges[i];
        if (start < r.start + r.length && r.start < start + length) return true;
      }
      return false;
    };

    var add = function (match, why, fix, start, length) {
      var len = length == null ? match.length : length;
      var key = fix + "|" + start;
      if (seen[key]) return;
      if (covered(start, len)) return;
      seen[key] = true;
      ranges.push({ start: start, length: len });
      found.push({ text: match, why: why, fix: fix, start: start, length: len });
    };

    /* The misspellings and the missing contractions. */
    var words = body.match(/[A-Za-z']+/g) || [];
    var offsets = [];
    var at = 0;
    words.forEach(function (w) {
      var i = body.indexOf(w, at);
      if (i === -1) i = at;
      offsets.push(i);
      at = i + w.length;
    });

    /* A fix at the start of a sentence is capitalised. */
    var capitalise = function (fix, start) {
      if (!startsSentence(body, start) || !fix) return fix;
      return fix.charAt(0).toUpperCase() + fix.slice(1);
    };

    words.forEach(function (w, index) {
      var lower = w.toLowerCase();
      var start = offsets[index];
      if (MISSPELLED[lower] !== undefined) {
        add(w, "“" + w + "” is usually spelled “" + MISSPELLED[lower] + "”.",
          capitalise(MISSPELLED[lower], start), start);
        return;
      }
      if (Object.prototype.hasOwnProperty.call(CONTRACTIONS, lower) && CONTRACTIONS[lower]) {
        add(w, "“" + w + "” is missing an apostrophe: “" + CONTRACTIONS[lower] + "”.",
          capitalise(CONTRACTIONS[lower], start), start);
      }
    });

    /* The word pairs. */
    PHRASES.forEach(function (phrase) {
      var re = new RegExp(phrase.wrong.source, "gi");
      var m;
      while ((m = re.exec(body)) !== null) {
        add(m[0], phrase.why, capitalise(m[0].replace(phrase.wrong, phrase.right), m.index), m.index);
        if (m.index === re.lastIndex) re.lastIndex++;
      }
    });

    /* A word twice in a row: "the the". */
    var doubled = /\b(\w+)\s+\1\b/gi;
    var d;
    while ((d = doubled.exec(body)) !== null) {
      add(d[0], "“" + d[1] + "” is twice.", d[1], d.index);
    }

    /* A space before the punctuation: "word ,".
     *
     * The space is what is removed, so the range covers the word and the
     * space but not the mark - which is left for the next rule, so the two
     * do not fight over the same letters. */
    var spaced = /([A-Za-z]+)(\s+)([,.!?;])/g;
    var s;
    while ((s = spaced.exec(body)) !== null) {
      add(s[0], "There is a space before the “" + s[3] + "”.", s[1], s.index, s[1].length + s[2].length);
    }

    /* The same punctuation three times: "!!!". */
    var loud = /([!?])\1{2,}/g;
    var l;
    while ((l = loud.exec(body)) !== null) {
      add(l[0], "Three of the same mark is a lot.", l[0].slice(0, 1), l.index);
    }

    /* A sentence that starts in lower case. */
    var lowerStart = /(^|[.!?]\s+)([a-z])/g;
    var ls;
    while ((ls = lowerStart.exec(body)) !== null) {
      var letter = ls[2];
      var pos = ls.index + ls[1].length;
      /* Only the first letter of the sentence, and not a word that is meant
         to be lower case - a web address, or a name like "iPhone". */
      if (letter === "i" && /^(iPhone|iPad|iMac|eBay|YouTube)/.test(body.slice(pos, pos + 6))) continue;
      if (/\b[A-Z][a-z]/.test(body.slice(pos, pos + 2))) continue;
      add(letter, "A sentence starts with a capital letter.", letter.toUpperCase(), pos, 1);
    }

    return found;
  }

  /* The text with the suggestions applied.
   *
   * Applied from the end backwards, so the offsets of the earlier ones are
   * still right when it gets to them. */
  function fix(text, suggestions) {
    var body = String(text == null ? "" : text);
    var list = (suggestions || []).slice().sort(function (a, b) { return b.start - a.start; });
    list.forEach(function (item) {
      body = body.slice(0, item.start) + item.fix + body.slice(item.start + item.length);
    });
    return body;
  }

  window.THWGrammar = { check: check, fix: fix };
})();
