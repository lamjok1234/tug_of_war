#!/usr/bin/env node
// Usage: npm run sim -- help
const BASE = process.env.BASE_URL || 'http://localhost:8080';
const NAMES = ['ali','zeynep','mehmet','ayse','david','noa','itai','maya','olga','ivan','yuki','sara','mika','kim','leo','nina'];
const GIFTS = ['Rose','FingerHeart','IceCreamCone','Lion','Universe'];
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function post(path, body = {}) {
  const res = await fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${path} failed: ${res.status}`);
  return res.json();
}
const join  = (team, user = pick(NAMES)) => post('/test/join',  { team, user });
const food  = (team, user = pick(NAMES)) => post('/test/food',  { team, user });
const drink = (team, user = pick(NAMES)) => post('/test/drink', { team, user });
const gift  = (team, user = pick(NAMES), g = 'Lion', c = 1) => post('/test/gift', { team, user, gift: g, count: c });

async function auto(duration = 30, rate = 2) {
  console.log(`🎲 Auto-simulating for ${duration}s at ~${rate}/sec…`);
  const endAt = Date.now() + duration * 1000;
  while (Date.now() < endAt) {
    const team = Math.random() < 0.5 + Math.sin(Date.now() / 9000) * 0.25 ? 'A' : 'B';
    const r = Math.random();
    try {
      if (r < 0.12) await join(team);
      else if (r < 0.6) await food(team);
      else if (r < 0.85) await drink(team);
      else await gift(team, pick(NAMES), pick(GIFTS), 1 + Math.floor(Math.random() * 3));
    } catch (e) { console.error(e.message); }
    await sleep(1000 / rate);
  }
  console.log('✅ Done');
}

const SCENARIOS = {
  landslide: async () => { for (let i = 0; i < 20; i++) { await food('A'); await sleep(200); } for (let i = 0; i < 3; i++) { await drink('B'); await sleep(400); } },
  close:      async () => { for (let i = 0; i < 15; i++) { await food('A'); await sleep(150); await food('B'); await sleep(150); } },
  gifts:      async () => { for (let i = 0; i < 8; i++) { await gift('A', pick(NAMES), 'Universe'); await sleep(300); await gift('B', pick(NAMES), 'Lion', 2); await sleep(300); } },
  burst:      async () => { for (let i = 0; i < 20; i++) { await food(i % 2 ? 'A' : 'B'); await sleep(150); } },
  draw:       async () => { await sleep(1500); await post('/test/speedup'); },
  headline:   async () => { await join('A', 'superfan_alice'); await gift('A', 'superfan_alice', 'Universe', 5); },
};

const HELP = `
🧪 Tug-of-War Simulator — BASE_URL=${BASE}
  join|food|drink <A|B> [user]       gift <A|B> [user] [gift] [n]
  speedup | end | reset              auto [seconds=30] [rate=2]
  scenario <${Object.keys(SCENARIOS).join('|')}>
`;

const [cmd, ...a] = process.argv.slice(2);
const cmds = {
  join: () => join(a[0], a[1]), food: () => food(a[0], a[1]), drink: () => drink(a[0], a[1]),
  gift: () => gift(a[0], a[1], a[2] || 'Lion', Number(a[3] || 1)),
  speedup: () => post('/test/speedup'), end: () => post('/test/end'), reset: () => post('/test/reset'),
  auto: () => auto(Number(a[0] || 30), Number(a[1] || 2)),
  scenario: () => (SCENARIOS[a[0]] ? (console.log(`🎬 ${a[0]}`), SCENARIOS[a[0]]()) : console.log(HELP)),
};
if (!cmd || !cmds[cmd]) console.log(HELP);
else cmds[cmd]().catch((e) => { console.error('❌', e.message, '\n   Is the server running with DEMO_MODE=1?'); process.exit(1); });
