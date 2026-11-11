# Test Mode — Simulate Without Going Live

## Folder layout
    server.js  package.json
    public/index.html          ← the overlay (add as an OBS Browser Source)
    test/control-panel.html  test/simulator.js

## Quick start
    npm install
    npm run test          # manual   → http://localhost:8080/test/control
    npm run test:auto     # hands-free random events

Overlay: http://localhost:8080

**No server at all?** Open `public/index.html` straight from disk (or add `?demo`) — it runs a built-in simulation.
Keys in demo: `A`/`B` feed a team · `Shift+A`/`Shift+B` gift · `Space` ends the round.

## Ways to drive the server
- **Control panel** — `/test/control` (buttons, scenarios, live state)
- **CLI** — `npm run sim -- scenario gifts`, `npm run sim -- auto 60 3`, `npm run sim -- gift B bob Lion 5`
- **curl** — `curl -X POST localhost:8080/test/food -H 'Content-Type: application/json' -d '{"team":"A","user":"alice"}'`

## Endpoints (DEMO_MODE only)
| Endpoint | Body | Effect |
|---|---|---|
| POST /test/join  | {team, user} | Spawns a puller |
| POST /test/food  | {team, user} | +15 power |
| POST /test/drink | {team, user} | +5 power |
| POST /test/gift  | {team, user, gift, count} | base × count |
| POST /test/speedup | – | Timer → 10s |
| POST /test/end   | – | End round now |
| POST /test/reset | – | New random round |

`team` must be `"A"` or `"B"` (400 otherwise).

## Modes
| Env vars | TikTok | Test endpoints | Auto events |
|---|---|---|---|
| *(none)* | ✅ | ❌ | ❌ |
| `DEMO_MODE=1` | ❌ | ✅ | ❌ |
| `DEMO_MODE=1 AUTO_DEMO=1` | ❌ | ✅ | ✅ |

Live mode: `TIKTOK_USER=yourname npm start` (retries automatically if TikTok drops).
Viewers join by typing a team name (`!turkey`), `!1`/`!2`, `!a`/`!b`, `!join1`/`!join2`, or `!join` (auto-balance). Their side sticks while their country keeps playing. Gifts or `!food` from someone who hasn't joined place them on the smaller team.

## Sound
All effects are synthesised in the browser (no audio files). Browsers block audio until the page is clicked — click once, or in OBS tick **"Control audio via OBS"** on the Browser Source so it plays into the stream. Press `M` to mute, or add `?mute` to the URL.

## Daily leaderboard & next game
Countries are ranked by today's results (win = 3 pts, draw = 1). Top 3 show under the score bar; the top 5 show in the round-end screen together with a "next game" countdown. The board resets at local midnight and is saved in `daily.json` (`daily.demo.json` in test mode) so restarts don't lose it. Delete the file to reset by hand.

## Licenses
No images, audio or fonts are bundled; sounds are synthesised and visuals are drawn in code. See `NOTICE.md` for third-party licenses. Unofficial project, not affiliated with TikTok.

## Deploy on Railway
1. Push the project to a GitHub repo (`.gitignore` is included).
2. Railway → New Project → Deploy from GitHub repo.
3. Variables: `TIKTOK_USER=yourusername` (no @) and `DATA_DIR=/data`. Do not set `PORT`; Railway sets it.
4. Add a Volume mounted at `/data` (keeps the daily leaderboard between deploys).
5. Settings → Networking → Generate Domain, then open `https://<your-app>.up.railway.app`.
6. Logs should show `Connected to TikTok LIVE as <name>` once you are live.
7. OBS: Browser Source with that URL, tick "Control audio via OBS", size 1080×1920 (vertical) or 1920×1080.
Never set `DEMO_MODE=1` on a public deployment: it opens the test endpoints to anyone with the link.
