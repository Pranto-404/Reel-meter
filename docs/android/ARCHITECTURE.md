# Reelity for Android: architecture

Written 2026-11-15 by the architect, revised the same day after the QA review (`reviews/QA.md`, "Q<n>") and the user-type
test (`reviews/USER-TEST.md`, "U"). Decision-oriented; nothing is built yet. Order, scope and dates live in
[ROADMAP.md](ROADMAP.md); on technical points this file wins, and ROADMAP must be re-synced whenever this file says
**Changed:**. Sources [S1]... are at the end; rejected review points are listed in "Review decisions".

## 1. Goals and non-goals

**Goals**
- Count short videos and minutes in **YouTube Shorts, Instagram Reels, TikTok, Facebook Reels**, per app and per day.
- Daily limits, gentle nudges, breathing pause; optional per-app **blocking** with the extension's three levels, 5-minute
  breaks, waits, typed sentence, strikes, lockouts, focus timers and schedules; a dashboard.
- **Same rules as the extension** at minimum, proven by shared JSON test vectors; Android may be **stricter** (clock tricks).
- **Pass Google Play review on the first or second try.** Easy for first-time users on cheap phones (English + Bangla).
- Lightweight: download **under 4 MB** (release build, CI gate), no foreground service, no wake locks, near-zero work when
  no target app is open.
- Privacy: no account, no analytics, no crash SDK, **no INTERNET permission**, never reads text or video content, data stays
  on the device, export/delete in one tap.

**Non-goals (v1)**
- Parental control or anything that stops the user from turning the app off (Play forbids it [S1]; we say so honestly).
- "Watch Shorts as normal videos", greyscale (needs `WRITE_SECURE_SETTINGS`), reading video ids or titles.
- **Data import** (v1 is export only), cloud backup and device-to-device transfer of our data, sync between devices.
- iPhone (iOS cannot observe other apps' screens). Widgets (later, plain `RemoteViews`).
- A live counter drawn over other apps: v1.1 (decision O4); v1 has an optional quiet notification instead.

## 2. Key research findings that shape the design

1. **Accessibility is allowed for a wellbeing app with a prominent in-app disclosure, affirmative consent, a Play Console
   declaration and a video** [S1]. No `isAccessibilityTool` (disability tools only). The API must not change settings, block
   disabling/uninstalling, or act autonomously; deterministic, user-defined rules are allowed [S1][S2]. The listing must
   describe the use [S2]. Apps doing exactly this are on Play (Decafly, Focsy, Block Scroll) [S3].
2. The usual rejection is "could not locate prominent disclosure"; declarations stay tied to **every active track** [S4].
   Internal-track uploads may skip policy review, so only a **closed**-track submission is a real verdict [S16].
3. **Android 17 Advanced Protection revokes accessibility from non-tool apps** [S5]. Side-loaded apps need "Allow restricted
   settings" first; Play installs are exempt [S6].
4. Target **API 36** for new apps and updates from 31 Aug 2026 [S7]; AndroidX floor **minSdk 23** [S8].
5. Data processed only on the device is not "collected"; the Data safety form is still mandatory [S9].
6. New personal accounts: **12+ testers opted in 14 consecutive days** in a closed test [S10]. AAB + Play App Signing [S11].
7. OEMs kill background work; TECNO, Infinix and Xiaomi lead the Bangladesh market and are among the aggressive ones
   [S12][U2][U4]. Accessibility can look "on" while the service is dead.
8. Reel-screen view ids change often [S13]; with no INTERNET, rules ship in app updates and detection uses several signals.
9. Compose costs ~0.7 MB after R8 [S14]; extra libraries cost more than Compose. `allowBackup=false` does not stop
   device-to-device transfer on all devices [S17].

## 3. Play-policy compliance strategy

### Permissions (complete list; the CI privacy check fails on anything else in the merged manifest)

| Permission / component | Why | How it is asked |
|---|---|---|
| `AccessibilityService` (bound with `BIND_ACCESSIBILITY_SERVICE`) | Only way to know a **reel screen** (not just the app) is open and to show the block screen then. UsageStats cannot see screens inside an app. | Disclosure screen (onboarding step 3), then Settings > Accessibility. Optional. |
| `PACKAGE_USAGE_STATS` (Usage access) | Time per app; "app time only" for Lite apps and when accessibility is refused/revoked; cross-check that the service still works. No Play declaration exists for it; we still disclose it. | **Not in onboarding** unless accessibility was refused; otherwise offered later on a dashboard card. Optional. |
| `POST_NOTIFICATIONS` (API 33+) | "Reel #1 counted", quiet daily count, nudges, "service stopped". | When the user turns on the count notification (onboarding step 5) or a nudge. |
| `<queries>` with the 8 package names below | Show which target apps are installed. Avoids `QUERY_ALL_PACKAGES`. | none |
| AndroidX `DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` | Library internal, signature-level. | none |

**Absent on purpose:** `INTERNET` (also `tools:node="remove"`), `SYSTEM_ALERT_WINDOW`, `FOREGROUND_SERVICE*`,
`REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` (Play-restricted; we deep-link to battery settings), `SCHEDULE_EXACT_ALARM`,
`RECEIVE_BOOT_COMPLETED`, `QUERY_ALL_PACKAGES`, `QUERY_ADVANCED_PROTECTION_MODE` (see §10), notification listener,
`canPerformGestures`.

**Target packages** (8, all in `<queries>` and in the service's `packageNames`): `com.google.android.youtube`,
`com.instagram.android`, `com.instagram.lite`, `com.zhiliaoapp.musically`, `com.ss.android.ugc.trill`, TikTok Lite
(`com.zhiliaoapp.musically.go`, confirm in M1), `com.facebook.katana`, `com.facebook.lite`. Lite apps are counted only if the
M1 spike finds stable reel signals; otherwise the app picker labels them **"app time only"** (Usage access).

### Accessibility service configuration (narrow on purpose; reviewers read it)

- `packageNames` = the 8 targets; events from other apps never reach us. `flagRetrieveInteractiveWindows` (split screen, PiP).
- Base events: `typeWindowStateChanged`. While a target app is in front, `setServiceInfo()` adds `typeViewScrolled`,
  `typeViewClicked`, `typeWindowContentChanged`, `typeWindowsChanged`; removed when it leaves. `notificationTimeout` 250 ms.
- `canRetrieveWindowContent=true`, `flagReportViewIds`. No gestures, key filtering, fingerprint, accessibility button.

### Disclosure (onboarding step 3; final copy by the UX agent, translated to Bangla)

Standalone, scrollable, both buttons always visible, Back = "Not now", reachable later from Settings > "Permissions and
privacy", separate from every other notice, never only in the privacy policy. Content, in plain words (U §3):
- **"Let Reelity notice when a reel is open."** It uses Android's **Accessibility** feature, only inside YouTube,
  Instagram, TikTok and Facebook, and only to see *which screen* is open (for example "the reels player").
- **Never reads:** words on the screen, messages, comments, captions, passwords, anything you type, who you follow or which
  videos you watch. No screen recording.
- **Does:** counts reels and minutes; if you turn on blocking, shows Reelity's stop screen or goes **Back or Home** for you.
- **Not covered:** YouTube in a browser, reels inside other apps' built-in browsers.
- **Data:** only daily totals on this phone; no internet permission, so nothing can be sent.
- **Heads-up:** Android will next ask whether Reelity may have "full control" / "view and control screen". Android shows
  this for every Accessibility app; Reelity is limited to the apps above.
- Off any time in Settings > Accessibility; Reelity then shows app time only. Buttons **Agree and turn on** / **Not now**.
Usage-access screen (shorter): "See how long you spend in each app. Android's Usage access tells Reelity which app was open
and for how long, nothing inside it. Stays on this phone." Buttons **Turn on (1 step)** / **Skip**.

### What we submit

- **Accessibility declaration:** not an accessibility tool; purpose "App functionality"; data collected or shared through the
  API: **No**. Text: *"Reelity is a digital wellbeing app. With the user's consent its AccessibilityService, limited to
  YouTube, Instagram, TikTok and Facebook (and their Lite apps), detects when a short-video screen is open using only package
  names, window bounds and view resource ids, never text. It counts short videos and time and, only if the user enables
  blocking, shows the app's own block screen or performs Back/Home. No data leaves the device; the app has no internet
  permission. UsageStatsManager cannot tell which screen inside an app is open, so no narrower API provides this."*
- **Video** (unlisted, < 90 s): launch, onboarding, full disclosure scrolled slowly, "Not now" path and how to reopen it,
  "Agree" path, enabling the service, a reel counted, the block screen, recorded on a real phone. Listing
  screenshots come from `:fakereels`, never real third-party UI.
- **Timing (Q4):** declaration and video drafted at **M2** and already describing blocking. First **closed**-track submission at
  the end of M2 is the policy probe. The 14-day closed test starts on the first build that contains blocking (M4, blocking
  off by default), so the declaration does not change mid-test. Any later change: update declaration + video and ship to
  all active tracks [S4].
- **Data safety:** no data collected or shared. Privacy policy on GitHub Pages. **Audience 18+**, category Productivity,
  no ads, no IAP.
- **Listing:** line 1 "No internet permission: Reelity cannot send anything"; line 2 explains Accessibility in ~20 words;
  title ≤ 30 characters without third-party trademarks (O2).

## 4. Project layout (`android/`, Gradle Kotlin DSL, version catalog)

```
android/
  settings.gradle.kts build.gradle.kts gradle.properties (versionName, versionCode) gradlew(.bat) gradle/ (wrapper, libs.versions.toml)
  core/        pure Kotlin JVM library: the port of core.js. No Android imports (enforced by being a JVM module).
  app/         the Android app (single AAB). Depends on :core. debug.keystore (not secret, debug only).
  fakereels/   debug-only test app mimicking reel screens with fake view ids; used by instrumented tests and screenshots.
  size-baseline.txt
shared/test-vectors/   JSON cases run by the extension tests and android/core tests
```
**Why three modules:** `:core` keeps the rules free of Android APIs and runs its tests on a plain JVM in seconds; `:fakereels`
is our version of the extension's fake-page harness. No feature modules.

Packages in `:app`: `a11y/` (ReelService, Detector, DetectorRules, BlockOverlay), `engine/` (Engine, Clocks), `data/`
(JsonStore), `usage/` (UsageReader), `block/` (BlockActivity, PauseActivity), `notify/` (channels, count notification),
`health/` (ServiceHealth, BrandGuides), `ui/` (MainActivity, onboarding, dashboard, limits, block settings, privacy, theme),
`tile/` (FocusTileService, v1 if time allows). Assets: `detector-rules.json`. Strings: `values/` (en) and `values-bn/`
(Bangla); **no hard-coded UI text** (lint `HardcodedText` as error); numbers and dates through locale formatting.

**Dependencies (closed list):** Kotlin stdlib, kotlinx-coroutines-android, kotlinx-serialization-json, androidx.core,
androidx.activity-compose, Compose BOM (ui, foundation, material3; no icons-extended), lifecycle-runtime-compose,
profileinstaller. Tests: JUnit, kotlin-test, compose ui-test, androidx.test runner, uiautomator.
**Not used:** Room, DataStore, WorkManager, Hilt/Dagger, Navigation-compose, Accompanist, Lottie, chart libraries,
Firebase, OkHttp/Retrofit, Glance. Charts use Compose `Canvas`; ~12 vector icons.

## 5. Components

| Component | Role (extension equivalent) |
|---|---|
| **ReelService** | Gets events from target apps only; asks Detector about each visible target window; runs the 1 Hz tick while a reel window is visible; asks Engine for `blockStatus`; starts the block. Records a heartbeat for ServiceHealth. (`content.js`) |
| **Detector** | Pure function over a small `Node`/`Window` model (viewId, className, bounds, visible, window bounds, window type): returns `{platform, onReel, pageKey}`. JVM-tested on recorded trees. (`classify()`) |
| **Engine** | Single writer of stats, settings, blockState on one serial dispatcher; runs the `:core` rules (flush, nudges, unlock-start, unlock, end-break, focus, loosen). Trusts only in-process calls. (`background.js`) |
| **JsonStore** | `stats.json`, `settings.json`, `blockstate.json` in `filesDir` (§6). |
| **UsageReader** | `UsageStatsManager.queryEvents` on demand (dashboard, day close, health check); never polls. |
| **BlockActivity / BlockOverlay** | Plan A: full-screen Compose activity in its own task. Plan B: `TYPE_ACCESSIBILITY_OVERLAY` window (plain Views, no draw-over permission) sized to the reel window, used in split screen/PiP or when the activity cannot start. |
| **PauseActivity** | 10-second breathing pause at the limit (if enabled); dismissable. |
| **Notifications** | Silent channels: "Reel #1 counted" (once), optional quiet "Today: 34 reels · 21 min" updated only when leaving a reel screen, nudges (max one per type per limit), "Reelity was stopped: Fix it" (max one a day). |
| **ServiceHealth + BrandGuides** | Detects a killed service and runs the "Fix it" flow (below). |
| **MainActivity** | Onboarding, dashboard, limits, block settings, focus, schedules, privacy (export, delete), detection health, diagnostics. |

### Onboarding (6 screens at most, U §3)

1. **Welcome**, language chips **English | বাংলা**; "No account. No internet. Everything stays on this phone." 2. **Pick apps**:
installed targets ticked, Lite apps labelled honestly. 3. **Disclosure** (§3). 4. **Brand guide** (after Agree): 3 steps for
this phone's brand (`Build.MANUFACTURER`) with an illustration, then Open Settings (try the `:settings:fragment_args_key`
highlight extra; M1 checks it). When the service connects within 5 minutes of that tap, ReelService brings onboarding back to
a ✓ screen: a direct result of the user's action, not autonomous. If they return without enabling: one "Stuck? Here is where
to tap" screen, then "Use app time only instead" (Usage access). Never a second nag in the session. "Not now" on step 3 goes
to the Usage-access screen. 5. **You're set**: "Open a reel to try it; we'll confirm reel #1." Switch "Show today's count in
notifications" (asks POST_NOTIFICATIONS); on risky brands "Fix now" for battery settings. 6. **Goal** (optional): 30 / 60 / 100
reels / **Just count for now** (preselected). **Blocking is not offered in onboarding.**

**Blocking off by default.** From day 3 a dashboard card offers it with the user's own numbers. The first time blocking is
turned on within 7 days of install, the preselected level is **Less restriction** (`gentle`); the user can pick another. Before
saving, the rule is shown in one sentence with a clock time ("3 unblocks in 3 hours lock Instagram reels until about 9:40 pm").
`normalizeBlock` keeps `balanced` as its fallback, so vectors are unchanged; Android always writes an explicit level.

### Service health and the "Fix it" flow

- "Enabled" = our component is in `Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES` (readable without permission).
  "Running" = ReelService connected in this process (a process-wide flag) and a heartbeat (last event or connect time).
- Enabled but not running when the UI opens, or Usage access shows ≥ 10 min in a counted app today with no reel window seen
  since the last heartbeat ⇒ dashboard banner and at most one notification a day: **"Your phone stopped Reelity. Fix it
  (2 taps)"** ⇒ the brand guide for battery/autostart.
- BrandGuides (short text + drawing, from dontkillmyapp steps rewritten): Xiaomi/Redmi/POCO, Samsung, **TECNO, Infinix, itel**
  (HiOS/XOS incl. "Power Marathon" and short-video optimisation), Oppo/realme/OnePlus, vivo, Walton, Symphony, Huawei/Honor,
  generic. Deep links tried in order, falling back to `ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS` and app details.
- Not enabled while it was before (e.g. Advanced Protection or the user) ⇒ generic message "Reel counting is off; app time
  still works" + Turn on again.

### Detection (starting hypotheses; the M1 spike confirms ids per app version and brand)

| App | Reel window signal (any one, visible, covering ≥ 60% **of its own window**) | New reel = |
|---|---|---|
| YouTube | id in `reel_recycler`, `reel_player_page_container`, `reel_watch_player` | full-page vertical scroll on the reel pager |
| Instagram (+ Lite) | id in `clips_viewer_view_pager`, `clips_video_container` | page change on the clips pager |
| TikTok (+ Lite) | For You / Following feed pager id | page change on the feed pager |
| Facebook (+ Lite) | Reels viewer container id or class pattern | page change; **best effort**, else "app time only" |

`detector-rules.json` holds per package: candidate ids, pager ids, min coverage. Lookups use
`findAccessibilityNodeInfosByViewId` on each target window from `getWindows()` (works in split screen, freeform and PiP and
when the other half has focus), never a full tree walk; at most one check per 300 ms.

### Counting (port of `ReelTracker`)

The tick runs only while a reel window is visible and the screen is on (`PowerManager.isInteractive`). Each tick passes
`{platform, key=pageKey, playing, visible, lastInputAt}` to the ported tracker unchanged. `visible` = a target window with a
reel match is on screen (re-checked from `getWindows()` each tick, which also detects leaving the app). **`lastInputAt` = last
`TYPE_VIEW_SCROLLED` on the reel pager or `TYPE_VIEW_CLICKED` in the target package; content changes never update it**
(players emit them constantly). `playing = visible`. So an untouched looping reel stops counting after `idleCutoffSec`
(default 120 s), as in the extension. A reel counts after `minDwellSec` on one page; a loop is one reel. Flush to Engine every
15 s and on leaving. In-app wording: time means "a reel screen was open and in use".

### Blocking flow (port of `handleBlock`)

1. A reel window of a blocked app becomes visible ⇒ full-screen app window: start **BlockActivity**; split screen, freeform or
   PiP: show **BlockOverlay** over that window's bounds. The covered app gets `onStop`/is hidden, so its video pauses.
2. If BlockActivity is not resumed within 700 ms (background start refused [S15]): BlockOverlay; if that fails,
   `GLOBAL_ACTION_BACK`, and a second miss within 5 s `GLOBAL_ACTION_HOME`. These are the only two global actions in the code.
3. **Re-block on every `TYPE_WINDOW_STATE_CHANGED`/`TYPE_WINDOWS_CHANGED`** into a blocked reel (Recents, deep links,
   share links, rotation, unfold). BlockActivity is `excludeFromRecents`, own `taskAffinity`, `exported=false`.
4. **Back on the block screen = "Leave reels"** (go Home) through an enabled `OnBackPressedCallback` (predictive back on
   targetSdk 36 never calls `onBackPressed`). "Leave reels" is the first, largest button. The overlay's buttons are "Leave
   reels" and "Open Reelity to continue" (a tap, so starting our activity is allowed).
5. "I need to continue": Engine records the start with `elapsedRealtime`; the wait counts only while BlockActivity is resumed;
   sentence check, `unlockCheck`, `applyUnlock` run in Engine; on success the activity finishes and the reel is back.
   Sentence field: no suggestions, no autocorrect, paste blocked, sentence pinned above the keyboard, fits 200% font on 360 dp.
6. Full restriction copy says plainly: "You can still turn Reelity off in Android settings." Nothing hides or protects the
   accessibility toggle or uninstall [S1].
7. **Latency budget:** detect ⇒ block visible p95 ≤ 500 ms on `:fakereels` (timestamps asserted in the instrumented test);
   ≤ 1 s and no audio after 1 s on real phones.

**Escape list (M4 pass/fail each):** app switch, Recents, rotation, split screen, freeform, PiP, notification shade, deep link,
share link, force-stop of the target, reboot, wall-clock change, foldable unfold, Back on the block screen. **Accepted escapes**
(documented): turning the service off, clearing our data, uninstalling, Advanced Protection.

### Clock-trick protection (Android stricter than core.js)

Every break, focus and lock end is stored as `{wall, elapsed, boot}` (`elapsed` = `elapsedRealtime` end, `boot` =
`Settings.Global.BOOT_COUNT`). Within the same boot an end has passed only when **both** clocks say so, so moving the wall
clock forward cannot end a block early and moving it back cannot stretch a break past 5 minutes. After a reboot only `wall`
is left, clamped by `normalizeBlockState(raw, now)` as in the extension. Strike windows use wall time (vectors define that).

### Component security (Q15; manifest parts asserted by the privacy check)

- Only MainActivity is exported (launcher); every other activity, the tile and providers are `exported=false`; ReelService is
  exported only as the platform requires, guarded by `BIND_ACCESSIBILITY_SERVICE`.
- No component reads intent extras that change settings or block state; Engine accepts only in-process calls.
- All PendingIntents explicit and `FLAG_IMMUTABLE`. Export via the share sheet from a FileProvider limited to `cache/export/`.
- Errors never loosen blocking (see §6 recovery); a full disk keeps state in memory and retries, never crashes the service.

## 6. Data model and storage (daily totals only, same JSON shapes as the extension)

- `stats.json`: `{ "YYYY-MM-DD": { r, s, p: { youtube: {r, s}, ... }, h: [24], a?: { app: seconds } } }`. `a` (Android only)
  = app time from Usage access, written when a day closes; Lite apps are keyed under their platform. Pruned after 400 days.
- `settings.json`: the extension's normalized settings (same keys and clamps). Extension-only fields are ignored. Android-only
  fields under `android: { countNotification, installedOn, blockOfferShown, lang }`.
- `blockstate.json`: the extension's shape plus `ends: { <field>/<app>: { elapsed, boot } }` for §5 clock protection. Written
  only by Engine.
- Memory only: unlock wait starts, nudge session, detector health counters, last 5 crash stack traces (no content) in
  `filesDir/crash/` for "Copy diagnostics".
- **Atomic writes:** `AtomicFile` (write `name.new`, fsync, rename; Android keeps `name.bak` during the write). After each
  successful write the previous version is kept as `name.good`. On read: `name` → `name.good` → defaults. For
  `blockstate.json` "defaults" means no breaks, focus and locks from `name.good` if present, and a dashboard notice; never a
  break that was not granted.
- **Backup:** `allowBackup=false`, `dataExtractionRules` excluding `root` from both `<cloud-backup>` and `<device-transfer>`,
  `fullBackupContent` excluding everything for API ≤ 30 [S17]. Asserted by the privacy check.
- **Export only** in v1 (JSON compatible with the extension's `{exportedOn, stats}`); no import. Delete = all three files.

## 7. Keeping the rules in sync: shared test vectors

- `shared/test-vectors/<area>.json`: `{ "fn", "tz", "cases": [ { "name", "input", "expect" } ] }`. Areas: settings
  normalize, levels, blockReason/blockStatus, unlockCheck/applyUnlock, applyFocus, applyEndBreak, weakens/changePolicy,
  normalizeBlockState clamps, tracker tick sequences (incl. "5 min untouched loop ⇒ ≤ 120 s"), recordActivity/pruneStats,
  evaluateLimits, decideNudge, goalStreak, sentenceMatches, day keys.
- **Encoding:** `{"$undef":1}` for undefined, `{"$num":"NaN"|"Infinity"|"-Infinity"}`. Every case passes `now` explicitly.
  Comparison: deep-equal, numbers by value, key order ignored.
- **Time zones:** each area runs in `Asia/Dhaka`, `America/New_York`, `America/Santiago` (DST at midnight) and
  `Australia/Lord_Howe` (30-min DST). JS sets `TZ` per run; Kotlin passes a `ZoneId`.
- **`core.js` is the reference.** `extension/scripts/gen-vectors.js` writes `expect` from curated inputs **plus ≥ 500
  seeded-random cases per function**; CI regenerates and fails on `git diff`. Gates: vectors alone reach **≥ 95% branch
  coverage of `core.js`** (`node --test --experimental-test-coverage`), and every function Kotlin ports appears in a vector
  file. A change to `extension/src/core.js` or `shared/**` triggers both workflows.
- Kotlin: `:core` adds `../../shared/test-vectors` as a test resource dir; `VectorsTest` maps each `fn`. `Long` epoch ms +
  `ZoneId`, no `java.util.Date`; names match core.js.
- Outside vectors (own JVM tests, listed in TESTING.md): pageKey from pager events, idle input rules, two-clock ends,
  JsonStore recovery, ServiceHealth, block-launch fallback. A rule change = core.js + regenerated vectors + Kotlin, one PR.

## 8. Threading

- Main thread: accessibility callbacks only filter and post to one **detector HandlerThread** (coalesces 300 ms).
- Engine: one dispatcher with parallelism 1; all file I/O through it. UI observes `StateFlow`s. No `runBlocking`.
- Block ends need no timer (evaluated on the next event). "Focus ended" and the optional Sunday recap use inexact
  `AlarmManager.setAndAllowWhileIdle`, recomputed when the service connects. Day keys computed at write time.

## 9. Budgets (each one measurable in CI or in the app)

| Budget | Target | Measured by |
|---|---|---|
| Download size | < 4 MB; CI fails above 6 MB or > +10% over `size-baseline.txt` | **release AAB** → `bundletool build-apks` + `get-size total` (arm64 spec); baseline changes only in a PR that says why. Debug APK size printed, never gated. |
| CPU | ≤ 36 CPU-s per active reel-hour; 0 wakeups with no target app | `Process.getElapsedCpuTime()` per reel-hour, shown in Detection health |
| RAM | service process < 40 MB PSS with UI closed | instrumented test `dumpsys meminfo` |
| Block latency | p95 ≤ 500 ms on `:fakereels` | instrumented timestamps |
| Accuracy | ±5% on the M2 protocol: 50 reels incl. 10 skips < 1 s (must not count), 5 loops, 5 back-swipes, minutes vs stopwatch; 10 min of non-reel use per app ⇒ 0 reels | owner + testers, scripted in TESTING.md |
| Writes | flush ≤ every 15 s while active; files < 200 KB | JVM test |
| Cold start | < 500 ms on the owner's phone; CI gates only on regression vs the previous nightly | macrobenchmark |
| Stability | closed test: 0 crashes/ANRs in pre-launch report and vitals; production 99.5% crash-free | Play Console |

Size levers: R8 full mode, `isShrinkResources`, `localeFilters += listOf("en", "bn")`, no animations on API 26-27 or when
"Remove animations" is on.

## 10. SDK levels

- `compileSdk` latest stable; **`targetSdk 36`** at launch [S7]; 37 once the emulator lanes pass on it.
- **`minSdk 26`** (O1): reach on budget phones; AndroidX floor is 23 [S8]; a few `SDK_INT` checks (33 notifications,
  28 scroll deltas).
- **Advanced Protection (Q13):** we do **not** call `AdvancedProtectionManager` (needs `QUERY_ADVANCED_PROTECTION_MODE`). The
  ServiceHealth "was enabled, now not" path shows the generic message and runs app-time mode.

## 11. Testing pyramid

1. **`:core` JVM tests:** every shared vector + Kotlin edge cases; 90%+ line coverage.
2. **`:app` JVM tests** (no Robolectric): Detector on recorded trees (M1 captures per app version, including split screen),
   Engine with fake clocks (wall, elapsed, boot), JsonStore recovery and full disk, ServiceHealth rules.
3. **Static privacy checks** (Gradle task `privacyCheck`): merged-manifest permission allowlist; `exported` rules; backup
   rules; banned symbols in `a11y/` (`.text`, `getText`, `contentDescription`, `hintText`, `stateDescription`, `paneTitle`,
   `takeScreenshot`) and anywhere (`java.net`, `HttpURLConnection`, `Socket`, `WebView`, `URL(`); accessibility XML keeps
   `packageNames`, has no `isAccessibilityTool` or `canPerformGestures`; no hard-coded UI strings; every `values/` string
   exists in `values-bn/` or is marked untranslated (warning until Bangla ships).
4. **Instrumented** (emulator on ubuntu runners with KVM, **API 26, 30, 36, 37**; nightly and on PRs labelled
   `run-emulator`): enable ReelService with `adb shell settings put secure enabled_accessibility_services`, drive
   `:fakereels` with UiAutomator: counting, idle loop, block latency, split screen, Back on the block screen, wait + sentence,
   lockout, two-clock protection (`date` change), disclosure before any settings intent, TalkBack labels, 200% font.
5. **Real phones:** M1 spike on the owner's phone; closed-test matrix Samsung, Xiaomi, **TECNO, Infinix, itel**,
   Oppo/realme, vivo, Pixel; Lite apps included.

## 12. CI and release pipeline (GitHub Actions, ubuntu; the owner's PC builds nothing)

- **Single source of Gradle tasks** (ROADMAP points here): `./gradlew :core:test :app:testDebugUnitTest :app:lintRelease
  privacyCheck :app:assembleDebug :app:bundleRelease sizeCheck`.
- `android.yml` (reusable): `gradle/actions/wrapper-validation`; `actions/setup-java` (Temurin 21);
  `gradle/actions/setup-gradle` with `cache-read-only` except on `main`; uploads debug APK + release AAB (14 days).
  PR trigger `types: [opened, synchronize, reopened, labeled]` for `run-emulator`.
- Day-one details: commit `gradlew` with the exec bit (`git update-index --chmod=+x android/gradlew`); the wrapper is
  generated by a `workflow_dispatch` job that uploads the files and an agent commits them via PR (no `contents: write` on
  `main`).
- **Debug builds** are signed with the committed `android/app/debug.keystore` and use `applicationIdSuffix ".debug"`, so each
  CI APK installs over the last one (data kept) and coexists with the Play build. Used for the M1 spike only.
- `android-release.yml` on tag `android-vX.Y.Z` or `android-vX.Y.Z-rc.N`: guard that the tag matches `versionName`/
  `versionCode` in `android/gradle.properties`; build; sign the AAB with the **upload key** from the `play-release`
  environment (owner approves each run); upload as an artifact; the owner uploads it in Play Console. Play App Signing holds
  the app key [S11]. No release keystore, password or `key.properties` in the repo (`.gitignore` + CI grep for
  `*.jks`/`*.keystore` other than the debug one).
- Testers install from **Play internal/closed tracks**. Crash insight: Play vitals + "Copy diagnostics" (versions, detector
  health, CPU budget, last 5 stack traces; no content).

## 13. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Play rejects the accessibility use | Disclosure + consent per [S1]; narrow config; declaration + video drafted at M2; closed-track probe at end of M2 [S16]; app usable with "Not now"; all tracks on the same declared build [S4]. |
| Users quit at the settings trip or "full control" dialog | Warned in the disclosure, brand guide, highlight extra, auto-return ✓, one "Stuck?" screen, app-time fallback. |
| Target apps change view ids | Data-driven rules with candidates; recorded-tree tests; Detection health + "Report detection problem" (ids only); monthly check; fast updates. |
| Lite apps / Facebook give too few ids | Labelled "app time only"; never silently zero. |
| OEM kills the service (TECNO, Infinix, Xiaomi...) | ServiceHealth "Fix it" flow, brand guides, Transsion phones in M1 and the closed test; no FGS hacks. |
| Background activity start refused | BlockOverlay plan B, then Back/Home; M1 tests both on API 36 and 37. |
| Advanced Protection | Generic "counting is off" message and app-time mode, no extra permission. |
| First strict lockout drives users away | Blocking off by default, offered on day 3, gentlest level in week one, lock end as a clock time. |
| Closed test fails (12 x 14 days) | 15-20 testers recruited early (ROADMAP). |
| Upload key loss | Play App Signing reset; two offline copies. |
| Size creep | Release-build size gate; closed dependency list; new libraries need a decision record. |

## 14. Open decisions for the owner (recommendation first)

| # | Decision | Recommendation |
|---|---|---|
| O1 | minSdk | **26 (Android 8.0)**; 28 only if M1 shows gaps on 26-27. |
| O2 | Permanent app id and Play title (≤ 30 chars, no "Shorts"/"Reels" trademarks in the title) | **`io.github.pranto404.reelity`**, title **"Reelity: Reel Counter"**; "block reels" goes in the short description. |
| O3 | Facebook and the Lite apps in v1 | **Best effort**: counted where M1 finds stable signals, otherwise "app time only". |
| O4 | Live counter over other apps | **v1.1**; v1 has the quiet count notification and "Reel #1 counted". |
| O5 | Bangla at launch | **Yes if the owner's ~250 translated strings are ready by M5**; strings are externalised from day one either way. |

Settled since the first draft: storage = JSON files (lead), Usage access = optional and offered later (U), import = none in v1
(lead).

## Review decisions (rejected or partly applied)

- Q1, Q2, Q3 (roadmap side), Q17d, Q21, Q23 dry run: ROADMAP/CI-ordering items; the manager owns them. A side of Q3 applied.
- Q11 "1% battery per day": replaced by the measurable CPU budget (§9), not kept alongside it.
- Q14: moot; import removed from v1 (lead decision).
- Q22 / U8 "sentence follows app language": the unlock sentence stays **English in v1** because `sentenceMatches` strips
  non-`a-z`, so a Bangla sentence would match anything; a Unicode-aware match needs a core.js change + vectors first (v1.1).
  Bangla UI explains the sentence and shows it.
- U §6 cuts (schedules, 90-day charts, loosening challenge): not cut; the logic already exists and is covered by vectors.
  Full restriction is shown under "More levels" in the picker.
- U title "Reelity: Reels & Shorts Blocker": 34 characters and uses trademarks; see O2.

## Sources

- [S1] Accessibility API policy: https://support.google.com/googleplay/android-developer/answer/10964491
- [S2] Permissions and APIs that access sensitive information (accessibility prohibitions, listing):
  https://support.google.com/googleplay/android-developer/answer/16558241
- [S3] Approved reel blocker using accessibility: https://play.google.com/store/apps/details?id=com.decafly.app
- [S4] Four "prominent disclosure" rejections, track-wide declarations:
  https://dev.to/lui61140/why-i-removed-accessibilityservice-from-my-android-app-and-finally-got-into-play-store-4i52
- [S5] Android 17 Advanced Protection and accessibility: https://thehackernews.com/2026/03/android-17-blocks-non-accessibility.html ;
  API and its permission: https://developer.android.com/privacy-and-security/advanced-protection-mode
- [S6] Restricted settings for side-loaded apps: https://support.google.com/android/answer/12623953
- [S7] Target API requirements: https://support.google.com/googleplay/android-developer/answer/11926878
- [S8] AndroidX default minSdk: https://developer.android.com/jetpack/androidx/versions
- [S9] Data safety, "collect": https://support.google.com/googleplay/android-developer/answer/10787469
- [S10] Testing requirements for new personal accounts: https://support.google.com/googleplay/android-developer/answer/14151465
- [S11] App Bundle and Play App Signing: https://developer.android.com/guide/app-bundle
- [S12] OEM background killing: https://dontkillmyapp.com/ (TECNO: https://dontkillmyapp.com/tecno)
- [S13] View ids change often: https://dev.to/vishal_pathak_209/i-reverse-engineered-youtube-to-delete-just-the-shorts-here-is-the-code-3b84
- [S14] Compose size metrics: https://developer.android.com/develop/ui/compose/migrate/compare-metrics
- [S15] Background activity starts: https://developer.android.com/guide/components/activities/background-starts
- [S16] Testing tracks (internal tests may skip policy review): https://support.google.com/googleplay/android-developer/answer/9845334
- [S17] Auto Backup and device-to-device transfer: https://developer.android.com/guide/topics/data/autobackup
- [U2][U4] and other user-test sources: see `reviews/USER-TEST.md`.
