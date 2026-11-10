/* ==========================================================================
   auto-sync-tracks.cjs
   --------------------------------------------------------------------------
   Watches the song repo (Lightsky1356/TheHighWRLD: Audio/ + Covers/) and
   brings tracks.js up to date with whatever is new in it.

   For every new mp3 that is not already in tracks.js (judged by its core
   title - the stem with the era, version and alias parens stripped; v3
   copies of a song that already has an entry are deliberately skipped):
     1. it looks up the Producer(s), Alt Name(s) and Year from juicewrld.io's
        tracker (NEW, /api/index - cached for a day) - juicewrldapi.com is
        tried next, and JuiceVault (juicevault.xyz) when both answer nothing;
     2. it downloads the mp3 and reads its real duration straight from the
        frame headers (no dependencies - the parser is about a page of code);
     3. it finds the cover png for it in Covers/; when there is one, it decodes
        the image itself, takes the colour of the top band and the bottom band
        and writes a Cover Gradient for it into script.js's coverGradientMap;
     4. it appends the new entry to tracks.js (the sort call at the bottom
        already orders every entry, so plain appends stay sorted).

   Nothing is changed on the disk in dry-run mode - the default. Three
   states, by environment variable:
      (nothing set)      dry run - only prints what it would do;
      AUTO_SYNC_WRITE=1  writes tracks.js and script.js, commits nothing;
      AUTO_SYNC_COMMIT=1 writes, commits and pushes (what the GitHub
                         Action for this sets; a human can set it too).

   Usage:  node scripts/auto-sync-tracks.cjs
           AUTO_SYNC_WRITE=1  node scripts/auto-sync-tracks.cjs
           AUTO_SYNC_COMMIT=1 node scripts/auto-sync-tracks.cjs
   ========================================================================== */
"use strict";

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const https = require("https");
const os = require("os");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const TRACKS_JS = path.join(ROOT, "tracks.js");
const SCRIPT_JS = path.join(ROOT, "script.js");
const WRLDLOG_JS = path.join(ROOT, "wrldlog-data.js");
/* The songs and the covers live in a repo of their own - the dashboard repo
   only references them by raw.githubusercontent URL. */
const AUDIO_REPO = process.env.SYNC_AUDIO_REPO || "Lightsky1356/TheHighWRLD";
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || "";
/* dry run (default): nothing is written. AUTO_SYNC_WRITE=1 writes the files
   and stops there. AUTO_SYNC_COMMIT=1 writes, commits and pushes. */
const COMMIT = process.env.AUTO_SYNC_COMMIT === "1";
const DRY = !COMMIT && process.env.AUTO_SYNC_WRITE !== "1";
/* The owner's off-switch also exists as an env flag, for whoever sets the sync
   up by hand: AUTO_SYNC_DISABLED=1 turns any run - cron or manual - into a
   no-op that touches nothing. The scheduled workflow instead reads the
   switch from the site itself (/api/autosync) and skips this script entirely. */
const DISABLED = process.env.AUTO_SYNC_DISABLED === "1";
const BRANCH = process.env.SYNC_BRANCH || "main";
/* How many new songs in one run turn into a WRLD LOG release note. One quiet
   addition ships silently; a batch gets its own version entry (set it to 0 to
   log every single addition). */
const LOG_MIN = Math.max(0, parseInt(process.env.AUTO_SYNC_LOG_MIN || "2", 10) || 0);

const RAW = "https://raw.githubusercontent.com/" + AUDIO_REPO + "/" + BRANCH + "/";
const API = "https://api.github.com/repos/" + AUDIO_REPO + "/contents/";
const USER_AGENT = "TheHighWRLD-dashboard-auto-sync/1.0 (contact: site owner)";

/* The era groups a tag can carry; none of these belong in a title. Code names
   are the known Juice WRLD vault project codes. */
const ERA_SET = new Set([
  "WOD", "DRFL", "JW3", "GB&GR", "OUT", "AF", "LTR", "LPD", "JW2", "JUICE",
  "DR", "FL", "JW1", "DE", "QB", "BT", "EP", "DEMO", "DLX", "TPNE", "PTX",
]);
const VERSION_RE = /^\(v[0-9]+(?:\.\d+)?\)$/i;

const log = (s) => process.stdout.write(s + "\n");
const warn = (s) => process.stderr.write("  ! " + s + "\n");

/* ------------------------------------------------------------------ http */

function get(url, opts, attempt) {
  opts = opts || {};
  attempt = attempt || 0;
  return new Promise(function (resolve, reject) {
    const u = new URL(url);
    const headers = Object.assign({ "User-Agent": USER_AGENT }, opts.headers || {});
    if (opts.json) headers.Accept = "application/json";
    https.get({
      host: u.host, path: u.pathname + u.search, headers: headers,
      timeout: opts.timeout || 30000,
    }, function (res) {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return resolve(get(res.headers.location, opts, attempt));
      }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", function () {
        const body = Buffer.concat(chunks);
        if (res.statusCode >= 200 && res.statusCode < 300) return resolve({ status: res.statusCode, body: body });
        /* GitHub and the vault rate-limit like every other honest citizen.
           A 429 gets three slow retries, then a soft failure. */
        if (res.statusCode === 429 && attempt < 3) {
          return setTimeout(function () {
            get(url, opts, attempt + 1).then(resolve, reject);
          }, 8000 * (attempt + 1));
        }
        return resolve({ status: res.statusCode, body: body });
      });
    }).on("error", function (err) {
      if (attempt < 3) return setTimeout(function () {
        get(url, opts, attempt + 1).then(resolve, reject);
      }, 3000);
      resolve({ status: 0, body: Buffer.alloc(0), error: err.message });
    });
  });
}

/* ------------------------------------------------------- parsing tracks.js */

function readTrackList() {
  const src = fs.readFileSync(TRACKS_JS, "utf8");
  const start = src.indexOf("["), end = src.lastIndexOf("trackList.sort");
  if (start < 0 || end <= start) throw new Error("tracks.js does not look like it should");
  const list = new Function(
    "var trackList = " + src.slice(start, end) + ";" +
    "return trackList;"
  )();
  if (!Array.isArray(list)) throw new Error("trackList did not come out as an array");
  return { list: list, src: src };
}

/* decode %20 etc. and return "[stem, extension]" of a raw url */
function urlStemAndName(url, dir) {
  if (!url) return ["", ""];
  const name = decodeURIComponent(url.split(dir)[1] || "");
  const i = name.lastIndexOf(".");
  if (i < 0) return [name, ""];
  return [name.slice(0, i), name.slice(i)];
}

/* The core title: the stem without the era code, the (Sessions)/(Halloween)
   category note, the (vN) version note and the freeform alias notes - the
   words the site's own entries use for "already have this song". */
function coreStem(stem) {
  const groups = stem.match(/\([^()]*\)/g) || [];
  let out = stem;
  for (const g of groups) {
    const inner = g.slice(1, -1).trim();
    if (ERA_SET.has(inner.toUpperCase()) || VERSION_RE.test(g) ||
        /^(Sessions|Halloween)$/i.test(inner)) {
      out = out.replace(g, " ");
    }
  }
  return out.replace(/\s+/g, " ").trim();
}

const norm = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

/* ------------------------------------------------------------- JuiceWRLDAPI */

function firstYear(text) {
  const m = (String(text || "")).match(/\b(?:19|20)\d{2}\b/);
  return m ? m[0] : "";
}

/* --------------------------------------------------- juicewrld.io (NEW) */

/* juicewrld.io publishes the whole tracker as one JSON document at /api/index:
   every entry carries the producer (pr), the aka/alt title (alt), the recorded
   and released dates (rec / pv / out) and the era. 2,853 entries / ~1.8 MB, so
   it is fetched once and cached for a day in the OS temp dir - the 30-minute
   cron then never re-downloads it between runs. */
const JIO_URL = "https://juicewrld.io/api/index";
const JIO_CACHE = path.join(os.tmpdir(), "juicewrld-io-index.json");
const JIO_TTL = 24 * 60 * 60 * 1000;
let jioIndexPromise = null;

function jioBuildIndex(songs) {
  const map = new Map();
  const put = (key, entry) => {
    if (!key) return;
    /* prefer entries that actually know their producer when a title key is
       shared by several versions */
    const existing = map.get(key);
    if (existing && existing.pr && !entry.pr) return;
    map.set(key, entry);
  };
  for (const s of songs) {
    put(norm(s.t || ""), s);
    put(norm(String(s.alt || s.alts || "").toString()), s);
    put(norm((s.t || "").replace(/\([^()]*\)/g, " ")), s);
    put(norm((s.alt || s.alts || "").toString().replace(/\([^()]*\)/g, " ")), s);
  }
  return map;
}

function jioIndex() {
  if (jioIndexPromise) return jioIndexPromise;
  jioIndexPromise = new Promise(function (resolve) {
    try {
      const cached = JSON.parse(fs.readFileSync(JIO_CACHE, "utf8"));
      if (cached && Array.isArray(cached.songs) && cached.songs.length &&
          Date.now() - Number(cached.fetchedAt || 0) < JIO_TTL) {
        return resolve(jioBuildIndex(cached.songs));
      }
    } catch (_) { /* no cache yet */ }
    resolve(null);
  }).then(function (fromCache) {
    if (fromCache) return fromCache;
    return get(JIO_URL, { timeout: 60000 }).then(function (r) {
      if (r.status !== 200) return null;
      let raw;
      try { raw = JSON.parse(r.body.toString("utf8")); } catch (_) { return null; }
      if (!raw || !Array.isArray(raw.songs) || !raw.songs.length) return null;
      try { fs.writeFileSync(JIO_CACHE, JSON.stringify({ fetchedAt: Date.now(), songs: raw.songs })); } catch (_) {}
      return jioBuildIndex(raw.songs);
    });
  });
  return jioIndexPromise;
}

function metadataFromJuiceIO(core, bare) {
  return jioIndex().then(function (map) {
    if (!map) return null;
    /* the tracker indexes songs both by their main title and their aka; the
       searchless lookup tries every shape the filename can produce. */
    const keys = [
      norm(bare), norm(core),
      norm((core || "").replace(VERSION_RE, " ")),
      bareKey(core), bareKey(bare),
    ];
    let entry = null;
    for (const k of keys) {
      if (k && map.has(k)) { entry = map.get(k); break; }
    }
    if (!entry) {
      /* containment: the shortest tracker title the filename starts with wins */
      const bareTarget = bareKey(core);
      let bestLen = 0;
      for (const [key, e] of map) {
        if (!key || key.length < 4 || !bareTarget.startsWith(key)) continue;
        if (key.length > bestLen && e.pr) { bestLen = key.length; entry = e; }
      }
    }
    if (!entry) return null;
    const pr = Array.isArray(entry.pr) ? entry.pr.join(", ") : String(entry.pr || "");
    const alts = [].concat(String(entry.alt || entry.alts || "").toString()).filter(Boolean);
    return {
      source: "juicewrld.io",
      name: entry.t || "",
      producers: pr,
      trackTitles: alts,
      year: firstYear(entry.rec) || firstYear(entry.pv) ||
        firstYear(entry.recT) || firstYear(entry.out) || "",
    };
  });
}

function metadataFromJuiceAPI(core, bare) {
  /* The vault indexes songs by their bare title; searching with the alias
     parens on ("Eye Contact (Mind Control)") finds nothing. */
  const q = bare || core;
  return get("https://juicewrldapi.com/juicewrld/songs/?search=" + encodeURIComponent(q), { json: true })
    .then(function (r) {
      if (r.status !== 200) return null;
      let data;
      try { data = JSON.parse(r.body.toString("utf8")); } catch (_) { return null; }
      const results = data && data.results ? data.results : [];
      const target = norm(core);
      /* The closest answer: its own title (or any of the alias titles) sits
         inside the filename's core, or the core sits inside the title. */
      let best = null, bestScore = -1;
      for (const song of results) {
        const titles = [song.name].concat(song.track_titles || []);
        for (const t of titles) {
          const n = norm(t);
          if (!n) continue;
          let score = 0;
          if (n === target) score = 8;
          else if (n.length && target.startsWith(n)) score = 6 + Math.min(n.length / target.length, 1);
          else if (target.length && n.startsWith(target)) score = 5;
          else if (target.length && n.includes(target)) score = 3;
          if (score > bestScore) { bestScore = score; best = song; }
        }
      }
      if (!best || bestScore < 3) return null;
      const year =
        firstYear(best.record_dates) || firstYear(best.release_date) ||
        firstYear(best.dates) || firstYear(best.era && best.era.time_frame) || "";
      return {
        source: "juicewrldapi",
        name: best.name || "",
        producers: best.producers || "",
        trackTitles: best.track_titles || [],
        year: year,
      };
    });
}

function metadataFromJuiceVault(core) {
  return get("https://juicevault.xyz/api/song?title=" + encodeURIComponent(core), { json: true, timeout: 10000 })
    .then(function (r) {
      if (r.status !== 200) return null;
      let data;
      try { data = JSON.parse(r.body.toString("utf8")); } catch (_) { return null; }
      if (!data || (!data.producer && !data.year && !data.title)) return null;
      return {
        source: "juicevault",
        name: data.title || "",
        producers: data.producer || "",
        trackTitles: data.altnames || [],
        year: String(data.year || ""),
      };
    })
    .catch(function () { return null; });
}

function bareKey(s) {
  return norm((s || "").replace(/\([^()]*\)/g, " ").replace(/\s+/g, " ").trim());
}

/* The bare title as a human would read it - parens stripped, spaces kept -
   which is what the vault's search answers to. */
function bareTitle(s) {
  return (s || "").replace(/\([^()]*\)/g, " ").replace(/\s+/g, " ").trim();
}

function metadataFor(core, bare) {
  /* q: the readable title - "Calm Down", not "calmdown". */
  const q = bare ? bareTitle(bare) : bareTitle(core);
  /* juicewrld.io's tracker data first (newest, keeps aka titles and recorded
     dates), then the older API sites when the tracker has not heard of it. */
  return metadataFromJuiceIO(core, q).then(function (a) {
    if (a) return a;
    return metadataFromJuiceAPI(core, q).then(function (b) {
      if (b) return b;
      return metadataFromJuiceVault(q);
    });
  });
}

/* --------------------------------------------------------- mp3 frame length */

function mp3Duration(buf) {
  try {
    let p = 0;
    if (buf.slice(0, 3).toString("latin1") === "ID3") {
      p = 10;
      const b0 = buf[6], b1 = buf[7], b2 = buf[8], b3 = buf[9];
      const size = ((b0 & 0x7f) << 21) | ((b1 & 0x7f) << 14) | ((b2 & 0x7f) << 7) | (b3 & 0x7f);
      p += size;
    }
    for (; p < buf.length - 128; p++) {
      if (buf[p] !== 0xff || (buf[p + 1] & 0xe0) !== 0xe0) continue;
      const frame = (buf[p + 1] << 8) | buf[p + 2];
      const ver = (buf[p + 1] >> 3) & 3;     // 0 = MPEG2.5, 1 = reserved, 2 = MPEG2, 3 = MPEG1
      const layer = (buf[p + 1] >> 1) & 3;   // 1 = Layer III
      if (ver === 1 || layer !== 1) continue;
      const bindex = (buf[p + 2] >> 4) & 15, sindex = (buf[p + 2] >> 2) & 3;
      const BR_WIDTHS = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
      const V2_BR = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
      const SR1 = [44100, 48000, 32000];
      const SR2 = [22050, 24000, 16000];
      const SR25 = [11025, 12000, 8000];
      let bitrate, sampleRate, samples;
      if (ver === 3) { bitrate = BR_WIDTHS[bindex]; sampleRate = SR1[sindex]; samples = 1152; }
      else { bitrate = V2_BR[bindex]; sampleRate = ver === 2 ? SR2[sindex] : SR25[sindex]; samples = 576; }
      if (!bitrate || !sampleRate) continue;
      /* Xing / Info header: frame count, so VBR files read exactly. */
      const sideInfo = ver === 3 ? 17 : 9;
      const tag = buf.slice(p + 4 + sideInfo, p + 8 + sideInfo).toString("latin1");
      if (tag === "Xing" || tag === "Info") {
        const flags = (buf[p + 8 + sideInfo + 4] << 24) | (buf[p + 8 + sideInfo + 5] << 16) |
          (buf[p + 8 + sideInfo + 6] << 8) | buf[p + 8 + sideInfo + 7];
        if (flags & 1) {
          const f = (buf[p + 8 + sideInfo + 8] << 24) | (buf[p + 8 + sideInfo + 9] << 16) |
            (buf[p + 8 + sideInfo + 10] << 8) | buf[p + 8 + sideInfo + 11];
          return Math.round((f * samples) / sampleRate);
        }
      }
      /* No Xing: treat as CBR - seconds = rest-bytes * 8 / bitrate. */
      return Math.round(((buf.length - p) * 8) / (bitrate * 1000));
    }
  } catch (_) {}
  return 0;
}

/* ------------------------------------------------------------- png palette */

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = Math.round(h * 60); if (h < 0) h += 360;
  }
  return { h: h, s: Math.round(s * 100), l: Math.round(l * 100) };
}

function decodePng(buf) {
  if (buf.slice(1, 4).toString("latin1") !== "PNG") return null;
  let p = 8, w = 0, h = 0, depth = 8, color = 0, interlace = 0, palette = null;
  const idats = [];
  while (p + 8 <= buf.length) {
    const len = (buf[p] << 24) | (buf[p + 1] << 16) | (buf[p + 2] << 8) | buf[p + 3];
    const type = buf.slice(p + 4, p + 8).toString("latin1");
    const data = buf.slice(p + 8, p + 8 + len);
    if (type === "IHDR") {
      w = (data[0] << 24) | (data[1] << 16) | (data[2] << 8) | data[3];
      h = (data[4] << 24) | (data[5] << 16) | (data[6] << 8) | data[7];
      depth = data[8]; color = data[9]; interlace = data[12];
    } else if (type === "PLTE") {
      palette = [];
      for (let i = 0; i < len; i += 3) palette.push([data[i], data[i + 1], data[i + 2]]);
    } else if (type === "IDAT") idats.push(data);
    else if (type === "IEND") break;
    p += 12 + len;
  }
  if (!w || !h || interlace || depth !== 8) return null;
  let channels;
  if (color === 2) channels = 3;
  else if (color === 6) channels = 4;
  else if (color === 0) channels = 1;
  else if (color === 4) channels = 2;
  else if (color === 3) channels = 1;
  else return null;
  let raw;
  try { raw = zlib.inflateSync(Buffer.concat(idats)); } catch (_) { return null; }
  const stride = w * channels;
  const out = Buffer.alloc(h * stride);
  let pos = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[pos++];
    if (pos + stride > raw.length) return null;
    const line = raw.slice(pos, pos + stride);
    pos += stride;
    const prev = y ? out.slice((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    const frag = out.slice(y * stride, y * stride + stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? frag[x - channels] : 0;
      const bnode = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      let v = line[x];
      if (filter === 1) v = (v + a) & 255;
      else if (filter === 2) v = (v + bnode) & 255;
      else if (filter === 3) v = (v + ((a + bnode) >> 1)) & 255;
      else if (filter === 4) {
        const pn = a + bnode - c;
        const pa = Math.abs(pn - a), pb = Math.abs(pn - bnode), pc = Math.abs(pn - c);
        v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? bnode : c)) & 255;
      }
      frag[x] = v;
    }
  }
  /* band averages: the cover's top strip and its bottom strip. */
  const bandAvg = function (y0, y1) {
    let r = 0, g = 0, b = 0, n = 0;
    const step = Math.max(1, Math.floor(((y1 - y0) * w * stride) / 4000));
    const yStart = Math.max(0, Math.floor(y0)), yEnd = Math.min(h, Math.max(yStart + 1, Math.floor(y1)));
    for (let y = yStart; y < yEnd; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * stride + x * channels;
        if (i + 2 >= out.length) continue;
        if (color === 6 && out[i + 3] < 32) continue;
        if (color === 3 && palette) { const e = palette[out[i]] || [0, 0, 0]; r += e[0]; g += e[1]; b += e[2]; }
        else if (color === 2) { r += out[i]; g += out[i + 1]; b += out[i + 2]; }
        else if (color === 6) { r += out[i]; g += out[i + 1]; b += out[i + 2]; }
        else { r += out[i]; g += out[i]; b += out[i]; } // gray channels
        n++;
        break; /* one pixel per row: keeps it cheap and still representative */
      }
    }
    if (!n) return { h: 0, s: 0, l: 40 };
    return rgbToHsl(r / n, g / n, b / n);
  };
  return {
    top: bandAvg(0, h / 5), bottom: bandAvg(h * 4 / 5, h),
    width: w, height: h,
  };
}

function gradientFromPng(buf) {
  const png = decodePng(buf);
  if (!png) return null;
  return gradientFromBands(png.top, png.bottom);
}

/* The gradient from a jpeg cover and the odd-but-real case of a .png that is
   actually a jpeg: jimp decodes both, when it is installed - it is a
   devDependency exactly for this script. Without it, only real pngs decode.
   Returns "linear-gradient(135deg,hsl(...),hsl(...))". */
async function gradientFromImage(buf) {
  let bands = null;
  try {
    const jimp = await (function () { try { return import("jimp"); } catch (_) { return null; } })();
    const J = jimp && (jimp.default || jimp);
    if (J && (J.read || J.Jimp)) {
      const img = await J.read(buf);
      const w = img.bitmap.width, h = img.bitmap.height, d = img.bitmap.data;
      const avg = function (y0, y1) {
        let r = 0, g = 0, b = 0, n = 0;
        const yS = Math.max(0, Math.floor(y0)), yE = Math.min(h, Math.max(yS + 1, Math.floor(y1)));
        for (let y = yS; y < yE; y++) {
          const i = (y * w + Math.floor(w / 2)) * 4; /* the middle column */
          r += d[i]; g += d[i + 1]; b += d[i + 2]; n++;
        }
        return n ? rgbToHsl(r / n, g / n, b / n) : { h: 0, s: 0, l: 40 };
      };
      bands = { top: avg(0, h / 5), bottom: avg(h * 4 / 5, h) };
    }
  } catch (_) { /* jimp not installed or unreadable - fall through to png */ }
  if (!bands) {
    const png = decodePng(buf);
    if (png) bands = png;
  }
  if (!bands) return null;
  return gradientFromBands(bands.top, bands.bottom);
}

function gradientFromBands(top, bottom) {
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const pick = function (c, lShift) {
    const l = clamp(c.l <= 8 ? 8 : c.l, 18, 78) - lShift;
    return "hsl(" + c.h + "," + clamp(c.s < 12 ? (c.s + 18) : c.s, 12, 88) + "%," + clamp(l, 18, 75) + "%)";
  };
  return "linear-gradient(135deg," + pick(top, 0) + "," + pick(bottom, 4) + ")";
}

/* ------------------------------------------------------------- cover match */

function coverFor(stem, coverFiles) {
  const core = norm(coreStem(stem));
  const stemNorm = norm(stem.replace(VERSION_RE, " ").replace(/\s+/g, " "));
  /* First pass: exact core-title cover ("All In (Sun) (WOD)" -> "All In.png"). */
  for (const f of coverFiles) {
    if (norm(f.replace(/\.png$/i, "")) === core) return f;
  }
  /* Second pass: exact whole-stem cover ("Militia (One)" -> "Militia (One).png" etc). */
  for (const f of coverFiles) {
    if (norm(f.replace(/\.png$/i, "")) === stemNorm) return f;
  }
  /* Third pass: a cover whose name the core starts with, longest first. */
  let best = "", bestLen = 0;
  for (const f of coverFiles) {
    const n = norm(f.replace(/\.png$/i, ""));
    if (n && core.startsWith(n) && n.length > bestLen) { best = f; bestLen = n.length; }
  }
  return best;
}

/* ------------------------------------------------------------------ main */

(async function main() {
  if (DISABLED) {
    log("auto sync is DISABLED (AUTO_SYNC_DISABLED=1) - nothing was read, nothing was written.");
    return;
  }
  const { list: trackList, src: tracksSrc } = readTrackList();
  log("tracks.js: " + trackList.length + " entries");

  const audioRes = await get(API + "Audio", { headers: GITHUB_TOKEN ? { Authorization: "Bearer " + GITHUB_TOKEN } : {}, json: true });
  const coversRes = await get(API + "Covers", { headers: GITHUB_TOKEN ? { Authorization: "Bearer " + GITHUB_TOKEN } : {}, json: true });
  function fileList(res, ext) {
    if (res.status !== 200) throw new Error("could not list " + ext + " files: " + res.status);
    return JSON.parse(res.body.toString("utf8"))
      .filter((f) => f.type === "file" && new RegExp("\\." + ext + "$", "i").test(f.name))
      .map((f) => f.name);
  }
  const audioFiles = fileList(audioRes, "mp3");
  const coverFiles = fileList(coversRes, "png");
  log("repo: " + audioFiles.length + " mp3 in Audio/, " + coverFiles.length + " png in Covers/");

  const stemsInTracks = new Set(trackList.map((t) => urlStemAndName(t.url, "/Audio/")[0]));
  const coresInTracks = new Set(trackList.map((t) => norm(coreStem(urlStemAndName(t.url, "/Audio/")[0]))));
  const baresInTracks = new Set(trackList.map((t) => bareKey(urlStemAndName(t.url, "/Audio/")[0])));

  const newFiles = audioFiles.filter(function (n) {
    const stem = n.replace(/\.mp3$/i, "");
    if (stemsInTracks.has(stem)) return false;
    /* a differently-named copy of a song that is already in the list is not
       new - the (v5) copy, the renamed copy, the alias-noted copy - and would
       only double the row, so it is skipped and reported as "already there". */
    const core = coreStem(stem);
    return !coresInTracks.has(norm(core)) && !baresInTracks.has(bareKey(stem));
  });

  log("new songs: " + newFiles.length);
  if (newFiles.length) {
    newFiles.forEach(function (n) { log("   + " + n); });
    log("");
  }
  if (DRY) log("DRY RUN - no file is changed. Set AUTO_SYNC_WRITE=1 to write, AUTO_SYNC_COMMIT=1 to write+push.");
  else if (!COMMIT) log("WRITE MODE - files are changed, nothing is committed.");

  let added = 0, missingMeta = 0, missingCover = 0;
  const addedTitles = [];

  for (const file of newFiles) {
    log("- " + file);
    const stem = file.replace(/\.mp3$/i, "");
    const core = coreStem(stem);
    const isSessions = /\(Sessions\)/i.test(stem);
    const meta = await metadataFor(core, bareTitle(stem));
    let title = core.replace(VERSION_RE, " ").replace(/\s+/g, " ").trim();
    if (isSessions) title += " (Sessions)";
    let producer = "";
    let year = "";
    let altnames = [];
    if (meta) {
      title = meta.name || title;
      if (isSessions && !/\(Sessions\)/i.test(title)) title += " (Sessions)";
      producer = meta.producers || "";
      year = meta.year || "";
      const seen = new Set([norm(title), norm(core), norm(stem), norm(bareTitle(stem)),
        norm(title.replace(/\s*\((Sessions|Halloween)\)/i, ""))]);
      altnames = (meta.trackTitles || []).filter(function (t) {
        const nn = norm(t);
        if (!nn || seen.has(nn)) return false;
        seen.add(nn); return true;
      });
      log("   meta: " + meta.source + " | title=" + title + " | producer=" + producer + " | year=" + year + " | altnames=" + altnames.length);
    } else {
      missingMeta++;
      warn("no metadata found for \"" + bareTitle(stem) + "\" - leaving producer/year/altnames empty");
    }

    /* duration: read the file's own frame headers. */
    const audioUrl = RAW + "Audio/" + encodeURIComponent(file);
    const t0 = Date.now();
    const audioRes = await get(audioUrl, { timeout: 120000 });
    let duration = audioRes.status === 200 ? mp3Duration(audioRes.body) : 0;
    if (!duration && audioRes.status === 200) {
      duration = Math.max(30, Math.round(audioRes.body.length / (40000))); // 320kbps fallback
      warn("could not read the mp3 frames precisely; approximating " + duration + "s from the file size");
    }
    log("   audio: " + (audioRes.status === 200 ? (audioRes.body.length / 1048576).toFixed(1) + " MB in " + ((Date.now() - t0) / 1000).toFixed(1) + "s" : "HTTP " + audioRes.status) + " -> " + duration + "s");
    if (audioRes.status !== 200) { warn("audio is unreachable, skipping this song"); continue; }

    /* cover + its gradient. */
    let coverFile = coverFor(stem, coverFiles);
    if (!coverFile) {
      /* maybe the cover exists under the API's own title */
      if (meta && meta.name) coverFile = coverFor(meta.name, coverFiles);
    }
    let coverUrl = "";
    if (coverFile) {
      coverUrl = RAW + "Covers/" + encodeURIComponent(coverFile);
      const covRes = await get(coverUrl, { timeout: 60000 });
      if (covRes.status === 200) {
        const gradient = await gradientFromImage(covRes.body);
        log("   cover: " + coverFile + (gradient ? " -> gradient " + gradient : " -> could not decode the image"));
        if (!gradient) {
          warn("no gradient could be read from \"" + coverFile + "\" -- the cover still work, the fallback white gradient just shows");
        } else if (DRY) {
          log("   gradient table: (dry run) would add Covers/" + coverFile);
        } else if (ensureGradient("Covers/" + coverFile, gradient)) {
          log("   gradient table: +" + ("Covers/" + coverFile));
        }
      } else {
        warn("cover is unreachable (" + covRes.status + ")");
      }
    } else {
      missingCover++;
      warn("no cover png found in Covers/ - the entry keeps an empty cover; add one by hand");
    }

    /* the entry itself, in the same shape as its neighbours. */
    const entry = "  {" +
      "\n    title: " + JSON.stringify(title) + "," +
      "\n    tag: " + JSON.stringify(stem) + "," +
      "\n    artist: \"Juice WRLD\"," +
      (altnames.length ? "\n    altnames: " + JSON.stringify(altnames) + "," : "") +
      "\n    category: " + JSON.stringify(isSessions ? "sessions" : "leaks") + "," +
      "\n    url: " + JSON.stringify(RAW.replace(/\/$/, "") + "/Audio/" + file.split("/").map(encodeURIComponent).join("/")) + "," +
      "\n    duration: " + duration + "," +
      (coverUrl ? "\n    cover: " + JSON.stringify(RAW.replace(/\/$/, "") + "/Covers/" + coverFile.split("/").map(encodeURIComponent).join("/")) + ","
        : "\n    cover: \"\",") +
      "\n    producer: " + JSON.stringify(producer) + "," +
      "\n    year: " + JSON.stringify(year) +
      "\n  }";

    if (!DRY) {
      fs.writeFileSync(TRACKS_JS, appendEntry(tracksSrc, entry));
    } else {
      log("   (dry run: entry not written)");
      log(entry.split("\n").map((l) => "     " + l.trim()).join("\n"));
    }
    added++;
    addedTitles.push(title);
  }

  /* a batch of new songs is a release: add its WRLD LOG entry, in the same
     notes style as earlier "N new tracks" notes (see v3.0 / v4.5). */
  let loggedEntryVersion = "";
  if (addedTitles.length >= LOG_MIN) {
    loggedEntryVersion = ensureLogEntry(addedTitles);
  }

  /* self-heal: an existing track can still be missing its gradient key - a
     lost edit, or an entry added before this script existed. Blind cron runs
     repair such gaps here instead of leaving the filename-hash fallback
     (e.g. pink Smile) on screen. Purposely runs even when no song is new. */
  let backfilled = 0;
  if (!DRY) {
    const seen = [];
    const re = /cover: "((?:https:\/\/[^"]+)?)"/g;
    let m2;
    while ((m2 = re.exec(tracksSrc)) !== null) {
      if (m2[1] && seen.indexOf(m2[1]) < 0) seen.push(m2[1]);
    }
    let scriptSrc = fs.readFileSync(SCRIPT_JS, "utf8");
    for (const coverUrl of seen) {
      const bare = decodeURIComponent(String(coverUrl).split("/Covers/").pop());
      if (scriptSrc.includes('"' + bare + '"') || scriptSrc.includes('"Covers/' + bare + '"')) continue;
      const covRes = await get(coverUrl, { timeout: 60000 });
      if (covRes.status !== 200) { warn("backfill cover " + bare + " is unreachable (" + covRes.status + ")"); continue; }
      const gradient = await gradientFromImage(covRes.body);
      if (!gradient) { warn("backfill: could not decode " + bare); continue; }
      if (ensureGradient("Covers/" + bare, gradient)) {
        log("gradient table (backfill): +Covers/" + bare);
        backfilled++;
        scriptSrc = fs.readFileSync(SCRIPT_JS, "utf8");
      }
    }
    if (backfilled) log("backfill: " + backfilled + " missing gradient key(s) restored");
  }

  log("");
  log("summary: " + added + " new song(s) processed (" + missingMeta + " without metadata, " + missingCover + " without a cover)" + (backfilled ? "; " + backfilled + " gradient key(s) backfilled" : ""));

  /* Hand the run's numbers to the workflow, which posts them to the site so
     the Vault Sync tab shows what the pipeline last did. Only when
     SYNC_REPORT_PATH is set - a local run with no workflow around it writes
     nothing. A failed write is a warning, never an abort: the sync itself
     already succeeded, and a lost report is not worth a red Actions cross. */
  writeRunReport({
    outcome: "ok",
    note: added + " new song(s) processed (" + missingMeta + " without metadata, " + missingCover + " without a cover)" +
      (backfilled ? "; " + backfilled + " gradient key(s) backfilled" : ""),
    added: added,
    missing_meta: missingMeta,
    missing_cover: missingCover,
    backfilled: backfilled,
    dry_run: DRY,
    ref: BRANCH,
  });

  if (COMMIT && (added > 0 || backfilled > 0)) {
    commitAndPush(["tracks.js", "script.js", "wrldlog-data.js"]);
  }
})().catch(function (err) {
  warn("fatal: " + (err && err.message ? err.message : err));
  writeRunReport({
    outcome: "error",
    note: "fatal: " + String(err && err.message ? err.message : err).slice(0, 300),
  });
  process.exit(1);
});

/* ------------------------------------------------------- workflow reporting */

/* The workflow sets SYNC_REPORT_PATH to a workspace file it deletes itself on
   the next run; this script drops the run's numbers there as JSON. Kept
   best-effort: the file is only written when the workflow asks for it, and
   any error is printed without failing the run. */
function writeRunReport(r) {
  const p = process.env.SYNC_REPORT_PATH;
  if (!p) return;
  try {
    fs.writeFileSync(
      p,
      JSON.stringify(
        Object.assign(
          { event: process.env.GITHUB_EVENT_NAME || "", outcome: "ok", note: "", added: 0, missing_meta: 0, missing_cover: 0, backfilled: 0, dry_run: false, ref: "" },
          r
        )
      )
    );
  } catch (e) {
    warn("run report not written: " + (e && e.message ? e.message : e));
  }
}

/* ----------------------------------------------------------- file surgery */

/* A batch of songs added by the pipeline is itself a release. wrldlog-data.js
   holds every version, newest first, and wrldlog.js renders whatever is in
   there - so the log entry is appended to the data, never to the DOM. Format
   matched to the older "N new tracks" notes (v3.0 / v4.5). Returns the new
   version tag, or "" when nothing was written (dry run, threshold, or a
   wrldlog-data.js that someone has since renumbered unexpectedly). */
function ensureLogEntry(titles) {
  var src;
  try {
    src = fs.readFileSync(WRLDLOG_JS, "utf8");
  } catch (e) {
    warn("wrldlog-data.js is unreadable; no release noted");
    return "";
  }
  var start = src.indexOf("window.THW_WRLDLOG = [");
  if (start < 0) { warn("no window.THW_WRLDLOG array; no release noted"); return ""; }
  var bracket = start + "window.THW_WRLDLOG = [".length;
  var newest = /^\s+version: "(v\d+\.\d)"/m.exec(src.slice(bracket));
  if (!newest) { warn("could not read the newest WRLD LOG version; no release noted"); return ""; }
  var next = nextLogVersion(newest[1]);
  if (next === "" || src.indexOf('version: "' + next + '"') >= 0) {
    warn("WRLD LOG version " + next + " is unavailable; skipping the release note");
    return "";
  }
  if (DRY) {
    log("(dry run) would note release " + next + ": " + titles.length + " new track(s)");
    return "";
  }
  var names = titles.join(", ");
  var notes = titles.length + " new tracks: " + names +
    " - added by the vault auto-sync, each with its own cover & gradient";
  var entry = "  {\n" +
    "    version: " + JSON.stringify(next) + ",\n" +
    "    title: \"" + titles.length + " new tracks, added by the vault auto-sync\",\n" +
    "    notes: " + JSON.stringify(notes) + ",\n" +
    "  },";
  src = src.slice(0, bracket + 1) + "\n" + entry + src.slice(bracket + 1);
  fs.writeFileSync(WRLDLOG_JS, src);
  log("wrldlog: added release note " + next + " (" + titles.length + " new track(s))");
  return next;
}

/* v4.6 -> v4.7; at v4.9 the next release becomes v5.0, so the sequence
   never leaves a hole. "" when the label cannot be parsed. */
function nextLogVersion(v) {
  var m = /^v(\d+)\.(\d)$/.exec(String(v));
  if (!m) return "";
  var a = Number(m[1]), b = Number(m[2]);
  return b >= 9 ? "v" + (a + 1) + ".0" : "v" + a + "." + (b + 1);
}

/* tracks.js ends with the array close ("];") and then the sort call. New
   entries go before the close, with a comma after the previous entry. */
function appendEntry(src, entry) {
  const closeIdx = src.lastIndexOf("];");
  if (closeIdx < 0) throw new Error("tracks.js has no ];");
  let head = src.slice(0, closeIdx).replace(/\s+$/, "");
  if (head.endsWith("[") || head.endsWith("[")) {
    /* an empty list: nothing to comma */
  } else if (!head.endsWith(",")) {
    head += ",";
  }
  return head + "\n" + entry + "\n" + src.slice(closeIdx);
}

/* script.js holds the gradient table as one long object literal: keys are
   "Covers/<file>" and values "linear-gradient(...)" - neither kind of string
   ever contains a brace, so the object's own closing brace is simply the
   first "}" after the opening one. A quote-state walk is NOT safe here: the
   map shares a physical line with 100k+ chars of minified code where
   template literals and regexes make quote tracking drift, and a misplaced
   insert broke the whole file once. The shape is also verified before the
   edit; any surprise means "don't touch script.js" and a hand edit. */
function ensureGradient(key, gradient) {
  let src = fs.readFileSync(SCRIPT_JS, "utf8");
  const idx = src.indexOf("var coverGradientMap={");
  if (idx < 0) { warn("coverGradientMap not found in script.js"); return false; }
  const start = idx + "var coverGradientMap=".length;
  if (src[start] !== "{") { warn("coverGradientMap is missing its opening brace"); return false; }
  const insert = src.indexOf("}", start);
  if (insert < 0) { warn("coverGradientMap seems unbalanced"); return false; }
  const seg = src.slice(start, insert);
  if (!/^\{"Covers\//.test(seg) || !/:"linear-gradient\(135deg,/.test(seg)) {
    warn("coverGradientMap does not look like the expected literal; not editing script.js");
    return false;
  }
  if (seg.includes("\"" + key + "\"")) return false;
  /* The last existing entry carries no trailing comma, so the addition
     leads with one instead - whatever runs, first or tenth, the literal
     stays "value","key":"value" ...,"key":"value". */
  /* single-quoted on purpose: a double-quoted "\"," resolves to the two
     characters '",', which corrupts the map instead of extending it */
  const addition = ',"' + key + '":"' + gradient + '"';
  src = src.slice(0, insert) + addition + src.slice(insert);
  fs.writeFileSync(SCRIPT_JS, src);
  return true;
}

function commitAndPush(files) {
  if (!fs.existsSync(path.join(ROOT, ".git"))) { warn("not a git checkout; leaving the changes uncommitted"); return; }
  const env = Object.assign({}, process.env);
  if (!env.GIT_AUTHOR_NAME) env.GIT_AUTHOR_NAME = "Track Sync Bot";
  if (!env.GIT_COMMITTER_NAME) env.GIT_COMMITTER_NAME = "Track Sync Bot";
  try {
    execFileSync("git", ["add"].concat(files), { cwd: ROOT, stdio: "inherit" });
    const status = execFileSync("git", ["status", "--porcelain", "--"].concat(files), { cwd: ROOT, encoding: "utf8" });
    if (!status.trim()) { log("nothing to commit"); return; }
    execFileSync("git", ["-c", "user.name=Track Sync Bot", "-c", "user.email=track-sync@thehighwrld",
      "commit", "-m", "Track sync: add new song(s) and their cover gradients from " + AUDIO_REPO],
      { cwd: ROOT, stdio: "inherit" });
    log("committed");
    try { execFileSync("git", ["push"], { cwd: ROOT, stdio: "inherit" }); log("pushed"); }
    catch (e) { warn("push failed: " + e.message + " - the commit is still in the checkout"); }
  } catch (e) {
    warn("git step failed: " + e.message + " - the changes are still on the disk");
  }
}
