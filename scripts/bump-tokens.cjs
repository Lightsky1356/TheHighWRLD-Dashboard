const fs = require('fs');
const bumps = [
  ['theme-drift.js?v=thw-v8', 'theme-drift.js?v=thw-v9'],
  ['mobile-player.js?v=thw-v34', 'mobile-player.js?v=thw-v35'],
  ['desktop-player.js?v=thw-v18', 'desktop-player.js?v=thw-v19'],
  ['cover-pref.js?v=thw-v2', 'cover-pref.js?v=thw-v3'],
  ['player-settings.js?v=thw-v17', 'player-settings.js?v=thw-v18'],
  ['account.js?v=thw-v89', 'account.js?v=thw-v90'],
  ['push-client.js?v=thw-v29', 'push-client.js?v=thw-v30'],
  ['account.css?v=thw-v21', 'account.css?v=thw-v22'],
  ['themes.css?v=thw-v22', 'themes.css?v=thw-v23'],
  ['player-settings.css?v=thw-v165', 'player-settings.css?v=thw-v166'],
  ['i18n.js?v=9', 'i18n.js?v=10'],
];
for (const f of ['index.html', 'sw.js']) {
  let s = fs.readFileSync(f, 'utf8');
  for (const [a, b] of bumps) { s = s.split(a).join(b); }
  fs.writeFileSync(f, s);
}
let sw = fs.readFileSync('sw.js', 'utf8');
sw = sw.replace("const VERSION = 'thw-v396'", "const VERSION = 'thw-v397'");
fs.writeFileSync('sw.js', sw);
console.log('done');
