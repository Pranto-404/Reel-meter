# QA review: Android ARCHITECTURE.md + ROADMAP.md

QA officer, 2026-11-15. Scope: both design docs, checked against `README.md`, `docs/ARCHITECTURE.md`, `src/core.js`,
`test/*.js`, `.github/workflows/*`. Policy claims re-checked on primary sources (URLs inline). Result: **4 Blocker, 13 Major,
7 Minor.** Nothing here needs code yet; every fix is a doc edit. "A" = docs/android/ARCHITECTURE.md, "R" = ROADMAP.md.

## Blocker

1. **The CI split locks `main`.** R §1 table + §2 say "keep the job name 'Unit tests and build' until the ruleset is switched".
   When `extension.yml` becomes a *reusable* workflow, GitHub names the check `<caller job> / Unit tests and build`, so the
   required check `Unit tests and build` never reports and every PR waits forever. **Fix (R §1, §2, M0 DoD):** reorder M0:
   PR-0 adds only a `CI result` gate job to today's `ci.yml` (no moves, `if: always()`, fails on `failure`/`cancelled`, treats
   `skipped` as pass); owner switches the ruleset to `CI result` + `PR title`; only then the moves PR. Before PR-0, record
   whether admin bypass is on in the ruleset (recovery path).
2. **"No edit needed" for tests is false.** R §1 row `test/*.test.js`. `test/release.test.js:97` asserts
   `docs/PUBLISHING.md` relative to the package root; after the move root = `extension/` and the doc goes to
   `docs/extension/`, so `npm test` fails. Same file reads `store/PRIVACY.md` (R moves its public copy to `site/`).
   **Fix:** add a row: "`test/release.test.js`: point the doc check at `../docs/extension/PUBLISHING.md`; keep
   `extension/store/PRIVACY.md` as the source and generate `site/` from it (test that they match)". Run `npm test` in the
   moves PR, not after.
3. **R contradicts A on what to build.** R M2 "Room database" (A §4 **Changed:** JSON files + AtomicFile); R M3 "breathing
   pause overlay" and "optional greyscale hint" (A §1 non-goal: greyscale needs `WRITE_SECURE_SETTINGS`; A §5 PauseActivity, no
   overlay permission); R M4 "Block screen overlay" (A: BlockActivity). "Overlay" invites `SYSTEM_ALERT_WINDOW`, which the
   privacy check bans. **Fix (R §3):** M2 "daily totals in JSON files (A §6)"; M3 "breathing pause screen (PauseActivity)",
   delete greyscale; M4 "full-screen block screen (BlockActivity)". Add to R header: "R must be re-synced whenever A says **Changed:**".
4. **The Play-verdict plan does not work.** A §13 "submit to internal track early (M3) to get a verdict": Google says
   "Internal tests might not be subject to standard Play policy or security reviews"
   (https://support.google.com/googleplay/android-developer/answer/9845334). A §12 has testers on Play tracks, but R §2
   issues create the Play account only in M5. And if the closed test starts on the M3 build (R §6), M4 adds Back/Home and the
   block screen, which changes the accessibility declaration and video mid-test (A §3 "ship to all tracks"). **Fix:** R §2
   move "Play account + device verification" to M0 issues; A §13 "first **closed**-track submission at end of M2 is the policy
   probe"; R §6 "closed 14-day test starts on the first build whose declaration already covers blocking (M4, blocking may be
   off by default)"; declaration/video drafted at M2, not M5.

## Major

5. **Idle cutoff never fires.** A §5 Counting: `lastInputAt` = "last scroll **or content** event" and `playing = visible`.
   Video players emit `TYPE_WINDOW_CONTENT_CHANGED` continuously (progress, counters), so a looping reel left on screen counts
   for hours; the extension stops after 120 s without touch (`core.js` ReelTracker). **Fix:** "`lastInputAt` = last
   `TYPE_VIEW_SCROLLED` on the reel pager or `TYPE_VIEW_CLICKED` in the target package; content changes never update it".
   Add tracker vector + `:fakereels` test: 5 min untouched looping reel ⇒ ≤ 120 s counted.
6. **Split screen / freeform / PiP bypass and miscount.** A §5 rules "covers 60%+ of the **screen**" and `rootInActiveWindow`.
   In split screen the reel window is ~50% (not detected ⇒ block dodged) and loses focus when the other half is tapped
   (counting stops while it plays). **Fix:** coverage relative to the app window (`AccessibilityWindowInfo.getBoundsInScreen`),
   read `getWindows()` with `flagRetrieveInteractiveWindows`, and add "split screen, freeform, PiP, notification shade
   pulled down, foldable unfold" to the M4 escape list (item 11).
7. **Block screen escapes are undesigned; no latency budget.** A §5 Blocking. Back on BlockActivity finishes it and reveals
   the reel (relaunch flicker loop); targetSdk 36 enables predictive back, so `onBackPressed` is not called; Recents can
   reselect the reel app. No target for "reel visible before block". **Fix (A §5, §9):** "Back = Leave reels (go Home) via an
   enabled `OnBackPressedCallback`"; "re-block on every `TYPE_WINDOW_STATE_CHANGED` into a blocked reel"; budget "detect→
   BlockActivity resumed p95 ≤ 500 ms on `:fakereels` (timestamps asserted in the instrumented test), ≤ 1 s and no audio
   after 1 s on the owner's phone".
8. **Background activity start is not guaranteed.** A §5 step 1 cites [S15], but the current page no longer names
   AccessibilityService; it lists "bound by a service that has been granted permission to start background activities"
   (https://developer.android.com/guide/components/activities/background-starts). **Fix:** M1 spike must test both
   BlockActivity and a **`TYPE_ACCESSIBILITY_OVERLAY` window** (allowed to accessibility services, no draw-over permission) on
   API 36 and 37; A §5 names the overlay as plan B, before Back/Home.
9. **Shared vectors prove less than claimed.** A §7. (a) JSON cannot express `undefined`, `NaN`, `Infinity`, which
   `normalizeSettings`/`clampInt` handle: add encoding `{"$undef":1}`, `{"$num":"NaN"}`. (b) `core.js` uses local `Date`
   (`nextMidnight`, `scheduleActive`, `dayKey`); `tz` per file must include `Asia/Dhaka`, `America/New_York`,
   `America/Santiago` (DST at midnight), `Australia/Lord_Howe` (30-min DST). (c) Curated inputs ≠ equivalence: add a seeded
   random generator (≥ 500 cases per fn) and a gate "vectors alone reach ≥ 95% branch coverage of `core.js`"
   (`node --test --experimental-test-coverage test/vectors.test.js`) plus "every fn Kotlin ports appears in a vector file".
   (d) Comparison rule: deep-equal, numbers by value, key order ignored. (e) `weakens` defaults to `Date.now()`: vectors must
   always pass `now`. (f) Paths: generator lives at `extension/scripts/gen-vectors.js` (no root `package.json`, R §1); CI
   filter `extension/src/core.js` must trigger **both** workflows (R §2). (g) Android-only logic (pageKey from pager
   events, elapsedRealtime waits) is outside vectors: list it in TESTING.md with its own JVM tests.
10. **Size gate measures the wrong file.** R §2/§4 "debug APK ... +10%"; A §9 "< 4 MB, fail > 6 MB". A debug APK is
    unminified and far over 6 MB, and "+10%" needs a baseline nobody stores. **Fix:** measure the release AAB with
    `bundletool build-apks` + `get-size total` (download size, arm64 device spec); baseline in `android/size-baseline.txt`,
    changed only by a PR that says why. Print, but never gate, the debug APK size.
11. **Several Definitions of Done cannot be checked.** R §3/§4. M1 "battery impact noted" and the 1%/day budget: no public
    per-app battery API, owner has no adb. ⇒ measure own CPU via `Process.getElapsedCpuTime()` per active reel-hour, shown in
    Detection health; budget "≤ 36 CPU-s per reel-hour, 0 wakeups when no target app open". M2 "within 5% of a hand count":
    add a scripted protocol (50 reels incl. 10 skips < 1 s that must **not** count, 5 loops, 5 back-swipes; minutes vs
    stopwatch ±5%) **and** a specificity check: 10 min of non-reel feed/chat/search per app ⇒ 0 reels. M4 "cannot be dodged":
    replace with an enumerated escape list (app switch, Recents, rotation, split screen, PiP, shade, deep link/share link,
    force-stop target, reboot, clock change) each pass/fail; list accepted escapes (turn service off, clear data,
    uninstall). M4 "clock-trick protection": define it (see Q2). M5/M6 "crash-free 99.5%": vitals need volume; with 15
    testers use "0 crashes/ANRs in pre-launch report and closed-test vitals", keep 99.5% for M6. Speed "macrobenchmark on
    emulator": emulator timings are not comparable; gate on regression vs previous nightly only.
12. **Backup off is incomplete.** A §1 `allowBackup=false`. Google: for targetSdk 31+ on some devices it "doesn't disable
    device-to-device transfers" (https://developer.android.com/guide/topics/data/autobackup). **Fix:** add
    `dataExtractionRules` excluding `root` in `<cloud-backup>` and `<device-transfer>` plus `fullBackupContent` for API ≤ 30;
    privacy check asserts both.
13. **Advanced Protection detection needs a permission A forbids.** A §10 checks `AdvancedProtectionManager`; it requires
    `android.permission.QUERY_ADVANCED_PROTECTION_MODE`
    (https://developer.android.com/privacy-and-security/advanced-protection-mode), which A §3's allowlist would fail. [S5] is
    press, not Google. **Fix:** either add that permission to the table with its reason, or (recommended) drop the API and
    infer "accessibility enabled in settings but service revoked/not bound" ⇒ fallback mode with a generic message.
14. **Import can unblock.** A §6 "import accepts extension exports"; the extension has **no** import, and its export is only
    `{exportedOn, stats}` (`src/ui/dashboard.js:443`), so "settings kept for import/export" has no source. Replacing today's
    stats with lower numbers clears `hardLimit` (`blockReason` → `limitOver`). **Fix:** "Import merges stats per day with
    `max()`, never touches today or settings/blockState; rejects day keys not `^\d{4}-\d{2}-\d{2}$`, files > 1 MB". Or cut
    import from v1.
15. **Security rules are implicit.** A §5/§12. Add a "Component security" list: every activity except MainActivity
    `exported=false`; no component reads intent extras that change block state (Engine trusts only in-process calls); all
    PendingIntents explicit + `FLAG_IMMUTABLE`; export via `ACTION_SEND` text or a FileProvider limited to `cache/export/`
    (never `filesDir`); corrupt or unreadable `settings.json`/`blockstate.json` restores the last good copy (`*.good`) and
    never falls back to looser defaults; `ENOSPC` keeps state in memory and retries, never crashes the service. Privacy check
    asserts the manifest part.
16. **Debug APK signature changes every CI run.** A §12 / R M1. Each runner makes a new debug key, so the next APK will not
    install over the last; the owner loses data and repeats restricted settings + accessibility. **Fix:** a committed
    debug-only keystore (`android/app/debug.keystore`, not secret) or a repo secret; `applicationIdSuffix ".debug"` so it
    coexists with the Play build.
17. **CI details that will fail on day one.** A §12 / R §2. (a) `gradlew` committed from Windows lacks the exec bit: run
    `git update-index --chmod=+x android/gradlew` in the skeleton PR and test it. (b) "wrapper generated in CI and committed"
    needs `contents: write` on `main`; generate in a `workflow_dispatch` job that uploads the files, agent commits via PR.
    (c) `run-emulator` label needs `pull_request: types: [opened, synchronize, reopened, labeled]`. (d) `PR title` workflow is
    missing from R's tree. (e) Emulator lanes 30/36 skip minSdk 26: add API 26 (and 37). (f) `setup-gradle` with
    `cache-read-only` on non-`main`. (g) A and R list different Gradle tasks; R should just point to A §12.

## Minor

18. **Name too long.** A D6 "Reel Meter: Shorts & Reels counter" = 34 chars; Play titles are max 30
    (https://support.google.com/googleplay/android-developer/answer/9898842). "Shorts" is a YouTube trademark: e.g.
    "Reel Meter: reel counter".
19. **Package lists disagree.** A §3: `<queries>` "7 package names" vs 5 in `packageNames`. List all 7 explicitly; state that
    Facebook Lite / TikTok Lite / Instagram Lite (very common in our first market) are "not supported" unless the spike says
    otherwise, and show that in-app.
20. **Disclosure copy gaps.** A §3: mention Home as well as Back; warn that Android's own dialog will say the app can "view
    and control screen" and explain why; say what is *not* covered (YouTube in Chrome, in-app browsers). Usage-access screen
    needs its own outline text.
21. **Owner M1 script.** R §5.5: "Allow restricted settings" only appears after the blocked attempt has been tried once; on
    Android 15+ usage access may also be restricted. Write the steps in that order.
22. **Typed sentence breaks with Bengali.** `sentenceMatches` strips everything except `a-z`; a translated sentence normalizes
    to "" and anything matches. A §9 `localeFilters` "bn later": keep the sentence English or port a Unicode-aware match
    (vector first).
23. **Tags.** R §0/M0 "ext-v1.3.1-style dry run" would publish a duplicate of v1.3.1: dry run on a fork or a
    `workflow_dispatch` with `--draft`. Version guard must accept `-rc.N` and check `versionCode` per R §2; say where
    `versionName` lives (`android/gradle.properties`).
24. **Crash insight.** A §12: vitals only cover users who share diagnostics. Keep the last 5 stack traces (no content) in
    `filesDir` and include them in "Copy diagnostics". Screenshots for the listing from `:fakereels`, never real third-party UI.

## Questions for the lead

1. Owner's phone: brand, model, Android version? (Decides the M1 matrix, minSdk 26 vs 28, Lite apps.)
2. May Android be **stricter** than the extension (e.g. lockouts measured with `elapsedRealtime` until reboot), or must it
   match `core.js` exactly? "Clock-trick protection" in R M4 is undefined until this is answered.
3. Can the Play account be created now (M0), so Issue 4 holds?
4. Is import needed in v1, or can we ship export-only (Issue 14)?
5. Is admin bypass currently enabled on "Protect main" (the only recovery if Issue 1 is gotten wrong)?
