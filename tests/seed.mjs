// Prepare the local D1 for the server-backed suites.
//
// The opt-out test signs in as three fixed accounts. Nothing ever created them, so
// the suite could only ever report "session invalid" - and because the runner
// used to skip anything it could not run, that went unnoticed for most of a
// session.
//
// Idempotent by construction: it clears the test accounts' follows and
// notifications before recreating them, so the before/after assertions in the
// suite measure this run's effects rather than whatever a previous run left
// behind. That is not cosmetic - leftover rows would make the opt-out assertions
// pass or fail for the wrong reason.
//
// Everything goes through ONE `d1 execute --file` call. Passing SQL through
// --command on Windows means Node hands it to cmd.exe, which re-splits the
// statement on spaces and wrangler rejects it as unknown arguments.
//
// Run:  node tests/seed.mjs

import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runWrangler } from "./_wrangler.mjs";

const ACCOUNTS = [
  { uid: "notifactor1", token: "notifactor1token", name: "Test Actor", notifications: 1 },
  { uid: "notifon1", token: "notifontoken1", name: "Opted In", notifications: 1 },
  { uid: "notifoff1", token: "notifofftoken1", name: "Opted Out", notifications: 0 },
  { uid: "pushuser1", token: "pushsessiontoken1", name: "Push Tester", notifications: 1 },
];

const UIDS = ACCOUNTS.map((a) => `'${a.uid}'`).join(", ");
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

const statements = [];

/* Children before parents, so nothing is orphaned by a foreign key. */
statements.push(`DELETE FROM push_subscriptions WHERE uid IN (${UIDS});`);
/* Per-category prefs too. The notification-prefs suite deliberately writes
   non-default preferences to prove a uid in the request body cannot redirect the
   write, and does not restore them afterwards. Without clearing this table here
   the first run passes and every later run fails on the "another account is
   untouched" assertion - reading its own leftovers. Found the hard way: the suite
   was green, then went red on the very next run with no code change. */
statements.push(`DELETE FROM user_notification_prefs WHERE uid IN (${UIDS});`);
statements.push(`DELETE FROM community_notifications WHERE recipient_uid IN (${UIDS});`);
statements.push(`DELETE FROM follows WHERE follower_uid IN (${UIDS}) OR followed_uid IN (${UIDS});`);
statements.push(`DELETE FROM sessions WHERE uid IN (${UIDS});`);
statements.push(`DELETE FROM user_privacy WHERE uid IN (${UIDS});`);
statements.push(`DELETE FROM users WHERE uid IN (${UIDS});`);

for (const a of ACCOUNTS) {
  const email = `${a.uid}@example.test`;
  statements.push(
    "INSERT INTO users (uid, email, email_lower, name, avatar, password_hash, " +
    "google_id, discord_id, provider, created_at, verified) VALUES (" +
    [
      q(a.uid), q(email), q(email), q(a.name), q(""), q("seed-not-a-real-password"),
      q(""), q(""), q("seed"), q("2026-01-01T00:00:00.000Z"), "0",
    ].join(", ") + ");"
  );
  statements.push(
    "INSERT INTO sessions (token, uid, ip, ua, created_at, expires_at) VALUES (" +
    [
      q(a.token), q(a.uid), q("127.0.0.1"), q("seed"),
      q("2026-01-01T00:00:00.000Z"), q("2099-01-01T00:00:00.000Z"),
    ].join(", ") + ");"
  );
  statements.push(
    "INSERT INTO user_privacy (uid, show_playlists, show_stats, show_activity, " +
    "show_favorites, activity_enabled, notifications_enabled, updated_at) VALUES (" +
    [
      q(a.uid), "1", "1", "1", "1", "1", String(a.notifications), q("2026-01-01T00:00:00.000Z"),
    ].join(", ") + ");"
  );
}

const migrated = runWrangler(["d1", "migrations", "apply", "wanted-vault", "--local"]);
if (migrated.status !== 0) {
  console.error("could not apply migrations:\n" + `${migrated.stdout || ""}${migrated.stderr || ""}`.split("\n").slice(-8).join("\n"));
  process.exit(1);
}

const dir = mkdtempSync(join(tmpdir(), "thw-seed-"));
const file = join(dir, "seed.sql");
try {
  writeFileSync(file, statements.join("\n"), "utf8");
  const r = runWrangler(["d1", "execute", "wanted-vault", "--local", "--file", file]);
  if (r.status !== 0) {
    console.error("seed failed:\n" + `${r.stdout || ""}${r.stderr || ""}`.split("\n").slice(-10).join("\n"));
    process.exit(1);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(`seeded ${ACCOUNTS.length} accounts into the local D1:`);
for (const a of ACCOUNTS) {
  console.log(`  ${a.uid.padEnd(12)} notifications_enabled=${a.notifications}`);
}