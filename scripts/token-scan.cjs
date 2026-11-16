const fs = require('fs');
const files = ['theme-drift.js','mobile-player.js','desktop-player.js','cover-pref.js','player-settings.js','account.js','push-client.js','sw.js','account.css','themes.css','player-settings.css','i18n.js'];
const s = fs.readFileSync('index.html', 'utf8');
for (const f of files) {
  const re = new RegExp(f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\?v=thw-v(\\d+)', 'g');
  const m = s.match(re);
  if (m) console.log('index.html', f, '->', m.join(', '));
}
const sw = fs.readFileSync('sw.js', 'utf8');
for (const f of files) {
  const re = new RegExp(f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\?v=thw-v(\\d+)', 'g');
  const m = sw.match(re);
  if (m) console.log('sw.js', f, '->', m.join(', '));
}
console.log('VERSION', (sw.match(/VERSION = '[^']+'/) || [])[0]);
