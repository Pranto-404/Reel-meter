# Reel Meter

A browser extension that counts the short videos you watch (YouTube Shorts, Instagram Reels, TikTok, Facebook Reels) and the time you spend on them.

**Private by design.** It keeps daily totals on your device and nothing else. It never reads your screen, video titles, accounts or comments, and it has no way to send data anywhere.

## Install (Chrome, Edge, Brave)

1. Open `chrome://extensions` (Edge: `edge://extensions`).
2. Turn on **Developer mode**.
3. Click **Load unpacked** and pick this folder (`D:\reel app`).
4. The dashboard opens with a short privacy note. Pin the icon from the puzzle menu to see today's count on the toolbar.
5. **Refresh any YouTube / Instagram / TikTok / Facebook tab that was already open.** Chrome only adds an extension to pages that load after it is installed.
6. After you change the code, click the reload arrow on the extension's card in `chrome://extensions`, then refresh the reel tab.

If no counter appears on a reel page, see "Troubleshooting" below.

Firefox: open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on** and pick `manifest.json`.

## What you get

- **Live counter** on the page ("37 reels · 24m"). Tap it for details (pause 15 minutes, resume, dashboard, hide). It always starts at the top middle of the reel; you can drag it out of the way for the current page view, and double-click puts it back.
- **Toolbar badge** with today's reel count.
- **Popup**: today, by app, last 7 days, pause tracking (15 min, 1 hour, rest of today).
- **Dashboard**: 7/30/90 day charts (reels or minutes), a table view, by-app split, a weekday-by-hour pattern map, plain-language observations, weekly comparison.
- **Limits and nudges** (all optional, all gentle):
  - daily limit in reels and/or minutes
  - heads-up at 80% of a limit
  - reminder every N reels in a row (default 25)
  - a 10 second breathing pause when you reach a limit, then you choose to continue or leave
  - optional greyscale once you are over a limit
- **Block reels (optional)**: block per app, a focus timer (for the app you are on, or chosen apps), schedules, a hard daily limit, and YouTube Shorts opened as normal videos. A blocked reel page is replaced by a block screen. Getting past it takes a wait and typing a sentence, and opens a 5 minute break for that app only; the counter then offers "Block now". Everything is per app. Three levels (Less restriction, Restricted, Full restriction) set the wait, the sentence and the lockout: on Restricted, 3 unblocks within 3 hours lock that app for 6 hours. Loosening a running block needs the same challenge, which the background worker checks with its own clock (not allowed on Full restriction, nor during a lockout). With a hard daily limit on, pausing and switching an app off do not stop the count.
- **Your data**: export your counts as JSON or CSV, delete the counts in one click. Settings and the blocker's running state stay until you uninstall; while a hard daily limit is on, today's count is kept.

## Troubleshooting

| Symptom | Fix |
|---|---|
| No counter on a reel page | Refresh the tab (F5). Then check the extension is on at `chrome://extensions` and that the site is one of the four supported. |
| Counter is there but you cannot see it | It sits at the top centre of the reel. Change **Counter position** in the dashboard (for example "Right side, middle of screen"), or drag it. Tap it and press **Hide** to remove it until the page reloads. |
| Counter says Paused | You paused tracking. Press **Resume** on the counter itself, or in the popup. |
| Count stays at 0 | A reel counts after 2 seconds of playing and only while the video is playing and the tab is visible. Check the app is ticked under "Apps to track". |
| Still wrong | Right-click the page, Inspect, Console tab, and look for red lines mentioning Reel Meter. `chrome://extensions` > Reel Meter > Errors also shows them. |

## How counting works

| Thing | Rule |
|---|---|
| A reel counts | after it has played for 2 seconds (adjustable 1 to 10) |
| Time counts | only while a video is on screen, playing, and the tab is visible |
| Idle | timing stops after 2 minutes without touching the page (adjustable) |
| Looping | a reel that loops is counted once |
| YouTube, Instagram, Facebook | the reel is told apart by the page address changing |
| TikTok For You feed | the address never changes, so the video on screen is used instead |

## What is stored

Per day: reels and seconds in total and per app, plus seconds per hour of the day. No video ids, titles, URLs or timestamps of single reels. Days older than 400 are removed.

## Privacy you can verify

- Permissions are only `storage` and `alarms`. No `tabs`, `history`, `webRequest` or `downloads`.
- It runs only on the four sites listed in `manifest.json`.
- Extension pages carry a strict security policy (`default-src 'none'`, scripts only from the extension itself, `connect-src 'none'`, no frames, no forms). `npm run harness` loads the dashboard and the popup under that exact policy and fails on any violation.
- `npm test` fails if the permissions grow, if any source file uses `fetch`, `XMLHttpRequest`, `WebSocket`, screen capture or similar, or if the message the page script sends ever carries more than platform, seconds and reels.

## Project layout

```
manifest.json          extension manifest (Manifest V3)
src/core.js            all logic: URL rules, tracker, stats, limits, nudges (no browser APIs)
src/content.js         runs on the four sites: observes, shows counter, toast, pause overlay
src/background.js      saves totals, badge, decides nudges
src/ui/                popup and dashboard
icons/                 generated by scripts/make-icons.js
test/                  42+ unit tests and static privacy checks (node:test, no dependencies)
dev/                   preview tools: fake-chrome harnesses for the UI and for end-to-end checks
```

## Develop

```
npm test                      # unit tests and static checks
node dev/serve.js             # then open:
  http://127.0.0.1:5178/dev/harness.html?page=dashboard    (or page=popup, empty=1)
  http://127.0.0.1:5178/dev/content-harness.html           (runs the real content + background scripts
                                                            against a fake page and a compressed clock)
```

## Releasing

`npm run build` makes store-ready packages in `dist/` (one for Chrome, Edge and Opera, one for Firefox). `store/` holds the listing text, the privacy policy and the store images (`npm run shots` remakes them). `PUBLISHING.md` is the step-by-step guide for each store.

## Known limits

- Site pages change. If a site changes how its reel pages are addressed, counting for that site stops until `classify()` in `src/core.js` is updated (it is one small function with tests).
- No cross-device totals: each browser keeps its own numbers.
- Ignoring "educational" channels is deliberately not offered: it would require reading channel names from the page. You can turn a whole app off instead.
- Not yet run on the live sites inside a real browser with the extension installed. It has been tested end to end against a simulated page (see `dev/content-harness.html`), so the first real-world check is worth doing on each site.

## Contributing, security and license

- How to run, test and release: [CONTRIBUTING.md](CONTRIBUTING.md). Design notes: [docs/HANDOFF.md](docs/HANDOFF.md). History: [CHANGELOG.md](CHANGELOG.md).
- Report a security problem privately: [SECURITY.md](SECURITY.md).
- Licensed under the [MIT License](LICENSE).
