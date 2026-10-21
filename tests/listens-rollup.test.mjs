/* The listening summaries: the kept ones must say the same as the history.
 *
 * The rollup exists so that a profile view does not read a member's whole
 * listening history four times over. But a summary that says something
 * different from the history is worse than an expensive one, so this checks
 * that the two agree - on the totals, on the most played tracks, on the
 * days, on the hours of the day and on the months - and that a play keeps
 * the summaries in step with the history.
 *
 * Run: node tests/listens-rollup.test.mjs
 */
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let passed = 0;
let failed = 0;

function ok(cond, label, detail) {
  if (cond) { passed++; console.log("  PASS  " + label); }
  else {
    failed++;
    console.log("  FAIL  " + label + (detail ? "  ->  " + detail : ""));
  }
}

function same(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/* A small stand-in for the database, with the shape the code expects:
   prepare(sql).bind(...).first() / .all() / .run(), and batch(). */
function shim(db, opts) {
  const refuseToCreate = opts && opts.refuseToCreate;
  return {
    prepare(sql) {
      if (refuseToCreate && /^CREATE TABLE/i.test(sql)) {
        throw new Error("CREATE TABLE is not allowed here");
      }
      const stmt = db.prepare(sql);
      return {
        bind(...args) {
          return {
            first: async () => stmt.get(...args) ?? null,
            all: async () => ({ results: stmt.all(...args) }),
            run: async () => stmt.run(...args),
          };
        },
      };
    },
    async batch(stmts) {
      for (const s of stmts) await s.run();
    },
  };
}

/* The history, spread over days, hours and tracks so that every summary
   has something to say. */
function seed(db) {
  const insert = db.prepare(
    "INSERT INTO listens (uid, track_id, seconds, ts) VALUES (?, ?, ?, ?)"
  );
  const tracks = ["Alpha", "Beta", "Gamma", "Delta"];
  let n = 0;
  for (let day = 0; day < 40; day++) {
    const plays = day % 7 === 3 ? 0 : 2 + (day % 5);
    for (let p = 0; p < plays; p++) {
      const d = new Date(Date.UTC(2026, 8, 1 + day, 3 + (p * 7) % 20, 15, 5));
      insert.run("tester", tracks[(day + p) % tracks.length], 30 + p * 3, d.toISOString());
      n++;
    }
  }
  return n;
}

/* ------------------------------------------------------------------ */
console.log("The kept summaries must say the same as the history");

const db = new DatabaseSync(":memory:");
db.exec(`CREATE TABLE listens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL DEFAULT 'anon',
  track_id TEXT NOT NULL DEFAULT '',
  seconds INTEGER NOT NULL DEFAULT 0,
  ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);`);
/* The tables come from the migration file itself, so the migration is
   exercised by this test as well. */
db.exec(fs.readFileSync(path.join(ROOT, "migrations/0047_listens_rollup.sql"), "utf8"));
const seeded = seed(db);
const d = shim(db);

const modUrl = pathToFileURL(path.join(ROOT, "functions/_lib/listens-stats.js")).href;
const mod = await import(modUrl + "?t=" + Date.now());

/* The history itself. */
const raw = await mod.rawStats(d, "tester", { topLimit: 10 });

ok(raw.plays === seeded, "the totals count every play", `${raw.plays} of ${seeded}`);
ok(raw.seconds > 0, "the totals count the seconds");
ok(raw.uniqueTracks === 4, "the totals count the distinct tracks", String(raw.uniqueTracks));
ok(raw.top.length === 4, "every track that was played is listed");
ok(
  raw.top.every((t, i) => i === 0 || raw.top[i - 1].n >= t.n),
  "the most played tracks come back in order"
);
ok(raw.days.length === 34, "the days that were played are listed", String(raw.days.length));
ok(
  raw.days.every((x) => /^\d{4}-\d{2}-\d{2}$/.test(x)),
  "the days are in the shape the summaries use"
);
ok(raw.hours.length === 24, "there is an hour for every hour of the day");
ok(raw.hours.some((h) => h > 0), "the hours show where the plays went");
ok(raw.byMonth.length >= 1, "the months are listed");

/* The summaries, built from that history. */
const rolled = await mod.rollupStats(d, "tester", { topLimit: 10 });

ok(rolled.plays === raw.plays, "the summaries count the same plays", `${rolled.plays} of ${raw.plays}`);
ok(rolled.seconds === raw.seconds, "the summaries count the same seconds");
ok(rolled.uniqueTracks === raw.uniqueTracks, "the summaries count the same distinct tracks");
ok(same(rolled.top, raw.top), "the summaries list the same most played tracks");
ok(same(rolled.days, raw.days), "the summaries list the same days");
ok(same(rolled.hours, raw.hours), "the summaries show the same hours");
ok(same(rolled.byMonth, raw.byMonth), "the summaries list the same months");
ok(same(rolled.activity30, raw.activity30), "the summaries show the same last thirty days");
ok(
  rolled.daily.reduce((a, r) => a + r.n, 0) === raw.daily.reduce((a, r) => a + r.n, 0),
  "the day by day figures add up to the same thing"
);

/* A play, and the summaries keeping up with it. */
await mod.recordPlay(d, "tester", "Epsilon", 45);
const afterRaw = await mod.rawStats(d, "tester", { topLimit: 10 });
const afterRoll = await mod.rollupStats(d, "tester", { topLimit: 10 });
ok(afterRaw.plays === raw.plays + 1, "the play is in the history");
ok(afterRoll.plays === afterRaw.plays, "the summaries kept up with the play");
ok(afterRoll.uniqueTracks === afterRaw.uniqueTracks, "the summaries counted the new track");
ok(
  afterRoll.top.every((t, i) => i === 0 || afterRoll.top[i - 1].n >= t.n),
  "the summaries are still in order after the play"
);

/* The same play twice is not counted twice. */
await mod.recordPlay(d, "tester", "Epsilon", 45);
const twice = await mod.rollupStats(d, "tester", { topLimit: 10 });
ok(twice.plays === afterRoll.plays + 1, "a second play is a second play");

/* Forgetting the plays forgets the summaries too. */
await mod.clearPlays(d, "tester");
const cleared = await mod.rollupStats(d, "tester", { topLimit: 10 });
ok(cleared.plays === 0, "forgetting the plays clears the summaries");

/* Moving a member's plays to another member. */
db.prepare("INSERT INTO listens (uid, track_id, seconds, ts) VALUES (?, ?, ?, ?)").run("old", "Zeta", 60, new Date().toISOString());
db.prepare("INSERT INTO listens (uid, track_id, seconds, ts) VALUES (?, ?, ?, ?)").run("new", "Eta", 60, new Date().toISOString());
await mod.movePlays(d, "old", "new");
const moved = await mod.rollupStats(d, "new", { topLimit: 10 });
ok(moved.plays === 2, "the moved plays arrived", String(moved.plays));
ok(moved.uniqueTracks === 2, "both tracks arrived");
const gone = await mod.rollupStats(d, "old", { topLimit: 10 });
ok(gone.plays === 0, "nothing is left behind");

/* ------------------------------------------------------------------ */
console.log("");
console.log("A database with no tables at all");

/* The tables are made by the code, so the fix does not wait for a
   migration: a database that has never seen them gets them the first time
   they are needed. */
const bare = new DatabaseSync(":memory:");
bare.exec(`CREATE TABLE listens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL DEFAULT 'anon',
  track_id TEXT NOT NULL DEFAULT '',
  seconds INTEGER NOT NULL DEFAULT 0,
  ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);`);
seed(bare);
const bareDb = shim(bare);
const bareMod = await import(modUrl + "?t=bare" + Date.now());

const made = await bareMod.listeningStats(bareDb, "tester", { topLimit: 10 });
ok(made.plays === seeded, "the answers are right when the tables were made on the spot", String(made.plays));
ok(made.top.length === 4, "the most played tracks are listed when the tables were made on the spot");
ok(made.days.length === 34, "the days are listed when the tables were made on the spot");
ok(made.hours.some((h) => h > 0), "the hours are shown when the tables were made on the spot");

/* A play is recorded and counted, whichever way the answer is reached. */
await bareMod.recordPlay(bareDb, "tester", "Theta", 30);
const bareAfter = await bareMod.listeningStats(bareDb, "tester", { topLimit: 10 });
ok(bareAfter.plays === seeded + 1, "a play is recorded", String(bareAfter.plays));

/* And when the tables cannot be made - because the migration has not run
   and the database will not let it - everything falls back to the history. */
const refused = new DatabaseSync(":memory:");
refused.exec(`CREATE TABLE listens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL DEFAULT 'anon',
  track_id TEXT NOT NULL DEFAULT '',
  seconds INTEGER NOT NULL DEFAULT 0,
  ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);`);
seed(refused);
const refusedDb = shim(refused, { refuseToCreate: true });
const refusedMod = await import(modUrl + "?t=refused" + Date.now());

const fallback = await refusedMod.listeningStats(refusedDb, "tester", { topLimit: 10 });
ok(fallback.plays === seeded, "the fallback counts every play", String(fallback.plays));
ok(fallback.top.length === 4, "the fallback lists the most played tracks");
ok(fallback.days.length === 34, "the fallback lists the days");
ok(fallback.hours.some((h) => h > 0), "the fallback shows the hours");

/* A play is still recorded even when the tables cannot be made - the
   history is never lost. */
await refusedMod.recordPlay(refusedDb, "tester", "Theta", 30);
const refusedAfter = await refusedMod.listeningStats(refusedDb, "tester", { topLimit: 10 });
ok(refusedAfter.plays === seeded + 1, "a play is recorded even without the tables", String(refusedAfter.plays));

/* ------------------------------------------------------------------ */
console.log("");
console.log(failed === 0 ? `ALL CHECKS PASSED  (${passed} checks)` : `${failed} FAILED  (${passed} passed)`);
process.exit(failed === 0 ? 0 : 1);
