# Reelity for Android

The Android version of Reelity: count reels in YouTube, Instagram, TikTok and Facebook, and block them when you want
your time back. Same privacy promise as the extension: no account, no analytics, **no internet permission**.

**Status: M0 skeleton.** The app opens one welcome screen. Counting and blocking arrive in milestones M1 to M4
(see the [roadmap](../docs/android/ROADMAP.md) and the [architecture](../docs/android/ARCHITECTURE.md)).

## Layout

```
settings.gradle.kts  build.gradle.kts  gradle.properties (VERSION_NAME, VERSION_CODE)
gradle/libs.versions.toml   versions of everything (closed dependency list)
core/   pure Kotlin port of extension/src/core.js, with JUnit tests (no Android code)
app/    the app: Jetpack Compose, Material 3, English and Bangla strings, privacy check
```

## How it is built

Nothing is built on the owner's PC: no Java, Gradle or Android SDK is needed locally. GitHub Actions builds every
pull request and every push to `main` that touches `android/`, `shared/`, `extension/src/core.js` or `.github/`
([`android.yml`](../.github/workflows/android.yml), called from `ci.yml`). The job **"Android build"** runs:

```
./gradlew :core:test :app:testDebugUnitTest :app:lintDebug :app:privacyCheck :app:assembleDebug :app:bundleRelease
```

- `privacyCheck` reads the merged release manifest and fails the build if the app asks for a permission (the only one
  allowed is AndroidX's internal signature permission), allows backups, or exports anything but the launcher screen.
- The debug APK and the release bundle (unsigned, shrunk with R8) are kept as artifacts for 14 days. The job summary
  shows their sizes.

### Files CI generates until they are committed

The Gradle wrapper (`gradlew`, `gradlew.bat`, `gradle/wrapper/`) and the shared debug key (`app/debug.keystore`) are
binary or generated, so CI creates them while they are missing and uploads them as the artifact
**android-files-to-commit**. To commit them: download the artifact from any Android run, unzip it into `android/`
(it keeps the folder layout), then

```bash
git add android/gradlew android/gradlew.bat android/gradle/wrapper android/app/debug.keystore
git update-index --chmod=+x android/gradlew
```

and remove the two "not committed yet" steps from `android.yml` (see the TODO comments there). The debug key is not
secret: it only signs debug builds, so every new debug APK installs over the previous one and keeps its data. The
real upload key never goes in the repository.

## Install the debug APK on your phone

1. Open the repository on GitHub, **Actions**, pick the latest green **CI** run, scroll to **Artifacts** and download
   **reelity-debug-apk** (a zip). Unzip it on the phone, or download it on a computer and copy `app-debug.apk` over.
2. Open `app-debug.apk`. Android asks to allow **Install unknown apps** for the app that opened it (your browser or
   file manager): allow it, go back, and tap **Install**.
3. The debug build is called Reelity and has its own id (`io.github.pranto404.reelity.debug`), so it sits next to the
   Play version later. Uninstall it from App info when you no longer need it.

## Versions

`VERSION_NAME` and `VERSION_CODE` live in `gradle.properties`. The code follows
`MAJOR*1000000 + MINOR*10000 + PATCH*100 + N` (N = rc number, 99 for the final release); tags are `android-vX.Y.Z`.
The application id `io.github.pranto404.reelity` is a working id until the first Play upload confirms it.
