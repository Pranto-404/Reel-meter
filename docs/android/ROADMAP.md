# Reelity: repository and Android roadmap

Written 2026-11-15 by the project manager; revised the same day after the QA review (`reviews/QA.md`) and the user-type test
(`reviews/USER-TEST.md`). Plain language, decision-first. The technical design lives in [ARCHITECTURE.md](ARCHITECTURE.md):
on technical points it wins; on order, scope and dates this file wins. **Whenever ARCHITECTURE.md says "Changed:", this file
is re-synced in the same PR.** Google Play facts were checked on the date above; see **Sources**.

## 0. Decisions in one screen

| Topic | Decision |
|---|---|
| One repository or two | **One**, with clear sections: `extension/`, `android/`, `shared/`, `site/`, `docs/`. |
| Order of M0 | Gate job and ruleset switch **first**, file moves **after** (section 1). `main` must never wait for a check that cannot run. |
| Moving files | `git mv` plus a path-fix commit in one PR, with `npm test` and the harness green **in that PR**. History stays. |
| Tags | `ext-v1.4.0` (extension), `android-v0.1.0` (app). Old tags `v1.2.3` to `v1.3.1` stay. |
| Changelogs | `extension/CHANGELOG.md` (moved) and `android/CHANGELOG.md` (new). |
| Branches and merges | Protected `main`; short branches; squash merge; Conventional Commit PR titles; owner clicks Merge. Commits stay authored by the owner (HANDOFF). |
| Releases | Manual tag + checklist + version guard in the workflow. release-please reconsidered at M6. |
| Builds | No Java or Android SDK on the owner's PC: every Android build, test and signed bundle runs in GitHub Actions. |
| Play account | **Personal** (US$25 once), created **in M0**: 12+ testers for 14 days in a closed test before production. |
| Policy check | Internal testing gets no normal policy review, so the policy probe is a **closed-track** upload at the end of M2. |
| App behaviour (from ARCHITECTURE) | Plain JSON files (no Room); full-screen BlockActivity and PauseActivity (no overlay screens, no `SYSTEM_ALERT_WINDOW`); no greyscale; no INTERNET. |
| Product scope v1 | Blocking **off** by default, offered from day 3; English **and Bangla** from the first build; JSON export and delete, **no import**. |

## 1. Repository restructure (milestone M0)

### Target tree

```
README.md              hub: what Reelity is, two product cards, privacy promise, links
LICENSE  SECURITY.md  CONTRIBUTING.md  .editorconfig  .gitattributes  .gitignore
.github/
  workflows/  ci.yml (detect changes + calls + "CI result" gate)  extension.yml  android.yml (reusable)
              pr-title.yml ("PR title")  ext-release.yml  android-release.yml  pages.yml  nightly.yml (emulator + full build)
  ISSUE_TEMPLATE/ bug_report.yml feature_request.yml config.yml (forms with a "Product" dropdown)
  PULL_REQUEST_TEMPLATE.md  CODEOWNERS  dependabot.yml  labels.yml
extension/   manifest.json package.json CHANGELOG.md README.md src/ icons/ scripts/ (incl. gen-vectors.js) test/ dev/ store/
android/     settings.gradle.kts build.gradle.kts gradle.properties (versionName, versionCode) gradlew gradle/ size-baseline.txt
             core/ (pure Kotlin rules)  app/  fakereels/ (test app, never shipped)  CHANGELOG.md  README.md  store/ (en + bn listing)
shared/test-vectors/   JSON cases generated from core.js, run by both test suites; README.md explains the format
site/        GitHub Pages: privacy policies (generated from extension/store/PRIVACY.md and android/store/PRIVACY.md), support page
docs/        README.md (index)  HANDOFF.md (project-wide)  extension/ (ARCHITECTURE.md, PUBLISHING.md)
             android/ (ARCHITECTURE.md, ROADMAP.md, TESTING.md, PLAY-PUBLISHING.md, reviews/)  decisions/ (0001-monorepo.md, ...)
```

The personal export `reel-meter-2026-10-24.json` at the root is ignored by git; the owner can move or delete it locally.

### M0 step order (each step is one PR or one owner action)

1. **Owner check:** repository-admin bypass is ON in the "Protect main" ruleset. Leave it on until step 3 is verified: it is
   the only way back if a required check never reports.
2. **PR-0, no moves:** add job **"CI result"** to today's `ci.yml` (`needs: [test, harness]`, `if: always()`, fails when any
   needed job is `failure` or `cancelled`, treats `skipped` as pass) and `pr-title.yml` (check **"PR title"**, small in-repo
   script, no third-party action). Old jobs keep their names.
3. **Owner:** switch the ruleset's required checks to **"CI result"** and **"PR title"** and remove "Unit tests and build"
   (reusable workflows rename checks to `caller / job`, so the old name would never report again). Verify with a docs-only PR.
4. **PR-1, moves:** commit 1 = only `git mv`; commit 2 = every path fix in the table below. `npm test` and
   `npm run harness` run from `extension/` and pass in this PR. Afterwards `git log --follow extension/src/core.js` shows the
   October history.
5. **PR-2, CI split:** `ci.yml` detects changes and calls `extension.yml` / `android.yml`; the "CI result" gate keeps its name.
6. **PR-3, extension release:** `ext-release.yml` on `ext-v*` tags. Dry run with `workflow_dispatch` creating a **draft**
   release (no duplicate of v1.3.1 is published).
7. **PR-4, Android skeleton:** empty Compose app (ARCHITECTURE section 4); Gradle wrapper made by a `workflow_dispatch` job
   that uploads the files, committed through this PR; `git update-index --chmod=+x android/gradlew`; a committed debug-only
   keystore and `applicationIdSuffix ".debug"`, so each CI debug APK installs over the last without losing data.
8. **PR-5, shared vectors:** `extension/scripts/gen-vectors.js`, first vector files, `extension/test/vectors.test.js`, the
   Kotlin `VectorsTest` stub.
9. **PR-6, housekeeping:** labels, issue forms, PR template, CODEOWNERS, Dependabot, root README hub, `docs/README.md`.
10. **Owner, in parallel:** create the Play developer account (section 5).

### Every root-path reference that changes in PR-1 (from a search of the repository)

| File (line) | Change |
|---|---|
| `test/release.test.js:97` | `docs/PUBLISHING.md` becomes `path.join(root, '..', 'docs', 'extension', 'PUBLISHING.md')`. Line 95 keeps `store/PRIVACY.md` (still the source); a new test checks the `site/` copy matches. |
| `.github/workflows/ci.yml:25` | Artifact `extension/dist/*.zip`; jobs get `working-directory: extension`. |
| `.github/workflows/release.yml:21,29` | Replaced by `ext-release.yml`: reads `extension/manifest.json`, compares with `refs/tags/ext-v$v`, uploads `extension/dist/*.zip`, notes from the CHANGELOG section (not `--generate-notes`, which would mix in Android commits). |
| `package.json` | Moves to `extension/`; add `"directory": "extension"` under `repository`. No root `package.json`. |
| `README.md:3,22,54-59,93,118` | Becomes the hub; images point to `extension/icons/...` and `extension/store/screenshots/...`; links to `extension/store/PRIVACY.md`, `docs/extension/*.md`, `extension/CHANGELOG.md`. Extension details move to `extension/README.md`. |
| `CONTRIBUTING.md:18,21,24` | "Load unpacked, pick the `extension` folder"; `cd extension` before npm; release steps with `ext-v` tags; Android section. |
| `SECURITY.md:16` | "See `extension/README.md`". |
| `docs/ARCHITECTURE.md` (line 56) | Moves to `docs/extension/`; link to `../HANDOFF.md`. |
| `docs/PUBLISHING.md:9-79` | Moves to `docs/extension/`; paths `store/`, `dist/`, `icons/`, `manifest.json` get the `extension/` prefix. |
| `docs/HANDOFF.md:15,20-32,88,116` | Folder map and commands (`cd extension`), link to `docs/extension/PUBLISHING.md`. |
| `store/LISTING.md:72,77-79` | Paths stay valid inside `extension/`; the policy URL line points to the `site/` page. |
| `.github/PULL_REQUEST_TEMPLATE.md:6-7` | Per-product checkboxes and paths. |
| `CHANGELOG.md` | `git mv` to `extension/CHANGELOG.md`; note "up to 1.3.1 tagged vX.Y.Z, from 1.4.0 ext-vX.Y.Z". |
| `.github/CODEOWNERS`, `dependabot.yml` | Per path; add `gradle` at `/android` (monthly, grouped). |
| `.gitattributes`, `.editorconfig` | `gradlew eol=lf`, `*.bat eol=crlf`, `*.jar binary`; 4-space Kotlin. |
| Verify only (relative paths) | `scripts/build.js`, `scripts/make-icons.js`, `test/package.test.js`, `dev/serve.js`, `dev/run-harness.js`, `dev/shots.js`, `dev/harness.html`, `dev/content-harness.html`, `src/ui/*.html` (`../../icons`), `.gitignore` (`dist/`). |

## 2. Version control and releases

**Branches.** `main` is always releasable. Names: `ext/<topic>`, `android/<topic>`, `shared/<topic>`, `repo/<topic>`; a
branch lives days, not weeks. Squash merge only, linear history, branch deleted on merge. Agents open PRs; the owner merges.
Admin bypass is for recovery only.

**PR titles** (checked by "PR title"): `feat(android): ...`, `fix(ext): ...`, `chore(repo): ...`, `docs: ...`, `ci: ...`.

**Versions and tags.**
- Extension: version in `extension/manifest.json` + `extension/package.json` (tests keep them equal); tag `ext-vX.Y.Z`.
- Android: `versionName` and `versionCode` live in `android/gradle.properties`; `0.x` until production. Tags
  `android-vX.Y.Z-rc.N` (test builds) and `android-vX.Y.Z`. `versionCode = MAJOR*1000000 + MINOR*10000 + PATCH*100 + N`
  (N = 99 for the final). The release guard accepts `-rc.N` and rejects a tag whose name or code does not match the file.
- Every release: changelog section, version PR merged, then the tag.

**CI per product.** A required check whose workflow is skipped by a path filter stays "pending" forever, so path filters
never sit on a required workflow:
- `ci.yml` runs on every PR (`types: [opened, synchronize, reopened, labeled]`) and push to `main`. "Detect changes" calls
  `extension.yml` for `extension/**` or `shared/**`, and `android.yml` for `android/**`, `shared/**` **or
  `extension/src/core.js`** (the rules reference). `.github/**` runs both. "CI result" always runs last.
- `extension.yml`: "Unit tests and build", "Real-code browser harness", vectors regenerated with no `git diff`.
- `android.yml`: the tasks in ARCHITECTURE section 12; `setup-gradle` with `cache-read-only` off `main`; size check;
  debug APK and release AAB kept 14 days.
- `nightly.yml`: emulator tests on API 26, 30, 36 and 37, full builds of both products, benchmark compared with the last
  nightly. Also on PRs labelled `run-emulator`.
- `android-release.yml` (`android-v*`): signed AAB in the **play-release** environment (owner approves each run; secrets only
  there), kept as an artifact for the owner to upload. No key file ever in the repository (CI grep for `*.jks`, `*.keystore`
  other than the debug one).

**Ruleset "Protect main" after M0:** required "CI result" and "PR title"; PR required (0 approvals, solo); linear history;
no force push or deletion; admin bypass kept for recovery.

**Labels** (`.github/labels.yml`): `product: extension`, `product: android`, `product: shared`, `area: ci`, `area: docs`,
`area: repo`, `area: policy`, `type: bug`, `type: feature`, `type: chore`, `type: security`, `priority: high`,
`needs: owner`, `status: blocked`, `run-emulator`, `lang: bn`, `dependencies`.

**Milestones:** `M0 Repo restructure`, `M1 Detection spike`, `M2 MVP counting`, `M3 Limits and nudges`, `M4 Blocking`,
`M5 Play readiness`, `M6 Production`, `Extension 1.4.0 (store listings)`.

**Issues to open now:** M0: confirm admin bypass (`needs: owner`); PR-0 gate + PR title; ruleset switch (`needs: owner`);
moves PR; CI split; ext release on `ext-v`; Android skeleton + debug key; vectors generator; housekeeping; **Play account +
device verification** (`needs: owner`); package name and title (`needs: owner`). M1: spike service; BlockActivity vs
accessibility-overlay start test; detection debug screen; phone matrix report (`needs: owner`). M2: Bangla strings
(`lang: bn`, `needs: owner`); declaration text + video script draft (`area: policy`). Later milestones get issues when they start.

## 3. Android milestones

Effort is agent working time; calendar time is longer (phone round trips, Play waits). Owner tasks are in section 5.

| # | Goal and deliverables | Definition of Done (all measurable) | Effort |
|---|---|---|---|
| **M0** | Steps 1-10 above. | Ruleset requires "CI result" + "PR title" and a docs-only PR merges; `npm test` and harness pass from `extension/`; `git log --follow extension/src/core.js` lists the October commits; Android CI green, debug APK N+1 installs over N; 10+ vector cases, no diff on regeneration; draft release created by dispatch; Play account created. | 3-4 days |
| **M1** | Detection spike: usage-access time per app; ReelService limited to target packages, ids only, never text; debug screen with "copy report"; starts BlockActivity **and**, as plan B only, a `TYPE_ACCESSIBILITY_OVERLAY` window (no `SYSTEM_ALERT_WINDOW`) on API 36 and 37; settings-highlight deep link; CPU time per reel-hour. **Phones:** owner's phone plus TECNO/Infinix/itel, Xiaomi and Samsung. **Apps:** YouTube, Instagram, TikTok, Facebook, plus Facebook Lite, Instagram Lite, TikTok Lite. | Matrix (phone x app) filled with detected yes/no; per supported app 19 of 20 swipes detected and 0 reels in 5 min of non-reel screens; node trees (ids only) committed as test data; detect-to-block-screen time measured (p95) per phone; CPU seconds per reel-hour recorded; Lite apps marked supported or "app time only". | 1-2 weeks |
| **M2** | MVP: JSON-file store (AtomicFile), ported tracker (idle = no scroll or tap for 120 s; content changes never count as input), dashboard (today, 7, 30 days, per app), **6-screen onboarding** (USER-TEST section 3: language, apps, disclosure, **brand settings guide**, done, optional goal), per-brand battery guides (Xiaomi, Samsung, TECNO, Infinix, itel, Oppo/realme, vivo, Walton, Symphony), Detection health with usage cross-check, "Reel #1 counted" notice, JSON export and delete (**no import**), English + Bangla string resources, backup off (`dataExtractionRules` + `fullBackupContent`), component-security rules (ARCHITECTURE), last 5 crash traces in "Copy diagnostics". Draft declaration text and video script. **Policy probe:** first closed-track upload (owner only as tester). | Hand-count protocol per app (50 reels incl. 10 skips under 1 s, 5 loops, 5 back-swipes): skips count 0, total within 5%, minutes within 5% of a stopwatch; 10 min non-reel use = 0 reels; untouched looping reel 5 min = 120 s or less; vectors reach 95%+ branch coverage of `core.js`; release download under 4 MB; 36 CPU-s or less per reel-hour and 0 wake-ups with no target app open; TalkBack run of all 6 onboarding screens at 200% font on 360x640 dp with no hidden button; 0 missing `bn` strings (lint error); privacy check passes; probe build accepted or every rejection reason has an issue. | 3-4 weeks |
| **M3** | Limits and nudges: daily limits (reels and/or minutes), 80% heads-up, every-N reminder, breathing pause screen (PauseActivity), one silent notification channel. No greyscale. | All `evaluateLimits`/`decideNudge` vectors pass; instrumented test: at most 1 notification per nudge type per limit per day; channel silent by default; pause screen dismissable in 1 tap and read correctly by TalkBack. | 1-2 weeks |
| **M4** | Blocking with the three levels, **off by default**, offered from day 3 with the user's own numbers; BlockActivity (Back = Leave reels via an enabled `OnBackPressedCallback`, re-block on every window change into a blocked reel, Back/Home fallback); waits on `elapsedRealtime`; 5-minute per-app breaks, strikes, lockouts shown as clock times, focus timers; sentence field without autocorrect or paste, English sentence (a Bangla sentence only after a Unicode-aware match is ported, vector first). Declaration text and video **updated to cover blocking**. | All block vectors pass; escape list, each pass/fail on 2 phones: app switch, Recents, rotation, split screen, freeform, PiP, notification shade, deep or share link, force-stop of the target app, reboot, clock change, foldable unfold. Accepted escapes, said in the app: turning the service off, clearing data, uninstalling. Detect-to-block p95 500 ms or less on `:fakereels`, 1 s or less and no audio after 1 s on the owner's phone; Full restriction cannot be loosened (vector + UI test). | 2-3 weeks |
| **M5** | Play readiness: the **M4 build** (declaration already covers blocking) goes to every active track and starts the 14-day closed test; privacy policy on `site/`; Data safety; listing in English and Bangla, title 30 characters or less; screenshots from `:fakereels` only; signed AAB, target API 36. | 12+ testers (aim 15-20, mixed brands incl. TECNO/Infinix) opted in 14 consecutive days; 0 crashes and 0 ANRs in the pre-launch report and closed-test vitals; 0 policy warnings in Play Console; production questions answered. | 1 week + 14 days + review |
| **M6** | Production: staged 20%, then 100% after 7 days with no new crash cluster; monthly dependency update, yearly target-API bump. | Crash-free users 99.5%+ and ANR under Play's bad-behaviour threshold over 28 days; a release costs the owner under 1 hour. | ~1 day/month |

## 4. Quality gates ("extremely perfect", made concrete)

Every PR: "CI result" and "PR title" green; template ticked; no new permission without a decision record; no network code
(the privacy check fails on INTERNET, HTTP clients, `SYSTEM_ALERT_WINDOW`); new logic has tests; user-visible change has a
changelog line and both `en` and `bn` strings.

| Gate | Target | How |
|---|---|---|
| Same rules as the extension | Every shared vector passes; vectors alone give 95%+ branch coverage of `core.js`; every ported function appears in a vector file | Both CIs |
| Unit tests | 90%+ line coverage in `:core` | CI |
| Size | **Release** download under 4 MB; fail above 6 MB or 10% above `android/size-baseline.txt` (changed only by a PR that says why) | `bundletool build-apks` + `get-size total` on the R8 release AAB, arm64 spec; debug APK size printed, never gated |
| Battery / CPU | 36 CPU-s or less per reel-hour; 0 timers and 0 wake-ups with no target app open | `Process.getElapsedCpuTime()` in Detection health; owner reads it after M1, M2, M4 |
| Speed | Cold start under 500 ms on the owner's phone; no regression against the previous nightly | Nightly benchmark (emulator numbers only compared with each other) |
| Accessibility | TalkBack labels everywhere, 48 dp targets, 200% font on 360x640 dp, 4.5:1 contrast in light and dark | Compose UI tests + lint; owner runs Accessibility Scanner each milestone |
| Language | 0 missing `bn` strings; Bangla digits through locale formatting | Lint `MissingTranslation` as error |
| Stability | M5: 0 crashes/ANRs in pre-launch and closed test. M6: 99.5%+ crash-free | Play Console |
| Privacy and security | Permission allowlist; backup rules; components not exported except MainActivity; immutable PendingIntents | Privacy check task + review |

**Release checklist (QA officer):** version and changelog match the tag; fresh install and upgrade both work; permission
flows (grant, deny, revoke later, restricted settings) tested; disclosure shown before any accessibility use; export and
delete work; all tracks carry the same declared build; screenshots match the app.

**Roles.** **Manager:** roadmap, issues, milestones, PR order, release coordination, plain-language reports. **Architect:**
ARCHITECTURE.md, decision records, review of structure, permissions and data; signs off M0, M1, M4. **QA officer:**
`docs/android/TESTING.md`, CI gates and budgets, release checklist; can stop a release. **User-tester:** the owner and the
closed-test group, scripted sessions reported through issue forms. **Owner:** decides, merges, does section 5.

## 5. Owner checklist (in this order)

1. **Answer the open questions** (end of this file), including a contact email you will keep for years.
2. **Confirm admin bypass is ON**, merge PR-0, then switch the required checks (the manager gives click-by-click steps).
3. **Create the Google Play developer account now** (personal): US$25 once, government ID and a card in your legal name,
   verify your Android device with the Play Console app. Verification can take days.
4. **Arrange M1 phones:** yours plus borrowed TECNO/Infinix/itel, Xiaomi and Samsung phones (an hour each is enough).
5. **M1 install, in this order:** download the debug APK from the CI page; allow "Install unknown apps" for the browser;
   try to turn on Reelity in Accessibility once (Android blocks it); then App info > menu > **Allow restricted settings**;
   turn it on; do the same for Usage access if Android blocks it too; run the script; send the report.
6. **Check the Bangla strings** (about 250) during M2.
7. **Recruit 15-20 testers** by the end of M3 (Google accounts, Android phones, several brands) in a Google Group.
8. **Create the upload key** before M4 ends (portable Java kit unzipped to D:, guided), keep two offline copies and the
   password in a password manager, add it to the `play-release` environment; turn on Play App Signing.
9. **Turn on GitHub Pages** for `site/` and fill the contact email in both privacy policies.
10. **Fill the Play Console forms** (privacy policy, no ads, content rating, target audience 18+, Data safety, accessibility
    declaration + video, any wellbeing question Play shows) and record the video from the script.
11. **Run the 14-day closed test** on the M4 build, then answer the production questions.
12. **Press production rollout** (staged), then read reviews and Android vitals weekly.

## 6. Top risks

| Risk | Mitigation |
|---|---|
| **Play rejects the AccessibilityService use** (only real accessibility tools may set `isAccessibilityTool`; everyone else needs in-app disclosure, consent, a declaration and a video; monitoring apps are named as non-tools) | Not an accessibility tool; disclosure before settings, separate from other notices, "Not now" keeps the app usable; packages limited; ids not text; only Back/Home and our own screen, rule-based. **Closed-track probe at M2**, because internal testing gets no normal policy review. Declaration and video cover blocking before the 14-day test starts; every track carries the same declared build. Fallback: app time only. |
| **The 14-day test fails or restarts** (fewer than 12 testers, or a declaration change mid-test) | Recruit 15-20 early; start only on the M4 build; weekly reminder; tester sheet. |
| **Phones kill the service; apps change screens** (TECNO/Infinix/itel are top sellers in the first market) | Those brands in M1 and the closed test; per-brand guides; Detection health cross-check with usage; rules as data with recorded-tree tests; monthly check. |
| Restructure locks `main` | Gate and ruleset switch before any move; admin bypass kept on; docs-only PR proves it. |
| First strict block drives users away | Blocking off by default, offered on day 3, rule shown in one sentence, lock end as a clock time. |
| Lost upload key or leaked secrets | Play App Signing (upload key can be reset); secrets only in the approved environment; two offline copies. |
| Side-loading rules tighten (developer verification, global from 2027) | After M1, all phone testing through Play closed tracks. |
| Scope creep | Release-size and CPU gates; new libraries need a decision record; cuts from USER-TEST section 6 kept. |

## Open owner decisions

1. Your phone's brand, model and Android version, and which borrowed phones (TECNO/Infinix/itel, Xiaomi, Samsung) you can get.
2. Permanent package name (`io.github.pranto404.reelity` proposed) and a Play title of 30 characters or less.
3. May Android be stricter than the extension against clock tricks (waits and lockouts measured on the phone's uptime clock)?
4. Default level when blocking is first turned on: Less restriction for the first week (recommended) or Restricted?
5. Who translates the Bangla strings: you, or a translator you trust (the agents draft, a native speaker checks)?

## Sources

- Testing requirements for new personal accounts (12 testers, 14 consecutive days): https://support.google.com/googleplay/android-developer/answer/14151465
- Registration fee (US$25), ID and card, Android device verification: https://support.google.com/googleplay/android-developer/answer/6112435
- Testing tracks (internal up to 100 testers and may skip standard policy review; closed; open): https://support.google.com/googleplay/android-developer/answer/9845334
- Accessibility API policy (isAccessibilityTool, prominent disclosure, declaration, video): https://support.google.com/googleplay/android-developer/answer/10964491
- Target API level (API 36 from 31 Aug 2026): https://support.google.com/googleplay/android-developer/answer/11926878
- Android developer verification timeline (regional Sept 2026, global 2027): https://developer.android.com/developer-verification/guides
- Skipped-but-required checks with path filters: https://docs.github.com/en/enterprise-server@3.16/pull-requests/collaborating-with-pull-requests/collaborating-on-repositories-with-code-quality-features/troubleshooting-required-status-checks
- release-please monorepo (component tags, per-package changelogs): https://github.com/googleapis/release-please/blob/main/docs/manifest-releaser.md
- Play title limit (30 characters): https://support.google.com/googleplay/android-developer/answer/9898842
