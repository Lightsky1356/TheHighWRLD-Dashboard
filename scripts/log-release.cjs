#!/usr/bin/env node
/* log-release -- add a new WRLD LOG version entry by hand.
 *
 * The auto-sync pipeline logs song batches on its own (see
 * AUTO_SYNC_LOG_MIN); manual batches - a big feature shipped to the site -
 * use this instead of editing wrldlog-data.js by hand, so the version
 * sequence stays continuous and the notes keep the house format.
 *
 * Usage:
 *   node scripts/log-release.cjs "Title" ["chip 1" "chip 2" ...]
 *
 * Dry run by default: it prints the entry it would add and touches nothing.
 * Set AUTO_SYNC_WRITE=1 to write. Writing also bumps the wrldlog-data.js
 * cache token in index.html and sw.js and sw.js's VERSION, so check-tokens
 * stays green; commit afterwards (git add wrldlog-data.js index.html sw.js).
 */

var fs = require("fs");
var path = require("path");

var ROOT = path.join(__dirname, "..");
var WRLDLOG_JS = path.join(ROOT, "wrldlog-data.js");
var INDEX_HTML = path.join(ROOT, "index.html");
var SW_JS = path.join(ROOT, "sw.js");
var WRITE = process.env.AUTO_SYNC_WRITE === "1";

var args = process.argv.slice(2).filter(function (a) { return a && a.trim(); });
if (!args.length) {
  console.log("usage: node scripts/log-release.cjs \"Title\" [\"chip 1\" ...]");
  process.exit(1);
}
var title = args[0].trim();
var chips = args.slice(1).map(function (c) { return c.trim(); });

function main() {
  var src = fs.readFileSync(WRLDLOG_JS, "utf8");
  var start = src.indexOf("window.THW_WRLDLOG = [");
  if (start < 0) die("window.THW_WRLDLOG array not found");
  var bracket = start + "window.THW_WRLDLOG = [".length;
  var newest = /^\s+version: "(v\d+\.\d)"/m.exec(src.slice(bracket));
  if (!newest) die("could not read the newest version from data[0]");
  var next = nextVersion(newest[1]);
  if (src.indexOf('version: "' + next + '"') >= 0) {
    die(next + " already exists in wrldlog-data.js");
  }

  /* the house format: chips exist, notes is the chips joined with the
     middot separator after the title (see the v4.6 entry). */
  var entry = { version: next, title: title,
    notes: title + (chips.length ? " \u00b7 " + chips.join(" \u00b7 ") : "") };

  /* chips are optional: older entries carry only version + notes. */
  var insertion = "  {\n" +
    "    version: " + JSON.stringify(entry.version) + ",\n" +
    "    title: " + JSON.stringify(entry.title) + ",\n" +
    (chips.length ? "    chips: " + JSON.stringify(chips) + ",\n" : "") +
    "    notes: " + JSON.stringify(entry.notes) + ",\n" +
    "  },\n";

  console.log(entry.version + " \u2014 " + entry.title);
  chips.forEach(function (c) { console.log("   - " + c); });

  if (!WRITE) {
    console.log("dry run - nothing written; set AUTO_SYNC_WRITE=1 to write");
    return;
  }

  src = src.slice(0, bracket + 1) + "\n" + insertion.slice(0, -1) + src.slice(bracket + 1);
  fs.writeFileSync(WRLDLOG_JS, src);
  var bumped = bumpTokens();
  if (bumped) console.log("written; cache tokens bumped (" + bumped + ")");
  console.log("now commit wrldlog-data.js index.html sw.js and push");
}

/* v4.6 -> v4.7, v4.9 -> v5.0 - the sequence never skips. */
function nextVersion(v) {
  var m = /^v(\d+)\.(\d)$/.exec(v);
  if (!m) die("unparsed version " + v);
  var a = Number(m[1]), b = Number(m[2]);
  return b >= 9 ? "v" + (a + 1) + ".0" : "v" + a + "." + (b + 1);
}

/* ./wrldlog-data.js?v=thw-vN appears once per file, plus sw VERSION. */
function bumpTokens() {
  var touched = [];
  bump(INDEX_HTML, function (s) {
    var m = /wrldlog-data\.js\?v=thw-v(\d+)/.exec(s);
    if (!m) return null;
    return s.replace("wrldlog-data.js?v=thw-v" + m[1], "wrldlog-data.js?v=thw-v" + (Number(m[1]) + 1));
  });
  bump(SW_JS, function (s) {
    var m = /wrldlog-data\.js\?v=thw-v(\d+)/.exec(s);
    if (!m) return null;
    return s.replace("wrldlog-data.js?v=thw-v" + m[1], "wrldlog-data.js?v=thw-v" + (Number(m[1]) + 1));
  });
  bump(SW_JS, function (s) {
    var m = /const VERSION = 'thw-v(\d+)'/.exec(s);
    if (!m) return null;
    var n = Number(m[1]) + 1;
    return s.replace("const VERSION = 'thw-v" + m[1] + "'", "const VERSION = 'thw-v" + n + "'");
  });
  return touched.join(", ") || null;

  function bump(file, fn) {
    var s = fs.readFileSync(file, "utf8");
    var out = fn(s);
    if (out && out !== s) { fs.writeFileSync(file, out); touched.push(path.basename(file)); }
  }
}

function die(msg) {
  console.error("log-release: " + msg);
  process.exit(1);
}

main();
