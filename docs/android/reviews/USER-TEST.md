# Reel Meter for Android: user-type test of the plan

Written 2026-11-15 by the user-type tester. This is a walk-through **of the design docs**, not a test with real people: three
personas go through ARCHITECTURE.md and ROADMAP.md step by step. Nothing in those files was changed. Sources [U1]... at the end.

**Personas.** **Riya, 19**: student, Redmi/Galaxy A phone, opens Reels and TikTok dozens of times a day, distrusts scary
permissions, quick to uninstall. **Karim, 34**: parent, old 2 GB phone with little free storage and a weak battery, loses time
on YouTube Shorts and **Facebook Lite** videos, reads Bangla more easily than English. **Nadia, 27**: privacy-minded
professional on a Pixel, reads every prompt and the Data safety label, may use Advanced Protection.

## 1. Top friction points, ordered by how many users they would lose

| # | Where | What happens (who) | Concrete fix |
|---|---|---|---|
| 1 | Trip into Accessibility settings | Deep link opens the **main** Accessibility list. The user must find "Downloaded apps" (Pixel, Xiaomi) or "Installed apps" (Samsung), tap Reel Meter, flip the toggle, then accept Android's dialog **"Allow Reel Meter to have full control of your device?"** with "View and control screen". Xiaomi adds its own warning (often with a countdown; confirm in M1); newer Android shows an extra "shortcut" toggle that must stay off [U1]. That is 4-6 taps plus one frightening dialog. Riya stops at "full control"; Karim gets lost in the list and never comes back. | (a) Before leaving the app, a **brand-specific 3-step card** (from `Build.MANUFACTURER`): "Tap **Downloaded apps** > **Reel Meter** > turn on > **Allow**", with a drawn illustration. (b) **Warn about the system dialog in our own words first** (see disclosure text). (c) Try the settings "highlight" extra (`:settings:fragment_args_key`) in the M1 spike so the row is highlighted where supported. (d) When the service connects, bring the user straight back to a "Done!" screen (needs a policy check, Q2). (e) If they come back without enabling it: one calm "Stuck? Here is where to tap" screen with a 10-second clip, then "Use app time only instead"; never a second nag in the same session. |
| 2 | Days 1-7: silent stop | Xiaomi, Samsung and especially **TECNO/Infinix/itel** (the top-selling brands in Bangladesh, [U4]) freeze background work; accessibility can look "on" in Settings while the service is dead [U2][U3][U5]. Counts quietly stop, the user thinks the app is broken and leaves a 1-star review. Transsion phones are **not in the planned tester matrix**. | Cross-check with Usage access: "You used Instagram for 40 min today but Reel Meter saw no reels. Your phone's battery saver probably stopped it. **Fix it (2 taps)**." Show this on the dashboard and as one notification per day at most. Ship per-brand guides for Xiaomi, Samsung, TECNO, Infinix, itel, Oppo/realme, vivo, Walton, Symphony (dontkillmyapp steps, rewritten short). Add Transsion phones to M1 and the closed test. |
| 3 | First strict block or first lockout | Riya meets a 30-second wait, a sentence and, after the third unblock, a **6-hour lock** during her bus ride. She uninstalls in anger, and that is the end of the habit change. | Blocking **off** during onboarding; offer it from day 3 with her own numbers ("You opened Reels 41 times yesterday. Want a stop screen after 60 reels?"). Default level on Android = **Less restriction** for the first week (or ask, Q5). Before saving, show the rule in one sentence: "If you unblock 3 times in 3 hours, Instagram reels lock until about **9:40 pm**." Always show lock end as a clock time. |
| 4 | The first day is invisible | There is no live counter in v1 (D5). Riya scrolls for an hour, nothing happens, she wonders if it works. This "dead app" feeling is how trackers get uninstalled. | (a) A one-time **"Reel #1 counted on Instagram ✓"** notification, which proves the setup worked. (b) An optional silent notification "Today: 34 reels · 21 min", updated only when she **leaves** a reel screen (no FGS, almost no battery cost). (c) The dashboard says "Last reel noticed: TikTok, 3 min ago". |
| 5 | Store page + Data safety | Nadia sees "Accessibility" in the description and thinks "keylogger". "No data collected" is common and she does not trust it. Riya skims and sees only "permissions". | Line 1 of the listing: "**No internet permission.** Reel Meter cannot send anything: check *App permissions* at the bottom of this page." Line 2 explains Accessibility in 20 words. Screenshot 2 is the privacy screen. Link to the open-source code and the CI privacy test. |
| 6 | Two settings trips in onboarding | Usage access is a second trip with another unfamiliar list. Every extra trip loses more users. | **Do not ask for Usage access during onboarding** unless Accessibility was refused (it is then the fallback). Otherwise offer it later on a dashboard card: "See how long you spent in each app yesterday? (1 step)". |
| 7 | Facebook Lite / Instagram Lite | Karim's Facebook is **Lite** (very common on 2 GB phones). The plan treats Lite as "only if the spike finds reel screens". If he ticks Facebook and nothing counts, he leaves. | Spike FB Lite and IG Lite in M1. If they are not supported, the app picker says so honestly: "Facebook Lite: app time only". |
| 8 | Typing the sentence on a phone | Autocorrect "fixes" words, the keyboard covers the sentence at large font sizes, and a Bangla user may have no Bangla keyboard (or only English). | Sentence of at most 6-8 words; turn suggestions and autocorrect off for the field; block paste; keep the sentence pinned above the keyboard; case and extra spaces do not matter; the sentence language follows the app language, with "type it in English instead". |
| 9 | Store search | People search for "reels blocker" / "shorts blocker", not "counter" (see competitor names [U6][U7]). | Title: "Reel Meter: Reels & Shorts Blocker" (check it against the trademark rules in the metadata policy); "counter" goes in the short description. |
| 10 | Advanced Protection (Android 17) | Nadia is the user most likely to have it on, which revokes our service [ARCH S5]. | The planned message is fine; also put it in the FAQ and in the listing's "Works best when" section. |

## 2. Persona walk-through, stage by stage (what scares, annoys, delights)

| Stage | Riya (student) | Karim (parent, old phone) | Nadia (privacy) |
|---|---|---|---|
| Listing | Wants proof it blocks Reels **inside** Instagram; screenshot 1 should show the stop screen | Size matters: say "under 4 MB, no background service" | Reads Data safety and permissions; **no INTERNET** is our best selling point |
| Install / open | Fine | Fine; a cold start under 500 ms matters on his phone | Looks for an account wall; "No account" on screen 1 reassures her |
| Disclosure | Skims; "full control" in the next dialog is the real risk | Long English text = gives up; needs Bangla | Reads all of it; **"internal names of screen parts"** (architect's draft) sounds like jargon hiding something: use "which screen is open" |
| Settings trip | 4-6 taps; may quit at the warning | Gets lost; needs the brand card | Completes it, but checks that it is limited to the 4 apps |
| First day | "Is it working?" (fix 4) | Never opens the dashboard; one evening recap would help | Checks "Copy diagnostics" for content; likes that it shows ids only |
| Limit hit | 80% nudge good; breathing pause OK once a day, annoying more often | Notification sound at night annoys: keep the channel silent by default | Fine |
| Block screen | Calm design is good; must be quick to leave ("Leave reels" big, first) | Large fonts: wait ring + sentence + keyboard must fit on a 5" 720p screen | Wants clear wording that it only "goes Back" |
| Unblock / lockout | Strikes and lock feel like punishment unless explained (fix 3) | Rarely unblocks | Fine; likes the honest "you can turn me off in Settings" |
| Focus timer | Wants it **one tap from the notification shade** | Rarely uses it | Uses schedules for work hours |
| Reboot | Works (the system rebinds the service), but should be checked on Xiaomi/TECNO with autostart off | Same | Same |
| Battery saver kills it | Fix 2 | Ultra/Super saver is on most of the day: the guide must cover "Power Marathon"/Ultra saver | Pixel: rarely affected |
| Uninstall | Rage uninstall after a lockout (fix 3) | Uninstalls for storage: keep it small | Wants to know data is gone: say "Uninstalling deletes everything. No copy exists anywhere else." |

## 3. Proposed onboarding (6 screens at most)

1. **Welcome.** Language chips at the top (**English | বাংলা**). "Count your reels. Stop when you want." Three lines: "Counts Shorts, Reels and TikToks" · "Optional stop screen" · "No account. No internet. Everything stays on this phone." Button **Start**.
2. **Pick apps.** Installed target apps with their icons, all ticked. Lite apps are labelled honestly. Button **Next**.
3. **Disclosure** (standalone, scrollable, both buttons always visible, Back = Not now). Exact text:
   > **Let Reel Meter notice when a reel is open**
   > To count reels, and to stop them when you ask it to, Reel Meter uses an Android feature called **Accessibility**.
   > **What it checks:** only inside YouTube, Instagram, TikTok and Facebook, and only *which screen* is open, for example "the reels player".
   > **What it never reads:** words on the screen, messages, comments, captions, passwords, anything you type, who you follow or which videos you watch. It does not record your screen.
   > **What it does:** counts reels and minutes. If you turn on blocking, it shows Reel Meter's stop screen or goes Back for you. Nothing else.
   > **Where your data goes:** nowhere. Only daily totals are kept on this phone. Reel Meter has no internet permission, so it cannot send anything.
   > **Heads-up:** Android will then ask whether Reel Meter can have "full control" of your device. Android shows this to every app that uses Accessibility. Reel Meter is limited to the four apps above.
   > You can turn this off any time in Settings > Accessibility. Reel Meter then shows app time only.
   > [**Agree and turn on**]  [Not now]
4. **Brand guide** (after Agree): "3 taps in Settings": brand-specific steps and an illustration. Button **Open Settings**. On return: auto-detect, show ✓ or "Stuck?". *Not now* goes instead to a short Usage-access screen ("Use app time only: 1 step") that can be skipped.
5. **You're set.** "Open a reel to try it. We'll confirm when reel #1 is counted." Switch "Show today's count in notifications" (this switch triggers the POST_NOTIFICATIONS prompt). On risky brands only: "Your [Xiaomi] may stop Reel Meter to save battery. **Fix now** (2 taps) / Later".
6. **Goal (optional).** "Want a daily limit?" Chips: 30 / 60 / 100 reels / **Just count for now** (preselected). No blocking here; offer it on day 3.

## 4. Accessibility, languages, devices

- **TalkBack:** every icon labelled; the block screen announces the reason once, then the wait as "20 seconds left" every 10 s (not every second); the wait ring is not the only cue; reading order is reason → Leave → Continue. TalkBack users already run an accessibility service, so test that both run together.
- **Large fonts / small screens:** test at 200% font on a 360×640 dp screen. Onboarding text scrolls with buttons pinned; the disclosure must never hide its buttons below the fold; the block-screen sentence stays visible above the keyboard.
- **Dark mode:** follow the system; the block screen should be calm and dark-friendly; contrast 4.5:1 in both themes.
- **Low-end phones:** no animations on API 26-27 or when "Remove animations" is on; Lottie must not creep in; the dashboard draws 7 days by default.
- **Bangla in v1: yes, recommended.** The owner's first market, Karim's comprehension, and the disclosure must be *understood* to be real consent. Scope: all UI strings (the app is small), the disclosure, notifications, Play listing and screenshots in `bn`. Use Bangla digits through locale formatting, a font check on old Samsung/Symphony ROMs, and Bangla typing for the sentence with an English fallback. Hindi/Urdu/Indonesian later, based on install countries.

## 5. Cheap delights

- "Reel #1 counted ✓" confirmation (once). · "Last reel noticed: 3 min ago" health line in plain words.
- **Quick Settings tile** "Focus 30 min" and long-press **app shortcuts** ("Focus 30 min", "Today"): no permissions, a few KB.
- After **Leave reels**: "Nice. That's your 4th stop this week." · goal streak (already in core) shown as a small flame/number.
- Weekly recap notification on Sunday (inexact alarm, off by default): "312 reels, 18% fewer than last week."
- Privacy screen with a "Check it yourself" link to the source and to the CI test that fails on INTERNET.
- Say the size and "no background service" in the listing: low-end users notice.

## 6. Cut for a lighter v1

Schedules (focus + limits cover most needs; add in v1.1) · 90-day charts and the weekday-by-hour map (keep today/7/30) · CSV
export and extension import (keep JSON export and delete) · the settings-loosening challenge except on Full restriction · the
Usage-access ask in onboarding (moved to the dashboard) · Facebook reel counting if the spike is weak (time only) · Full
restriction moved behind "More levels" (keep the logic and vectors, hide it from first-time users).

## 7. Questions for the lead

1. Bangla in v1 for the full UI, disclosure and listing (the owner translates ~250 strings): yes?
2. May ReelService bring MainActivity forward when the user turns it on (auto-return from Settings), or does the architect see an "autonomous action" risk under [ARCH S1]?
3. Ongoing "today's count" notification: default on or off? And does its existence lower the priority of the D5 overlay?
4. Add TECNO/Infinix/itel phones and Facebook Lite / Instagram Lite to the M1 spike and the closed-test matrix?
5. Android default for the first week: blocking off and Less restriction, even though the extension defaults to Restricted?

## Sources

- [U1] one sec Android setup steps (shortcut toggle warning): https://tutorials.one-sec.app/android-accessibility-permission ; battery/OEM troubleshooting: https://feedback.one-sec.app/help/articles/5486811-one-sec-for-android
- [U2] TECNO (HiOS) background killing, incl. "Short Video Optimization": https://dontkillmyapp.com/tecno
- [U3] Accessibility turning itself off / toggle on but frozen: https://appblock.app/my-accessibility-keeps-turning-off-what-can-i-do ; https://intercom.help/rewardbox-help-center/en/articles/16001568-why-does-the-app-say-accessibility-is-disabled-even-though-my-phone-shows-it-is-on
- [U4] Bangladesh shipments, IDC Q3 2025 (TECNO 20.4%, Infinix 18.2%, Xiaomi 14.9%) as reported: https://www.daily-sun.com/other/838292/value-for-money-redefines-bangladesh-s-smartphone-market ; budget segment: https://www.ula.com.bd/category/mobile-and-accessories-smartphones
- [U5] Per-brand problems (Xiaomi, Samsung, Oppo, vivo, realme...): https://appblock.app/problems-with-specific-phone-brands/
- [U6] ScrollGuard (accessibility + device admin "prevent uninstall"; 4.5 rating): https://appgoblin.info/apps/com.luderapp.scrollguard
- [U7] Decafly listing: https://play.google.com/store/apps/details?id=com.decafly.app ; NoScroll update notes: https://curizic.com/noscroll-blog/how-to-use-noscroll/noscroll-2-0-is-here-the-most-requested-update-in-the-noscrolls-history/
- [U8] Friction interventions in the wild (one sec, 1,039 users), CHI 2024: https://www.medien.ifi.lmu.de/pubdb/publications/pub/haliburton2024chi/haliburton2024chi.pdf
- Note: Play Store review pages could not be fetched, so competitor complaints come from vendors' own help pages (which exist
  because these problems are common) rather than from review text. Read the 1-3 star reviews of Decafly, ScrollGuard and
  StayFree by hand before M5.
