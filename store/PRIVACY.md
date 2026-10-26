# Reel Meter privacy policy

_Last updated: [DATE]_

Reel Meter is a browser extension that counts the short videos you watch (YouTube Shorts, Instagram Reels, TikTok and Facebook Reels) and the time you spend on them. It is built so that your data never leaves your device.

## What Reel Meter does not do

- It does not send any data to the developer, to any server, or to anyone else. It makes no network requests, and its pages are blocked from doing so by the extension's content security policy (`connect-src 'none'`).
- It has no account, no sign-in, no analytics, no advertising, no tracking and no remote code.
- It does not read or record video titles, channels, accounts, comments, messages, search terms, your browsing history, or what is on your screen. It does not take screenshots or use your camera or microphone.
- It does not run on any website other than YouTube, Instagram, TikTok and Facebook.

## What Reel Meter looks at while you browse

On those four sites only, while a page is open, the extension checks:

- whether the page is a short-video page (from the web address path, for example `/shorts/...`);
- whether a video is playing and on screen;
- whether you recently touched the page, so that it stops timing when you walk away.

If you turn blocking on, the extension can also replace a reel page with a block screen, pause and mute the videos on it, and send a YouTube Short to the ordinary watch page of the same video. This happens in your browser and uses nothing but the address and your settings.

This is processed in your browser, in memory, and discarded immediately. Individual reels, their addresses and their ids are never saved.

The counter and the block screen are drawn inside the page, so a site's own scripts could in principle notice that something was added to the page. Reel Meter sends them no information, and the extension does not make its version or your data available to page scripts.

## What Reel Meter stores, on your device only

Using the browser's local extension storage, it keeps:

- daily totals: number of reels and seconds watched, in total, per app and per hour of the day;
- your settings (limits, reminders, which apps to track, counter position, and the blocking options: which apps are blocked, schedules, when a focus timer or a break ends);
- the running state of the optional blocker: when each app’s focus timer, break or lockout ends, and the times of your recent unblocks and loosened settings (to count repeated unblocks and run a lockout). While you are waiting to unblock, the browser's short-lived session memory also holds the time you started waiting and a browser tab number; it is cleared when the browser closes;
- the date you installed it (so streaks and comparisons start from then).

Days older than 400 days are deleted automatically. This data stays in your browser profile. It is not synced by the extension; if you use browser sync, the browser's own rules apply to extension storage.

## Your control

From the extension's dashboard (Privacy & data) you can export your counts (the daily totals) as JSON or CSV at any time and delete all of them with one click. Deleting counts does not erase your settings or the blocker's running state (focus timers, breaks, unblock times); those are removed when you uninstall the extension. While the hard daily limit is on, today's count is kept, because deleting it would lift a limit that is running. You can also pause tracking (not possible while the hard daily limit is on) or turn off any app.

## Permissions

- `storage`: to keep the totals and settings above on your device.
- `alarms`: to refresh the toolbar badge at midnight.
- Access to YouTube, Instagram, TikTok and Facebook pages: to detect short-video pages and show the on-page counter.

## Children

Reel Meter does not knowingly collect any information from anyone, including children.

## Changes

If this policy changes, the updated version will be published at this address with a new date. Because the extension collects nothing, any future change that would send data off your device would be announced in the extension's listing and require your approval through the browser's permission prompt.

## Contact

[YOUR CONTACT EMAIL OR WEBSITE]

_Reel Meter is not affiliated with, endorsed by, or sponsored by YouTube, Google, Instagram, Facebook, Meta or TikTok. Those names belong to their owners and are used only to say where the extension works._
