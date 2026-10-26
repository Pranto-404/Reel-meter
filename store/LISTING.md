# Store listing: copy and paste

## Name
Reel Meter

## Short description (max 132 characters; this is also `description` in the manifest)
Counts and limits the Shorts, Reels and TikToks you watch, and can block them. Everything stays on your device.

## Category
Productivity (Edge: Productivity; Firefox: Other or Social & Communication)

## Detailed description

Reel Meter shows you how much short-form video you actually watch, helps you cut down, and can block reels when you want a break.

Open a Short, Reel or TikTok and a small island at the top of the video counts up as you go: how many reels, and for how long. Tap it for today's total, your daily limit and a pause button. The popup and dashboard show your day, your week, which app takes the most time, and when you scroll the most.

WHAT YOU GET
• Live counter on the video: a small, animated island you can tap, drag, or hide
• Counts reels and time for YouTube Shorts, Instagram Reels, TikTok and Facebook Reels
• Today, 7, 30 and 90 day charts, a split by app, and a weekday-by-hour map of when you scroll
• Optional daily limits in reels and minutes, with a heads-up at 80%
• Gentle reminders after many reels in a row
• Optional 10 second breathing pause when you reach a limit (you decide whether to keep going)
• Pause tracking for 15 minutes, an hour, or the rest of the day
• Export your counts as JSON or CSV, or delete them with one click
• Light and dark mode

BLOCK REELS (OPTIONAL)
• Block reels per app (YouTube Shorts, Instagram Reels, TikTok, Facebook Reels). Every app is separate: unblocking one never unblocks another
• Focus timer: block the app you are on for 30 minutes with one tap, or choose several apps in the dashboard
• Schedules: block at set hours or days, including overnight
• Hard daily limit: once you reach your limit, reels stay blocked until midnight
• Open YouTube Shorts as normal videos, without the swipe feed
• Three restriction levels: Less restriction, Restricted and Full restriction. They set how long the wait is, how the sentence reads, and how fast repeated unblocking locks an app
• A calm block screen instead of the reel. Getting past it takes a wait and typing a sentence, which opens a 5 minute break for that app only. A "Block now" button on the counter ends the break early
• Unblocking too often locks that app for hours (Restricted: 3 unblocks within 3 hours, then 6 hours), and a running block cannot be loosened during a lock
• It is a self-control tool: anyone can still switch the extension off in the browser

PRIVATE BY DESIGN
• Everything stays on your device. No account, no analytics, no ads, no servers.
• It does not read your screen, video titles, accounts, comments or messages, and it never records which reels you watched.
• It sends nothing anywhere: the extension's pages are blocked from making network requests.
• Only two permissions (storage and alarms), and it runs only on YouTube, Instagram, TikTok and Facebook.
• You can check all of this in the dashboard's Privacy & data section.

HOW COUNTING WORKS
A reel counts after it has played for 2 seconds. Time counts only while a video is on screen and playing in a visible tab, and stops when you have not touched the page for 2 minutes. A reel that loops is counted once. The rules can be changed in settings.

Reel Meter is not affiliated with YouTube, Google, Instagram, Facebook, Meta or TikTok.

## Single purpose (Chrome Web Store, Privacy practices tab)
Help the user manage short-form video on YouTube, Instagram, TikTok and Facebook: count the videos watched and the time spent, show those totals, and optionally limit or block them.

## Permission justifications

| Permission | Justification to paste |
|---|---|
| storage | Saves the user's daily totals (reels and seconds watched) and settings on their own device. Nothing is sent anywhere. |
| alarms | Refreshes the toolbar badge shortly after midnight so it shows the new day's count. |
| Host access (content script matches) on youtube.com, instagram.com, tiktok.com, facebook.com | Needed to detect that a short-video page is open and that a video is playing, and to show the on-page counter. The script reads only the page address path, whether a video is playing and visible, and whether the user recently touched the page. If the user turns blocking on, it also replaces a reel page with a block screen, pauses and mutes its videos, and can send a YouTube Short to the ordinary watch page of the same video (it only uses the video id already in the address). It does not read page text or content and is not injected on any other site. |

## Remote code
No, I am not using remote code. (All code is in the package; Manifest V3.)

## Data usage disclosures
The extension does not transmit or sell any user data, and it does not store the content or addresses of what the user watches. It stores only daily totals locally. Answer the dashboard questions truthfully in the form; check Google's current definition of "collects" there. Tick the three certifications (no selling, no unrelated use, no creditworthiness use).

Firefox: the manifest already declares `data_collection_permissions: { required: ["none"] }`.

## Privacy policy URL
Host `store/PRIVACY.md` (as a web page) anywhere public (for example GitHub Pages, or a page on your own site) and paste that link. Fill in the date and contact email first.

## Images
| Asset | Size | Where |
|---|---|---|
| Extension icon | 128x128 PNG | already in the package (`icons/icon128.png`) |
| Screenshots (1 to 5) | 1280x800 (or 640x400), PNG or JPEG, no padding | `store/screenshots/` (the five that are uploaded); `store/screenshots/spare/` holds extra ones |
| Small promo tile (optional but recommended) | 440x280 | `store/promo/` |
| Marquee promo (optional, needed for featuring) | 1400x560 | not made |

Use only screenshots of the extension's own pages with sample data. Avoid screenshots of real videos from YouTube, Instagram, TikTok or Facebook (third-party content and logos).
