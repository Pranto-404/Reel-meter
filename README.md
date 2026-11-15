<div align="center">

<img src="extension/icons/icon128.png" alt="Reelity icon" width="96" height="96">

# Reelity

**Know your scroll. Stay in control.**
Count your Shorts, Reels and TikToks, and block them when you want your time back. Everything stays on your device.

[![CI](https://github.com/Pranto-404/Reel-meter/actions/workflows/ci.yml/badge.svg)](https://github.com/Pranto-404/Reel-meter/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/Pranto-404/Reel-meter?label=release)](https://github.com/Pranto-404/Reel-meter/releases/latest)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![No network requests](https://img.shields.io/badge/network%20requests-none-2ea44f)

</div>

<p align="center">
  <img src="extension/store/screenshots/3-block-screen.png" alt="The Reelity block screen" width="760">
</p>

## Products

| | Status | Where |
|---|---|---|
| **Browser extension** for Chrome, Edge, Brave and Firefox | Released | [`extension/`](extension/README.md) · [download](https://github.com/Pranto-404/Reel-meter/releases/latest) · [changelog](extension/CHANGELOG.md) |
| **Android app** | In development (M0 skeleton) | [`android/`](android/README.md) · [roadmap](docs/android/ROADMAP.md) · [architecture](docs/android/ARCHITECTURE.md) |

Both follow the same privacy promise: no account, no analytics, no network access, nothing about what you watch is ever stored. Both will run the same counting and blocking rules, checked by shared tests.

## Repository layout

```
extension/   the browser extension (Manifest V3, plain JavaScript, no dependencies)
android/     the Android app (Kotlin and Jetpack Compose, in development)
shared/      test cases both products must pass (coming)
docs/        extension/ and android/ design notes, HANDOFF.md (project history)
.github/     CI, releases, issue and PR templates
```

## Contributing, security and license

[CONTRIBUTING.md](CONTRIBUTING.md) · report security problems privately via [SECURITY.md](SECURITY.md) · released under the [MIT License](LICENSE).

Reelity is not affiliated with, endorsed by, or sponsored by YouTube, Google, Instagram, Facebook, Meta or TikTok.
