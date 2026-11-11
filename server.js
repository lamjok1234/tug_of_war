import express from 'express';
import { WebSocketServer } from 'ws';
import { TikTokLiveConnection, WebcastEvent } from 'tiktok-live-connector';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ============================================================
// [1] CONFIG
// ============================================================
const TIKTOK_USERNAME    = process.env.TIKTOK_USER || 'YOUR_TIKTOK_USERNAME';
const PORT               = Number(process.env.PORT) || 8080;
const ROUND_DURATION_MS  = 5 * 60 * 1000;
const INTERMISSION_MS    = 10000;
const PULLER_DURATION_MS = 4000;
const CHAT_COOLDOWN_MS   = 1200;           // per-user spam guard for !food / !drink
const MAX_PULLERS        = 40;

const DEMO_MODE = process.env.DEMO_MODE === '1';
const AUTO_DEMO = DEMO_MODE && process.env.AUTO_DEMO === '1';

// ============================================================
// [2] DATA
// ============================================================
const RIVALRIES = [
  { teamA: 'Turkey', teamB: 'Greece' },
  { teamA: 'Turkey', teamB: 'Israel' },
  { teamA: 'Israel', teamB: 'Iran' },
  { teamA: 'Ukraine', teamB: 'Russia' },
  { teamA: 'Turkey', teamB: 'Cyprus' },
  { teamA: 'Greece', teamB: 'Cyprus' },
  { teamA: 'Turkey', teamB: 'Azerbaijan' },
  { teamA: 'Turkey', teamB: 'Kurdistan' },
];

const LOCAL_ITEMS = {
  Turkey:     { flag: '🇹🇷', foods: ['🥙 Kebab', '🥟 Lahmacun', '🫓 Pide'],        drinks: ['🫖 Çay', '🥛 Ayran', '🍷 Şalgam'] },
  Greece:     { flag: '🇬🇷', foods: ['🥙 Souvlaki', '🍲 Moussaka', '🌯 Gyros'],    drinks: ['🥃 Ouzo', '🧋 Frappe', '☕ Greek Coffee'] },
  Israel:     { flag: '🇮🇱', foods: ['🧆 Falafel', '🍳 Shakshuka', '🥪 Sabich'],   drinks: ['🍋 Limonana', '🥛 Sachlav', '🍺 Craft Beer'] },
  Iran:       { flag: '🇮🇷', foods: ['🍢 Chelow Kabab', '🍲 Ghormeh Sabzi', '🥘 Fesenjan'], drinks: ['🥛 Doogh', '🫖 Persian Tea', '🧃 Sekanjabin'] },
  Ukraine:    { flag: '🇺🇦', foods: ['🍲 Borscht', '🥟 Varenyky', '🍗 Chicken Kyiv'], drinks: ['🧃 Kompot', '🍺 Kvass', '🍷 Uzvar'] },
  Russia:     { flag: '🇷🇺', foods: ['🥟 Pelmeni', '🥞 Blini', '🥩 Stroganoff'],    drinks: ['🍺 Kvass', '🧃 Mors', '🫖 Russian Tea'] },
  Cyprus:     { flag: '🇨🇾', foods: ['🧀 Halloumi', '🌭 Sheftalia', '🍖 Kleftiko'], drinks: ['🥃 Zivania', '🍷 Commandaria', '☕ Cyprus Coffee'] },
  Azerbaijan: { flag: '🇦🇿', foods: ['🍚 Plov', '🥬 Dolma', '🍢 Kebab'],          drinks: ['🥛 Ayran', '🫖 Black Tea', '🍹 Sherbet'] },
  Kurdistan:  { flag: '☀️', foods: ['🍢 Kebap', '🥟 Kubba', '🥬 Dolma'], drinks: ['🥛 Dew', '🫖 Black Tea', '🍋 Sherbet'] },
};

const GIFT_POWER_MAP = {
  Rose: 1, TikTok: 1, FingerHeart: 5, IceCreamCone: 10, Lion: 50, Universe: 100,
};
const POWER = { food: 15, drink: 5 };

// Gift skins: TikTok's gift catalog is fixed, so each power tier is re-skinned
// as a local dish per team. Order = GIFT_TIERS (weakest → strongest).
const GIFT_TIERS = ['Rose', 'FingerHeart', 'IceCreamCone', 'Lion', 'Universe'];
const LOCAL_GIFTS = {
  Turkey:     ['🍆 İmam Bayıldı', '🥟 Mantı', '🍦 Maraş Dondurma', '🥙 Adana Kebap', '🥮 Baklava Tower'],
  Greece:     ['🥗 Horiatiki', '🥙 Souvlaki', '🍯 Loukoumades', '🍲 Moussaka', '🥃 Ouzo Barrel'],
  Israel:     ['🧆 Falafel', '🍳 Shakshuka', '🥙 Sabich', '🍖 Shawarma', '🥯 Challah Feast'],
  Iran:       ['🍚 Tahdig', '🍢 Chelow Kabab', '🍦 Bastani', '🥘 Fesenjan', '🫖 Persian Banquet'],
  Ukraine:    ['🥟 Varenyky', '🍲 Borscht', '🥞 Syrnyky', '🍗 Chicken Kyiv', '🎂 Kyiv Cake'],
  Russia:     ['🥞 Blini', '🥟 Pelmeni', '🍦 Plombir', '🥩 Stroganoff', '🎂 Napoleon Cake'],
  Cyprus:     ['🧀 Halloumi', '🌭 Sheftalia', '🍯 Loukoumi', '🍖 Kleftiko', '🥃 Zivania Barrel'],
  Azerbaijan: ['🍚 Plov', '🥬 Dolma', '🥮 Pakhlava', '🍢 Lyulya Kebab', '🫖 Armudu Tea Feast'],
  Kurdistan:  ['🫓 Nan', '🥟 Kubba', '🥬 Dolma', '🍢 Kebap', '🍲 Kurdish Feast'],
};
const DEFAULT_GIFTS = ['🌹 Rose', '🫰 Finger Heart', '🍦 Ice Cream', '🦁 Lion', '🌌 Universe'];
const splitSkin = (s) => { const i = s.indexOf(' '); return { icon: s.slice(0, i), name: s.slice(i + 1) }; };
const tierOf = (name, base) => {
  const i = GIFT_TIERS.indexOf(name);
  return i >= 0 ? i : base >= 100 ? 4 : base >= 50 ? 3 : base >= 10 ? 2 : base >= 5 ? 1 : 0;
};
const skinFor = (country, name, base) => splitSkin((LOCAL_GIFTS[country] || DEFAULT_GIFTS)[tierOf(name, base)]);
const giftMenu = (country) =>
  (LOCAL_GIFTS[country] || DEFAULT_GIFTS).map((s, i) => ({ gift: GIFT_TIERS[i], ...splitSkin(s), power: GIFT_POWER_MAP[GIFT_TIERS[i]] }));

// ============================================================
// [3] STATE
// ============================================================
let gameState = {
  teamA: 'Turkey', teamB: 'Greece',
  powerA: 0, powerB: 0,
  roundStartTime: Date.now(), roundEndTime: Date.now(),
  roundActive: false,
  phase: 'idle',                             // idle | playing | ended
  matchHistory: [],
  items: { A: null, B: null },
  events: [],
  lastWinner: null,
  giftPowerMap: GIFT_POWER_MAP,
  pullersA: [],
  pullersB: [],
};

const viewerCountry = new Map();             // userId → country (sticky across rounds)
const chatCooldown = new Map();              // userId → last command ts
let nextRoundTimer = null;                   // single handle → no duplicate rounds
const rand = (a) => a[Math.floor(Math.random() * a.length)];
const isTeam = (t) => t === 'A' || t === 'B';

// ---- viewer side selection -------------------------------------------------
// A viewer picks a side once by typing the team name (!turkey), !1/!2, !a/!b, !join1/!join2,
// or plain !join (auto-balance). The choice sticks while their country keeps playing.
const SIDE_A = ['1', 'a', 'join1', 'join 1', 'join a', 'joina'];
const SIDE_B = ['2', 'b', 'join2', 'join 2', 'join b', 'joinb'];
const teamOf = (id) => {
  const c = viewerCountry.get(id);
  return c === gameState.teamA ? 'A' : c === gameState.teamB ? 'B' : null;
};
function smallerSide() {
  let a = 0, b = 0;
  for (const c of viewerCountry.values()) { if (c === gameState.teamA) a++; else if (c === gameState.teamB) b++; }
  return a < b ? 'A' : b < a ? 'B' : (Math.random() < 0.5 ? 'A' : 'B');
}
function parseSide(cmd) {
  if (SIDE_A.includes(cmd)) return 'A';
  if (SIDE_B.includes(cmd)) return 'B';
  if (cmd === 'join') return 'auto';
  const n = cmd.replace(/^join /, '');
  if (n === gameState.teamA.toLowerCase()) return 'A';
  if (n === gameState.teamB.toLowerCase()) return 'B';
  return null;
}
function joinSide(userId, user, team) { viewerCountry.set(userId, countryOf(team)); join(team, user); }
// Anyone who gifts or buys without picking a side is placed on the smaller team.
function sideFor(userId, user) {
  return teamOf(userId) || (joinSide(userId, user, smallerSide()), teamOf(userId));
}

// ============================================================
// [4] CORE GAME LOGIC (shared by TikTok handlers + test endpoints)
// ============================================================
// ---- daily leaderboard: countries ranked by today's results (3 pts win, 1 draw) ----
// Resets at local midnight and is saved to disk, so a server restart doesn't lose it.
// DATA_DIR lets a host with a persistent volume (e.g. Railway: /data) keep the board across deploys.
const DAILY_FILE = path.join(process.env.DATA_DIR || __dirname, DEMO_MODE ? 'daily.demo.json' : 'daily.json');
const dayKey = () => new Date().toLocaleDateString('en-CA');          // YYYY-MM-DD, local time
function loadDaily() {
  try { const d = JSON.parse(fs.readFileSync(DAILY_FILE, 'utf8')); if (d.day === dayKey()) return d; } catch { /* first run */ }
  return { day: dayKey(), stats: {} };
}
let daily = loadDaily();
function saveDaily() { try { fs.writeFileSync(DAILY_FILE, JSON.stringify(daily)); } catch (e) { console.warn('Could not save leaderboard:', e.message); } }
function rollDay() { if (daily.day !== dayKey()) { daily = { day: dayKey(), stats: {} }; saveDaily(); } }
function record(country, result, power) {
  const st = (daily.stats[country] ||= { w: 0, l: 0, d: 0, pf: 0 });
  st[result]++; st.pf += power;
}
const leaderboard = () =>
  Object.entries(daily.stats)
    .map(([country, st]) => ({ country, flag: itemsFor(country).flag, ...st, pts: st.w * 3 + st.d }))
    .sort((a, b) => b.pts - a.pts || b.w - a.w || b.pf - a.pf)
    .slice(0, 8);

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const itemsFor = (c) => LOCAL_ITEMS[c] || { flag: '🏳️', foods: ['🍽 Food'], drinks: ['🥤 Drink'] };
const countryOf = (team) => (team === 'A' ? gameState.teamA : gameState.teamB);

function pushEvent(evt) {
  gameState.events.unshift({ id: uid(), ts: Date.now(), ...evt });
  if (gameState.events.length > 10) gameState.events.pop();
}

function addPuller(team, user) {
  const arr = team === 'A' ? gameState.pullersA : gameState.pullersB;
  arr.push({ id: uid(), name: user, expiresAt: Date.now() + PULLER_DURATION_MS });
  if (arr.length > MAX_PULLERS) arr.shift();
}

function addPower(team, n) {
  if (team === 'A') gameState.powerA += n; else gameState.powerB += n;
}

function join(team, user) {
  if (!gameState.roundActive) return;
  addPuller(team, user);
  pushEvent({ kind: 'join', user, team, country: countryOf(team), power: 0 });
}

function buy(team, user, kind) {
  if (!gameState.roundActive) return;
  const pool = gameState.items[team][kind === 'food' ? 'foods' : 'drinks'];
  const power = POWER[kind];
  addPower(team, power);
  addPuller(team, user);
  pushEvent({ kind, user, team, country: countryOf(team), item: rand(pool), power });
}

function gift(team, user, name, count = 1, diamonds = 0) {
  if (!gameState.roundActive) return;
  const base = GIFT_POWER_MAP[name] || diamonds || 10;
  const power = base * Math.max(1, count);
  const skin = skinFor(countryOf(team), name, base);
  addPower(team, power);
  addPuller(team, user);
  pushEvent({ kind: 'gift', user, team, item: skin.name, icon: skin.icon, base: name, count, power, country: countryOf(team) });
}

function getNextMatch(winner) {
  const same = (r) =>
    (r.teamA === gameState.teamA && r.teamB === gameState.teamB) ||
    (r.teamA === gameState.teamB && r.teamB === gameState.teamA);
  const candidates = RIVALRIES.filter((r) => (r.teamA === winner || r.teamB === winner) && !same(r));
  const pick = candidates.length ? rand(candidates) : rand(RIVALRIES);
  return pick.teamA === winner
    ? { teamA: pick.teamA, teamB: pick.teamB }
    : { teamA: pick.teamB, teamB: pick.teamA };
}

function startRound(teamA, teamB) {
  clearTimeout(nextRoundTimer);
  gameState = {
    ...gameState,
    teamA, teamB,
    powerA: 0, powerB: 0,
    roundStartTime: Date.now(),
    roundEndTime: Date.now() + ROUND_DURATION_MS,
    roundActive: true,
    phase: 'playing',
    lastWinner: null,
    items: { A: itemsFor(teamA), B: itemsFor(teamB) },
    giftMenu: { A: giftMenu(teamA), B: giftMenu(teamB) },
    next: null,
    events: [], pullersA: [], pullersB: [],
  };
  chatCooldown.clear();
  console.log(`🎮 New round: ${teamA} vs ${teamB}`);
  broadcast();
}

function endRound() {
  if (!gameState.roundActive) return;
  gameState.roundActive = false;
  gameState.phase = 'ended';

  const { teamA, teamB, powerA, powerB } = gameState;
  const winner = powerA > powerB ? teamA : powerB > powerA ? teamB : null;
  gameState.lastWinner = winner;

  rollDay();
  if (winner) {
    const loser = winner === teamA ? teamB : teamA;
    const wp = winner === teamA ? powerA : powerB, lp = winner === teamA ? powerB : powerA;
    gameState.matchHistory.push({ winner, loser, powerA, powerB, timestamp: Date.now() });
    record(winner, 'w', wp); record(loser, 'l', lp);
    console.log(`🏆 ${winner} wins vs ${loser} (${powerA}–${powerB})`);
  } else {
    record(teamA, 'd', powerA); record(teamB, 'd', powerB);
    console.log('🤝 Draw — rematch incoming');
  }
  saveDaily();

  // Announce the next matchup during the intermission.
  const next = winner ? getNextMatch(winner) : { teamA, teamB };
  gameState.next = {
    ...next,
    flagA: itemsFor(next.teamA).flag,
    flagB: itemsFor(next.teamB).flag,
    startsAt: Date.now() + INTERMISSION_MS,
  };
  broadcast();

  clearTimeout(nextRoundTimer);
  nextRoundTimer = setTimeout(() => startRound(next.teamA, next.teamB), INTERMISSION_MS);
}

// ============================================================
// [5] SERVER SETUP
// ============================================================
const app = express();
const server = app.listen(PORT, () => console.log(`🌐 Overlay: http://localhost:${PORT}`));
const wss = new WebSocketServer({ server });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function snapshot() {
  rollDay();
  const now = Date.now();
  return JSON.stringify({
    type: 'state',
    data: {
      ...gameState,
      leaderboard: leaderboard(),
      serverTime: now,                       // lets clients correct clock skew
      pullersA: gameState.pullersA.filter((p) => p.expiresAt > now),
      pullersB: gameState.pullersB.filter((p) => p.expiresAt > now),
    },
  });
}

function broadcast() {
  const payload = snapshot();
  wss.clients.forEach((c) => c.readyState === 1 && c.send(payload));
}

wss.on('connection', (ws) => ws.send(snapshot()));

// ============================================================
// [6] TEST ENDPOINTS (DEMO_MODE=1 only)
// ============================================================
if (DEMO_MODE) {
  const route = (name, fn) =>
    app.post(`/test/${name}`, (req, res) => {
      const b = req.body || {};
      if (['join', 'food', 'drink', 'gift'].includes(name) && !isTeam(b.team))
        return res.status(400).json({ ok: false, error: 'team must be "A" or "B"' });
      fn(b);
      broadcast();
      res.json({ ok: true });
    });

  route('join',  (b) => join(b.team, b.user || 'tester'));
  route('food',  (b) => buy(b.team, b.user || 'tester', 'food'));
  route('drink', (b) => buy(b.team, b.user || 'tester', 'drink'));
  route('gift',  (b) => gift(b.team, b.user || 'tester', b.gift || 'Lion', Number(b.count) || 1));
  route('speedup', () => { gameState.roundEndTime = Date.now() + 10000; });
  route('end',   () => endRound());
  route('reset', () => { const r = rand(RIVALRIES); startRound(r.teamA, r.teamB); });
  app.get('/test/control', (_req, res) => res.sendFile(path.join(__dirname, 'test', 'control-panel.html')));

  console.log('🧪 TEST ENDPOINTS ENABLED');
  console.log(`   Panel:    http://localhost:${PORT}/test/control`);
  console.log('   Sim CLI:  npm run sim -- help');
}

// ============================================================
// [7] TIKTOK LIVE (live mode only)
// ============================================================
let connection = null;

function connectTikTok(attempt = 1) {
  connection = new TikTokLiveConnection(TIKTOK_USERNAME, { enableExtendedGiftInfo: true });

  connection.on(WebcastEvent.CHAT, (event) => {
    const user = event.user?.uniqueId || 'anon';
    const userId = event.user?.userId;
    const msg = (event.comment ?? event.content ?? '').trim().toLowerCase();
    if (!userId || !msg.startsWith('!')) return;
    const cmd = msg.slice(1).replace(/\s+/g, ' ').trim();

    const side = parseSide(cmd);
    if (side) {
      if (teamOf(userId)) return;                       // already on a side that is playing
      joinSide(userId, user, side === 'auto' ? smallerSide() : side);
      return broadcast();
    }

    if (cmd !== 'food' && cmd !== 'drink') return;
    const last = chatCooldown.get(userId) || 0;
    if (Date.now() - last < CHAT_COOLDOWN_MS) return;
    chatCooldown.set(userId, Date.now());
    buy(sideFor(userId, user), user, cmd);
    broadcast();
  });

  connection.on(WebcastEvent.GIFT, (event) => {
    if (!event.gift) return;
    // Streakable gifts fire many times mid-combo; only count the final tally.
    if (event.giftType === 1 && !event.repeatEnd) return;
    const userId = event.user?.userId;
    if (!userId) return;
    const user = event.user?.uniqueId || 'anon';
    gift(sideFor(userId, user), user, event.gift.name || 'Gift', event.repeatCount || 1, event.gift.diamondCount || event.diamondCount || 1);
    broadcast();
  });

  connection.on('disconnected', () => {
    console.warn('⚠️  TikTok disconnected — retrying in 5s');
    setTimeout(() => connectTikTok(1), 5000);
  });
  connection.on('error', (e) => console.error('TikTok error:', e?.message || e));

  connection.connect()
    .then(() => console.log('✅ Connected to TikTok LIVE as', TIKTOK_USERNAME))
    .catch((e) => {
      const wait = Math.min(30000, 3000 * attempt);
      console.error(`❌ Connect failed (${e.message}) — retry in ${wait / 1000}s. Tip: DEMO_MODE=1 to test offline.`);
      setTimeout(() => connectTikTok(attempt + 1), wait);
    });
}

// ============================================================
// [8] ROUND TIMER + BOOT
// ============================================================
setInterval(() => {
  if (gameState.roundActive && Date.now() >= gameState.roundEndTime) endRound();
}, 250);

const first = rand(RIVALRIES);
startRound(first.teamA, first.teamB);

if (DEMO_MODE) {
  console.log('🧪 DEMO_MODE active — TikTok connection skipped');
  if (AUTO_DEMO) {
    console.log('🎲 AUTO_DEMO — random events every 900ms');
    setInterval(() => {
      if (!gameState.roundActive) return;
      const team = Math.random() < 0.5 + Math.sin(Date.now() / 9000) * 0.25 ? 'A' : 'B';
      const r = Math.random();
      const user = `demo_${Math.floor(Math.random() * 99)}`;
      if (r < 0.1) join(team, user);
      else if (r < 0.55) buy(team, user, 'food');
      else if (r < 0.88) buy(team, user, 'drink');
      else gift(team, user, rand(['Lion', 'Universe', 'FingerHeart']), 1 + Math.floor(Math.random() * 3));
      broadcast();
    }, 900);
  }
} else {
  connectTikTok();
}
