# Third-party notices

This project ships **no images, audio files or fonts**. Everything visual is drawn in code and every sound is synthesised in the browser, so there is no third-party artwork or music to license.

## Libraries
| Component | Use | License |
|---|---|---|
| three.js (+ examples/jsm post-processing) | 3D scene, loaded from jsDelivr | MIT, © three.js authors |
| express | web server | MIT |
| ws | WebSocket server | MIT |
| cross-env | env vars in npm scripts | MIT |
| tiktok-live-connector | reads TikTok LIVE chat/gifts | MIT (unofficial library, see note below) |

MIT requires the copyright and licence text to accompany copies of the software. The npm packages include theirs in `node_modules`; three.js is loaded from a CDN, not redistributed. If you ever bundle or host copies yourself, include each project's LICENSE file.

## Fonts
**Cinzel** and **Bebas Neue** are loaded from Google Fonts under the SIL Open Font License 1.1. Free for commercial use, including streaming. Not modified or redistributed here.

## Emoji and flags
Emoji (flags, food, gift icons) are drawn by the viewer's or streamer's operating-system emoji font, so no emoji artwork is included. Country flags are not subject to copyright restrictions for this kind of use.

## Names and trademarks
- Dish, drink and country names are generic and not trademarked.
- Gift names such as "Rose" or "Lion" are only used as lookup keys to recognise TikTok's gifts; the on-screen menu shows the dish names instead.
- "TikTok" is a trademark of its owner. This project is **unofficial and not affiliated with, endorsed by or sponsored by TikTok**. Say so in your stream description if you share the overlay.

## Not a copyright issue, but worth knowing
`tiktok-live-connector` reads TikTok's data without an official API. That may conflict with TikTok's terms of service and can stop working without notice. Review TikTok's current terms before streaming commercially.

## Your own code
The game code is yours to license. If you plan to share it publicly, add a `LICENSE` file (MIT is a common choice).
