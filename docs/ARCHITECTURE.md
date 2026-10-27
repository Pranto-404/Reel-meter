# Architecture

Reel Meter is a Manifest V3 extension in plain JavaScript. There is no build step, no dependencies and no network access.

```
            ┌──────────────────────────┐
 page  ───▶ │ content.js (4 sites)     │  observes video + address, draws the counter island
            │  - tracker               │  and the block screen inside a closed shadow root
            └───────────┬──────────────┘
          small messages│ (platform, seconds, reels / unblock requests)
            ┌───────────▼──────────────┐
            │ background.js (worker)   │  saves daily totals, badge, nudges;
            │  - single write queue    │  the ONLY writer of block state; validates every unblock
            └───────────┬──────────────┘
                        │ chrome.storage.local / .session
            ┌───────────▼──────────────┐
            │ popup / dashboard (ui/)  │  read stats, edit settings, ask the worker to loosen blocks
            └──────────────────────────┘
        core.js: pure logic shared by all of the above and by the tests
```

## Files

| File | Role |
|---|---|
| `src/core.js` | All logic with no browser APIs (UMD: page, worker, UI and Node tests). URL classification, the tracker, stats, limits, nudges, restriction levels, `blockStatus`, `unlockCheck`, `applyUnlock`, `changePolicy`, state clamping. |
| `src/content.js` | Runs at `document_start` on YouTube, Instagram, TikTok and Facebook. Measures playing video, counts reels, draws the island and the block screen, re-checks blocking every 300 ms. |
| `src/background.js` | Service worker. Serialises writes, keeps the badge, owns `blockState`, checks the sender of every message, times unblock waits with its own clock. |
| `src/ui/*` | Popup, dashboard and the block settings panel (`blockpanel.js`). |
| `dev/*` | Fake-chrome harnesses, a tiny file server and the screenshot script. |

## Data model

- `stats[day]`: `{ r, s, p: { platform: { r, s } }, h: [24 hourly seconds] }`. Nothing about individual reels.
- `settings`: user choices, including `block` (`level`, `apps`, `hardLimit`, `schedules`, `shortsAsVideos`).
- `blockState`: running state written **only by the worker**: per-app `focus`, `breaks`, `lockUntil`, `unlocks[]`, plus `loosenUnlocks[]` and `loosenLock`. `normalizeBlockState(raw, now)` clamps every end time to "now plus the longest it can legitimately be", so a wrong clock cannot create a years-long break.
- `chrome.storage.session`: `unlockStarts`, the time a wait started and the tab, so the page cannot shorten a wait.

## Blocking decisions

Reason priority: **lockout, focus, schedule, hard limit, app block**. Everything is per app. Three levels (`gentle`, `balanced`, `strict`) set the wait, the sentence, the unblock count, the lockout and whether timed blocks can be unblocked. A break is 5 minutes at every level.

`changePolicy(eff, newSettings, now)` decides whether a settings change that weakens a block is `free`, needs a `challenge`, or is `denied-lock` / `denied-strict`. The dashboard asks the worker (`loosen-start`, `loosen`), which runs the same rules again.

## Privacy and security properties (all enforced by tests)

- Permissions: `storage`, `alarms`. No network APIs in any source file.
- The page-to-worker message carries only platform, seconds and reels; block requests carry only a platform and a typed sentence.
- A reel page can act only on its own app; foreign extension ids are ignored.
- Extension pages run under `default-src 'none'; script-src 'self'; connect-src 'none'; …`; the harness loads them under that policy and fails on any violation.

## Testing layers

1. `npm test`: unit tests for `core.js` and static checks over the whole package.
2. `npm run harness`: the **real** `content.js` and `background.js` run against a fake page and a compressed clock in headless Chrome (about 180 checks).
3. Real-browser spot checks (see `docs/HANDOFF.md`): headless Edge with the unpacked extension over `--remote-debugging-pipe` and `Extensions.loadUnpacked`.
