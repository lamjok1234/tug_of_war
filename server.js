import express from 'express';
import { WebSocketServer } from 'ws';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ============================================================
// [1] CONFIG
// ============================================================
const TIKTOK_USERNAME    = process.env.TIKTOK_USER || 'YOUR_TIKTOK_USERNAME';
const PORT               = Number(process.env.PORT) || 8080;
const ROUND_DURATION_MS  = (Number(process.env.ROUND_SECONDS) || 300) * 1000;
const INTERMISSION_MS    = (Number(process.env.BREAK_SECONDS) || 10) * 1000;
const PULLER_DURATION_MS = 4000;
const CHAT_COOLDOWN_MS   = 1200;
const MAX_PULLERS        = 40;

const DEMO_MODE = process.env.DEMO_MODE === '1';
const AUTO_DEMO = DEMO_MODE && process.env.AUTO_DEMO === '1';

const PLATFORM    = (process.env.PLATFORM || 'tiktok').toLowerCase();
const EVENT_TOKEN = process.env.EVENT_TOKEN || (DEMO_MODE ? 'demo' : '');
const GIFT_SCALE  = Number(process.env.GIFT_SCALE) || 1;

const RULES = { finalPushMs: 30000, finalMult: 2, comebackRatio: 0.25, comebackMult: 1.25 };
const BROADCAST_MIN_MS = 100;

const TANGO_SIGNING_SECRET = process.env.TANGO_SIGNING_SECRET || '';

// tiktok  → curated GIFT_POWER_MAP wins; raw diamond count is only a fallback
// tango / generic → the numeric value (diamonds) is authoritative
const DEFAULT_USE_DIAMONDS = (PLATFORM === 'tango' || PLATFORM === 'generic');

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
const tierOf = (base) => base >= 100 ? 4 : base >= 50 ? 3 : base >= 10 ? 2 : base >= 5 ? 1 : 0;
const skinFor = (country, base) => splitSkin((LOCAL_GIFTS[country] || DEFAULT_GIFTS)[tierOf(base)]);

const giftMenu = (country) =>
  (LOCAL_GIFTS[country] || DEFAULT_GIFTS).map((s, i) => ({
    gift: GIFT_TIERS[i], ...splitSkin(s), power: GIFT_POWER_MAP[GIFT_TIERS[i]],
  }));

// ============================================================
// [3] STATE
// ============================================================
let gameState = {
  teamA: 'Turkey', teamB: 'Greece',
  powerA: 0, powerB: 0,
  roundStartTime: Date.now(), roundEndTime: Date.now(),
  roundActive: false,
  phase: 'idle',
  matchHistory: [],
  items: { A: null, B: null },
  events: [],
  lastWinner: null,
  giftPowerMap: GIFT_POWER_MAP,
  pullersA: [],
  pullersB: [],
};

const viewerCountry = new Map();
const roundGifts = { A: new Map(), B: new Map() };
const pendingGifts = [];
const chatCooldown = new Map();
let nextRoundTimer = null;
const rand = (a) => a[Math.floor(Math.random() * a.length)];
const isTeam = (t) => t === 'A' || t === 'B';

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
function joinSide(userId, user, team) {
  viewerCountry.set(userId, countryOf(team));
  if (viewerCountry.size > 5000) {
    for (const k of viewerCountry.keys()) { viewerCountry.delete(k); if (viewerCountry.size <= 4000) break; }
  }
  join(team, user);
}
function sideFor(userId, user) {
  return teamOf(userId) || (joinSide(userId, user, smallerSide()), teamOf(userId));
}

// ============================================================
// [4] CORE GAME LOGIC
// ============================================================
const DAILY_FILE = path.join(process.env.DATA_DIR || __dirname, DEMO_MODE ? 'daily.demo.json' : 'daily.json');
const dayKey = () => new Date().toLocaleDateString('en-CA', process.env.DAY_TZ ? { timeZone: process.env.DAY_TZ } : undefined);
function loadDaily() {
  try { const d = JSON.parse(fs.readFileSync(DAILY_FILE, 'utf8')); if (d.day === dayKey()) { d.gifters ||= {}; return d; } } catch { /* first run */ }
  return { day: dayKey(), stats: {}, gifters: {} };
}
let daily = loadDaily();
function saveDaily() { try { fs.writeFileSync(DAILY_FILE, JSON.stringify(daily)); } catch (e) { console.warn('Could not save leaderboard:', e.message); } }
function rollDay() { if (daily.day !== dayKey()) { daily = { day: dayKey(), stats: {}, gifters: {} }; saveDaily(); } }
function record(country, result, power) {
  const st = (daily.stats[country] ||= { w: 0, l: 0, d: 0, pf: 0 });
  st[result]++; st.pf += power;
}
const leaderboard = () =>
  Object.entries(daily.stats)
    .map(([country, st]) => ({ country, flag: itemsFor(country).flag, ...st, pts: st.w * 3 + st.d }))
    .sort((a, b) => b.pts - a.pts || b.w - a.w || b.pf - a.pf)
    .slice(0, 8);

function recordGifter(user, power) {
  daily.gifters[user] = (daily.gifters[user] || 0) + power;
  const keys = Object.keys(daily.gifters);
  if (keys.length > 1500) keys.sort((a, b) => daily.gifters[a] - daily.gifters[b]).slice(0, 300).forEach((k) => delete daily.gifters[k]);
}
const supporters = () => Object.entries(daily.gifters).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([user, power]) => ({ user, power }));
const mvpOf = (team) => { let best = null; for (const [user, power] of roundGifts[team]) if (!best || power > best.power) best = { user, power }; return best; };

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const itemsFor = (c) => LOCAL_ITEMS[c] || { flag: '🏳️', foods: ['🍽 Food'], drinks: ['🥤 Drink'] };
const countryOf = (team) => (team === 'A' ? gameState.teamA : gameState.teamB);

function pushEvent(evt) {
  gameState.events.unshift({ id: uid(), ts: Date.now(), ...evt });
  if (gameState.events.length > 20) gameState.events.pop();
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

function giftMult(team) {
  const mine = team === 'A' ? gameState.powerA : gameState.powerB;
  const other = team === 'A' ? gameState.powerB : gameState.powerA;
  let m = 1;
  if (gameState.roundEndTime - Date.now() <= RULES.finalPushMs) m *= RULES.finalMult;
  if (mine + other >= 100 && other - mine >= (mine + other) * RULES.comebackRatio) m *= RULES.comebackMult;
  return m;
}

function gift(team, user, name, count = 1, diamonds = 0) {
  if (!gameState.roundActive) return;
  count = Math.min(999, Math.max(1, Math.floor(count) || 1));

  const curated = GIFT_POWER_MAP[name];
  const base = DEFAULT_USE_DIAMONDS
    ? (diamonds > 0 ? diamonds : (curated ?? 1))
    : (curated ?? (diamonds > 0 ? diamonds : 1));

  const mult = giftMult(team);
  const power = Math.round(base * count * mult);
  const skin = skinFor(countryOf(team), base);

  addPower(team, power);
  addPuller(team, user);
  roundGifts[team].set(user, (roundGifts[team].get(user) || 0) + power);
  recordGifter(user, power);
  pushEvent({
    kind: 'gift', user, team,
    item: skin.name, icon: skin.icon,
    base: name,
    diamonds: diamonds || 0,
    count, power, mult,
    country: countryOf(team),
  });
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
  roundGifts.A.clear(); roundGifts.B.clear();
  console.log(`🎮 New round: ${teamA} vs ${teamB}`);
  broadcast();
  const queued = pendingGifts.splice(0);
  queued.forEach((g) => onGift(...g));
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
    if (gameState.matchHistory.length > 200) gameState.matchHistory.shift();
    record(winner, 'w', wp); record(loser, 'l', lp);
    console.log(`🏆 ${winner} wins vs ${loser} (${powerA}–${powerB})`);
  } else {
    record(teamA, 'd', powerA); record(teamB, 'd', powerB);
    console.log('🤝 Draw — rematch incoming');
  }
  saveDaily();

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

app.disable('x-powered-by');

if (PLATFORM === 'tango') {
  // Keep raw buffer for HMAC verification
  app.use('/tango-hook', express.raw({ type: '*/*', limit: '1mb' }));

  // OPTIONS probe used by Tango to validate the URL
  app.use((req, res, next) => {
    if (req.method === 'OPTIONS' && req.path.startsWith('/tango-hook')) {
      return res
        .set('Access-Control-Allow-Methods', 'POST, OPTIONS')
        .set('Access-Control-Allow-Headers', 'Content-Type, X-Tango-Signature')
        .sendStatus(200);
    }
    next();
  });
}

app.use(express.json({ limit: '10kb' }));
app.use(express.static(path.join(__dirname, 'public')));

function snapshot() {
  rollDay();
  const now = Date.now();
  return JSON.stringify({
    type: 'state',
    data: {
      ...gameState,
      platform: PLATFORM,
      rules: RULES,
      mvp: { A: mvpOf('A'), B: mvpOf('B') },
      supporters: supporters(),
      leaderboard: leaderboard(),
      serverTime: now,
      pullersA: gameState.pullersA.filter((p) => p.expiresAt > now),
      pullersB: gameState.pullersB.filter((p) => p.expiresAt > now),
    },
  });
}

let flushTimer = null, lastSend = 0;
function flush() {
  flushTimer = null;
  lastSend = Date.now();
  if (!wss.clients.size) return;
  const payload = snapshot();
  wss.clients.forEach((c) => c.readyState === 1 && c.bufferedAmount < 1e6 && c.send(payload));
}
function broadcast() {
  if (flushTimer) return;
  flushTimer = setTimeout(flush, Math.max(0, BROADCAST_MIN_MS - (Date.now() - lastSend)));
}

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('error', () => {});
  ws.send(snapshot());
});
setInterval(() => wss.clients.forEach((c) => { if (!c.isAlive) return c.terminate(); c.isAlive = false; c.ping(); }), 30000);

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
  route('gift',  (b) => gift(b.team, b.user || 'tester', b.gift || 'Lion', Number(b.count) || 1, Number(b.diamonds) || 0));
  route('speedup', () => { gameState.roundEndTime = Date.now() + 10000; });
  route('end',   () => endRound());
  route('reset', () => { const r = rand(RIVALRIES); startRound(r.teamA, r.teamB); });
  app.get('/test/control', (_req, res) => res.sendFile(path.join(__dirname, 'test', 'control-panel.html')));

  console.log('🧪 TEST ENDPOINTS ENABLED');
  console.log(`   Panel:    http://localhost:${PORT}/test/control`);
  console.log('   Sim CLI:  npm run sim -- help');
}

// ============================================================
// [7] INPUT ADAPTERS
// ============================================================
function onChat(userId, user, text) {
  const msg = String(text ?? '').trim().toLowerCase();
  if (!userId || !msg.startsWith('!')) return;
  const cmd = msg.slice(1).replace(/\s+/g, ' ').trim();

  const side = parseSide(cmd);
  if (side) {
    if (teamOf(userId)) return;
    joinSide(userId, user, side === 'auto' ? smallerSide() : side);
    return broadcast();
  }

  if (cmd !== 'food' && cmd !== 'drink') return;
  const last = chatCooldown.get(userId) || 0;
  if (Date.now() - last < CHAT_COOLDOWN_MS) return;
  chatCooldown.set(userId, Date.now());
  buy(sideFor(userId, user), user, cmd);
  broadcast();
}

function onGift(userId, user, name, count = 1, value = 0) {
  if (!userId) return;
  const scaled = Math.round(value * GIFT_SCALE);
  if (!gameState.roundActive) {
    if (pendingGifts.length < 300) pendingGifts.push([userId, user, name, count, scaled / GIFT_SCALE]);
    return;
  }
  gift(sideFor(userId, user), user, name || 'Gift', count, scaled);
  broadcast();
}

const safeEq = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
if (EVENT_TOKEN) {
  app.post('/event', (req, res) => {
    const tok = String(req.get('x-event-token') || req.query.token || '');
    if (!safeEq(tok, EVENT_TOKEN)) return res.status(401).json({ ok: false, error: 'bad token' });
    const b = req.body || {};
    const user = String(b.user || 'anon').slice(0, 40);
    const userId = String(b.userId || user).slice(0, 60);
    if (b.type === 'chat') onChat(userId, user, String(b.text || '').slice(0, 100));
    else if (b.type === 'gift') onGift(userId, user, String(b.gift || 'Gift').slice(0, 40), clamp(Number(b.count) || 1, 1, 99), clamp(Number(b.value) || 0, 0, 100000));
    else return res.status(400).json({ ok: false, error: 'type must be "chat" or "gift"' });
    res.json({ ok: true });
  });
  app.get('/operator', (_req, res) => res.sendFile(path.join(__dirname, 'test', 'operator.html')));
  console.log(`🎛  Operator panel: http://localhost:${PORT}/operator?token=<EVENT_TOKEN>   Event API: POST /event`);
}

// ---- Tango webhook adapter ----
if (PLATFORM === 'tango') {

  // Tango sends:  X-Tango-Signature: sha256=<lowercase hex HMAC-SHA256 of raw body>
  // Some deployments may send just the hex without the "sha256=" prefix — handle both.
  // The Stripe-style "t=..,v1=.." format is also accepted as a fallback for compatibility.
function verifyTangoSignature(rawBody, signatureHeader, secret) {
  if (!secret) return true;                        // dev only
  if (!signatureHeader) return false;

  const header = String(signatureHeader).trim();

  // Extract the hex digest — accept "sha256=<hex>" and bare hex.
  let candidateHex = null;
  const m = header.match(/^sha256=([0-9a-fA-F]+)$/);
  if (m) candidateHex = m[1];
  else if (/^[0-9a-fA-F]+$/.test(header)) candidateHex = header;

  // Stripe-style "t=...,v1=..." fallback
  let signedBody = rawBody;
  if (!candidateHex) {
    const parts = header.split(',').map((s) => s.trim());
    const v1 = parts.find((p) => p.startsWith('v1='))?.slice(3);
    const t  = parts.find((p) => p.startsWith('t='))?.slice(2);
    if (v1) {
      candidateHex = v1;
      if (t) signedBody = `${t}.${rawBody}`;
    }
  }
  if (!candidateHex) return false;

  // Try every plausible HMAC key derived from the secret.
  const keys = [Buffer.from(secret, 'utf8')];           // A: full "whsec_..." string
  if (secret.startsWith('whsec_')) {
    const tail = secret.slice(6);
    keys.push(Buffer.from(tail, 'utf8'));               // B: stripped prefix, ASCII
    try { keys.push(Buffer.from(tail, 'base64')); }     // C: stripped prefix, Base64-decoded
    catch { /* invalid base64 — skip */ }
  }

  const received = Buffer.from(candidateHex, 'hex');
  for (const key of keys) {
    const expected = crypto.createHmac('sha256', key).update(signedBody).digest();
    if (received.length === expected.length && crypto.timingSafeEqual(received, expected)) {
      return true;                                      // matched — which key won doesn't matter
    }
  }
  return false;
}

function dispatchTangoEvent(evt) {
  const type = evt?.type || '(missing type)';
  const data = evt?.data;
  console.log(`📥 Tango event received: type=${type}`);

  // ---- chat batch ----
  if (type === 'stream.chat.messages.received') {
    const msgs = data?.messages || [];
    console.log(`💬 chat batch: ${msgs.length} message(s)`);

    for (const m of msgs) {
      const userId = m?.sender?.id;
      const user   = m?.sender?.displayName || 'anon';
      const text   = m?.text || '';

      if (m?.systemMessage) {
        console.log(`   ⏭  skip system message from "${user}": "${text.slice(0, 60)}"`);
        continue;
      }
      if (!userId) {
        console.warn(`   ⚠️  skip message with no sender.id: user="${user}" text="${text.slice(0, 60)}"`);
        continue;
      }
      if (!text.startsWith('!')) {
        console.log(`   💤 non-command from "${user}": "${text.slice(0, 60)}"`);
        // still pass it — onChat() itself ignores non-commands, but keeping the call
        // means future command-like messages are handled uniformly.
      }

      console.log(`   → onChat(userId=${userId}, user="${user}", text="${text.slice(0, 60)}")`);
      onChat(userId, user, text);
    }
    return;
  }

  // ---- diamonds / gifts ----
  if (type === 'diamonds.received') {
    const items = Array.isArray(data) ? data : [data];
    console.log(`💎 diamonds.received: ${items.length} item(s)`);

    for (const d of items) {
      if (!d) {
        console.warn('   ⚠️  skip null/undefined gift item');
        continue;
      }

      const senderId = d.sender?.id;
      const user     = d.sender?.displayName || 'anon';
      const src      = d.source ?? '(no source)';
      const kind     = d.type ?? '(no type)';

      if (d.source !== 'STREAM') {
        console.log(`   ⏭  skip non-STREAM gift (source=${src}, type=${kind}, user="${user}")`);
        continue;
      }
      if (d.type !== 'GIFT') {
        console.log(`   ⏭  skip non-GIFT diamond event (source=${src}, type=${kind}, user="${user}")`);
        continue;
      }
      if (!senderId) {
        console.warn(`   ⚠️  skip gift with no sender.id (user="${user}", amount=${d.amount})`);
        continue;
      }

      const giftName = String(d.giftName || d.gift?.name || d.giftId || 'Gift').slice(0, 40);
      const count    = clamp(Number(d.giftCount || d.count) || 1, 1, 99);
      const amount   = Number(d.amount) || 0;

      console.log(
        `   🎁 → onGift(userId=${senderId}, user="${user}", gift="${giftName}", ` +
        `count=${count}, amount=${amount})`
      );
      onGift(senderId, user, giftName, count, amount);
    }
    return;
  }

  // ---- anything else ----
  console.log(`🚫 unhandled Tango event type "${type}" — ignored`);
}
  function handleTangoWebhook(req, res) {
    const raw = Buffer.isBuffer(req.body)
      ? req.body.toString('utf8')
      : (typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {}));

    const sig = req.get('X-Tango-Signature')
             || req.get('TNG-Webhook-Signature')
             || req.get('X-Tango-Signature-V1')
             || '';

    if (!verifyTangoSignature(raw, sig, TANGO_SIGNING_SECRET)) {
      console.warn('⚠️  Tango webhook signature verification failed',
                   `(header="${String(sig).slice(0, 24)}…", bodyLen=${raw.length}, secretSet=${!!TANGO_SIGNING_SECRET})`);
      return res.sendStatus(401);
    }

    let evt;
    try { evt = JSON.parse(raw); }
    catch (e) { console.error('Tango webhook JSON parse error:', e.message); return res.sendStatus(400); }

    try { dispatchTangoEvent(evt); }
    catch (e) { console.error('Tango event handler error:', e); }
    res.sendStatus(200);
  }

  app.post('/tango-hook',            handleTangoWebhook);
  app.post('/tango-hook/:creatorId', handleTangoWebhook);

  console.log('🎛  Tango webhook adapter enabled — POST /tango-hook');
  if (!TANGO_SIGNING_SECRET) {
    console.warn('⚠️  TANGO_SIGNING_SECRET is not set — signatures will NOT be verified!');
  } else {
    console.log(`🔐 Tango signature verification active (secret length ${TANGO_SIGNING_SECRET.length})`);
  }
}

// ---- TikTok adapter ----
let connection = null;

async function connectTikTok(attempt = 1) {
  let lib;
  try { lib = await import('tiktok-live-connector'); }
  catch { return console.error('tiktok-live-connector is not installed. Run: npm install tiktok-live-connector'); }
  const { TikTokLiveConnection, WebcastEvent } = lib;
  connection = new TikTokLiveConnection(TIKTOK_USERNAME, { enableExtendedGiftInfo: true });

  connection.on(WebcastEvent.CHAT, (e) => onChat(e.user?.userId, e.user?.uniqueId || 'anon', e.comment ?? e.content));
  connection.on(WebcastEvent.GIFT, (e) => {
    if (!e.gift) return;
    if (e.giftType === 1 && !e.repeatEnd) return;
    onGift(e.user?.userId, e.user?.uniqueId || 'anon', e.gift.name, e.repeatCount || 1, e.gift.diamondCount || e.diamondCount || 1);
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
  console.log('🧪 DEMO_MODE active — live platform connection skipped');
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
  if (PLATFORM === 'tiktok')      connectTikTok();
  else if (PLATFORM === 'tango')  console.log('🔌 PLATFORM=tango — waiting for webhook events at POST /tango-hook');
  else                            console.log(`🔌 PLATFORM=${PLATFORM}: no direct chat/gift connection. Send events to POST /event or use /operator.`);
}

// ============================================================
// [9] SAFETY NET
// ============================================================
process.on('unhandledRejection', (e) => console.error('Unhandled rejection:', e));
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => { console.log('Shutting down…'); saveDaily(); server.close(); process.exit(0); });
}