# Changelog

All notable changes to Reel Meter. Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions follow [Semantic Versioning](https://semver.org/).

## [1.3.0] - 2026-10-28
### Changed
- New look and motion for the block screen: drifting aurora background, glass card, breathing lock, staggered entrance, ripple on buttons.
- The unblock challenge is livelier: a glowing countdown ring with a small burst when the wait ends, each correct letter of the sentence lights up, a slip shakes the box softly, and the Unblock button fills as you type and turns green when ready.
- Softer glows, springier buttons and calmer entrances on the counter island, popup and dashboard. Reduced-motion settings are respected everywhere.
- The redundant "Never mind" button is gone. Press Esc (or the small cross) to fold the unblock steps away and stay blocked.

### Fixed
- After the extension was updated or reloaded, a page with blocking set up kept showing reels once a break ended. It now keeps enforcing the last known blocks and asks for a reload.
- Greyscale-over-limit could stay on after the limit was raised, counts were deleted or the day changed.
- With a hard daily limit, a second tab could play a few seconds of reels after another tab used the limit up.
- "I am done for now" on TikTok sent you back to the reel feed.
- A confirmed loosening could overwrite settings changed during the wait (for example a pause). Only the fields you changed are applied now.
- A number just typed in the dashboard could occasionally be replaced by the old value.

## [1.2.4] - 2026-10-27
### Fixed
- In a very narrow window, or with a wider system font, the paused counter let the Resume button stick out past its edge. Spacing is now tighter on narrow windows.

## [1.2.3] - 2026-10-27
### Added
- The background worker logs each unblock request and its answer to its own console, to make support easier.

## [1.2.2] - 2026-10-27
### Changed
- A failed unblock now says which version ran and what went wrong, for example "(v1.2.2: ...)".

## [1.2.1] - 2026-10-27
### Fixed
- "I need to continue" failed with "Something went wrong" when the browser's session storage held leftover data of an unexpected shape. Such data is now ignored.

## [1.2.0] - 2026-10-26
### Added
- Three restriction levels: Less restriction, Restricted (default) and Full restriction, with different waits, sentences, unblock limits and lockouts.
- Lockout: on Restricted, 3 unblocks within 3 hours lock that app for 6 hours.
- Loosening a running block now needs the same challenge, checked by the background worker (never allowed on Full restriction or during a lockout).
- Extension pages run under a strict content security policy; the test harness loads the dashboard and popup under it.
- Facebook language sub-domains and `m.tiktok.com` are matched.

### Changed
- Blocking, breaks, focus timers and unblock counts are all per app. Unblocking Facebook no longer unblocks YouTube.
- A break is 5 minutes at every level, and the counter offers "Block now" during a break.
- Unblock waits are timed by the background worker, not by the page.

### Security
- With a hard daily limit on, pausing, switching an app off and deleting today's count no longer lift it.
- Hand-edited or clock-tampered saved state is clamped; prototype-pollution keys are ignored.
- Videos stay stopped behind the block screen (play and volume changes are caught, fullscreen is exited).
- A reload or update of the extension keeps a running block on screen.
- The page can no longer read the installed version from the counter element.

## [1.1.0]
### Added
- Reel blocker: block per app, hard daily limit, schedules, focus timer, YouTube Shorts opened as normal videos.

## [1.0.1]
### Fixed
- Pausing shows "Resume" on the counter.
- The counter stays at the top middle after a page refresh.

## [1.0.0]
### Added
- Counts Shorts, Reels and TikToks and the time spent on them, on-device only. Counter island, popup and dashboard.

[1.3.0]: https://github.com/Pranto-404/Reel-meter/releases/tag/v1.3.0
[1.2.4]: https://github.com/Pranto-404/Reel-meter/releases/tag/v1.2.4
[1.2.3]: https://github.com/Pranto-404/Reel-meter/releases/tag/v1.2.3
[1.2.2]: https://github.com/Pranto-404/Reel-meter/releases/tag/v1.2.2
[1.2.1]: https://github.com/Pranto-404/Reel-meter/releases/tag/v1.2.1
[1.2.0]: https://github.com/Pranto-404/Reel-meter/releases/tag/v1.2.0
