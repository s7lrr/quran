const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'data');
const FILE = path.join(DIR, 'db.json');

let data = { prefix: '$', owners: [], game: '📖 أذكار | $help', guilds: {} };
try {
  data = { ...data, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) };
} catch {}

function save() {
  fs.mkdirSync(DIR, { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, FILE);
}

function guild(id) {
  if (!data.guilds[id]) data.guilds[id] = {};
  const g = data.guilds[id];
  g.channel ??= null;
  g.enabled ??= false;
  g.tz ??= 'Asia/Riyadh';
  g.schedule ??= [];
  g.custom ??= {};
  g.triggers ??= {};
  g.taaziaCategory ??= null;
  return g;
}

module.exports = { data, save, guild };
