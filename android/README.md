# Reelity for Android

The Android version of Reelity: count reels in YouTube, Instagram, TikTok and Facebook, and block them when you want
your time back. Same privacy promise as the extension: no account, no analytics, **no internet permission**.

**Status: M1 detection spike.** The release build opens one welcome screen. The **debug** build adds a test
accessibility service and a "Detection lab" to record how reel screens look (see below). Counting and blocking arrive
in milestones M2 to M4 (see the [roadmap](../docs/android/ROADMAP.md) and the
[architecture](../docs/android/ARCHITECTURE.md)).

## Layout

```
settings.gradle.kts  build.gradle.kts  gradle.properties (VERSION_NAME, VERSION_CODE)
gradle/libs.versions.toml   versions of everything (closed dependency list)
core/   pure Kotlin port of extension/src/core.js, with JUnit tests (no Android code); detect/ = Detector model
app/    the app: Jetpack Compose, Material 3, English and Bangla strings, privacy check
        src/debug/   debug build only: detection service (a11y/) and the Detection lab (lab/)
        src/release/ the release twins of debug-only entry points (empty)
```

## How it is built

Nothing is built on the owner's PC: no Java, Gradle or Android SDK is needed locally. GitHub Actions builds every
pull request and every push to `main` that touches `android/`, `shared/`, `extension/src/core.js` or `.github/`
([`android.yml`](../.github/workflows/android.yml), called from `ci.yml`). The job **"Android build"** runs:

```
./gradlew :core:test :app:testDebugUnitTest :app:lintDebug :app:privacyCheck :app:assembleDebug :app:bundleRelease
```

- `privacyCheck` reads the merged manifest of the debug and the release build and fails the build if the app asks
  for a permission (the only one allowed is AndroidX's internal signature permission), allows backups, or exports
  anything but the launcher screen and an accessibility service that only the system can bind.
- Unit tests also check that the accessibility code never calls an API that reads screen text or descriptions, that
  no networking code exists, and that every English string has a Bangla one.
- The debug APK and the release bundle (unsigned, shrunk with R8) are kept as artifacts for 14 days. The job summary
  shows their sizes.

The Gradle wrapper and the shared debug key (`app/debug.keystore`, not secret, debug builds only) are committed,
so every new debug APK installs over the previous one and keeps its data. The real upload key never goes in the
repository.

## Install the debug APK on your phone

1. Open the repository on GitHub, **Actions**, pick the latest green **CI** run, scroll to **Artifacts** and download
   **reelity-debug-apk** (a zip). Unzip it on the phone, or download it on a computer and copy `app-debug.apk` over.
2. Open `app-debug.apk`. Android asks to allow **Install unknown apps** for the app that opened it (your browser or
   file manager): allow it, go back, and tap **Install**.
3. The debug build is called Reelity and has its own id (`io.github.pranto404.reelity.debug`), so it sits next to the
   Play version later. Uninstall it from App info when you no longer need it.

## Detection test (M1): what the owner does

The goal is a file of labelled screen layouts from your phone: for each app, a few "this is a reel" and "not a reel"
moments. The file holds view ids, class names and positions only, never words, pictures or what you watch.

1. **Get the app.** On GitHub open **Actions**, the latest green run, the job **Android build**, and download the
   artifact **reelity-debug-apk**. Install `app-debug.apk` as above (allow **Install unknown apps**).
2. **Advanced Protection off.** If Settings > Security and privacy > **Advanced Protection** is on, turn it off for the
   test. With it on, Android blocks installing from a file, and Android 17 also blocks Accessibility for apps like
   this one. You can turn it back on afterwards.
3. **Open Reelity**, tap **Open detection lab**, then **Turn on detection**. Read the screen and tap
   **Agree and turn on**. Android opens Accessibility settings: tap **Reelity detection (test)** and turn it on.
4. **If Android says "Restricted setting":** go back to the lab and tap **Open App info** (or Settings > Apps >
   Reelity), tap the three dots (⋮) at the top right, choose **Allow restricted settings**, confirm, then do step 3
   again. The option only appears after Android has blocked the switch once.
5. **For each app you use** (YouTube, Instagram, TikTok, Facebook, and their Lite apps if you have them):
   - open its reels (Shorts, Reels, the For You feed). Two small buttons appear at the right edge of the screen;
     while you scroll, tap **Reel** 3 to 5 times on different reels;
   - open the normal feed, search or a profile and tap **Not a reel** 3 to 5 times on different screens.
   The lab shows how many you have per app. If the buttons get in the way, turn them off in the lab and use the
   big buttons there instead (they label the last screen seen).
6. **Send it.** In the lab tap **Export and share** and send the file (`reelity-captures-....json`) to the developer
   by email or chat. Then you can **Delete captures**, and turn the service off in Settings > Accessibility.

## Versions

`VERSION_NAME` and `VERSION_CODE` live in `gradle.properties`. The code follows
`MAJOR*1000000 + MINOR*10000 + PATCH*100 + N` (N = rc number, 99 for the final release); tags are `android-vX.Y.Z`.
The application id `io.github.pranto404.reelity` is a working id until the first Play upload confirms it.
