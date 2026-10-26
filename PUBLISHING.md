# Publishing Reel Meter

Everything below is prepared in this folder. Fees and review times come from the stores' own documentation as of October 2026; check the linked pages before you pay or submit, because stores change them.

## 0. What is already done, and what only you can do

Done:
- Release packages for each browser family (`npm run build`).
- Store text, permission justifications and the privacy policy (`store/LISTING.md`, `store/PRIVACY.md`).
- Store images: 5 screenshots at 1280x800 (plus spares) (`store/screenshots/`) and a 440x280 promo tile (`store/promo/`). Regenerate with `node dev/serve.js` in one terminal and `node dev/shots.js` in another.
- Tests that fail if the packages, permissions, image sizes or listing text drift apart (`npm test`).

Only you can:
1. **Pick a contact email** and put it in `store/PRIVACY.md` (also fill in the date). Use an email you will keep: Chrome does not let you change the developer email later.
2. **Host the privacy policy at a public web address.** Chrome requires a link. The simplest free way is GitHub Pages (a repository with `PRIVACY.md` or an `index.html`), or any page on a site you own.
3. **Replace the Firefox add-on id** in `manifest.json` (`browser_specific_settings.gecko.id`, currently `reel-meter@example.local`) with an email-style id you control, for example `reel-meter@yourdomain.com`. It must stay the same for every future version.
4. **Check the name "Reel Meter" is free** by searching each store. If another extension uses it, pick another name in `manifest.json` and `store/LISTING.md`.
5. Create the store accounts below (they need your identity and, for Chrome, a payment).
6. Decide on a licence if you publish the source (for example MIT). None has been chosen for you.

## 1. Build the packages

```
npm test
npm run build
```

This writes to `dist/`:

| File | Upload it to |
|---|---|
| `reel-meter-<version>-chrome-edge.zip` | Chrome Web Store, Microsoft Edge Add-ons, Opera add-ons (and Brave, Vivaldi and other Chromium browsers install from the Chrome Web Store) |
| `reel-meter-<version>-firefox.zip` | Firefox Add-ons (addons.mozilla.org) |

`dist/chrome` and `dist/firefox` are the same packages unpacked, so you can load them with "Load unpacked" to test exactly what the store will ship.

Every upload to a store needs a higher version number than the last one. Change `version` in `manifest.json` and `package.json` together (the tests check they match).

## 2. Chrome Web Store (Chrome, and installable in Brave, Vivaldi, Arc and others)

1. Open the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole) and sign in with the Google account you want to own the extension.
2. Register as a developer: accept the agreement and pay the one-time registration fee (documented as US$5 at [developer.chrome.com/docs/webstore/register](https://developer.chrome.com/docs/webstore/register)). Enter a developer email you will keep.
3. Click **New item** and upload `reel-meter-<version>-chrome-edge.zip`.
4. **Store listing** tab: paste the name, short description, detailed description and category from `store/LISTING.md`. Upload the icon (`icons/icon128.png`), 1 to 5 screenshots (1280x800) and the small promo tile (440x280).
5. **Privacy practices** tab, using `store/LISTING.md`:
   - Single purpose description.
   - A justification for each permission (`storage`, `alarms`, and the four sites).
   - Remote code: **No**.
   - Data usage: answer truthfully (the extension transmits nothing and stores only local daily totals) and tick the three compliance certifications.
   - Privacy policy URL: the public link from step 0.2.
6. **Distribution** tab: choose **Public**, or **Unlisted** (anyone with the link can install, good for a soft launch), or **Private** (trusted testers only). Choose regions.
7. Click **Submit for review**. Google says most extensions are reviewed within a few days but it can take up to a few weeks, and first submissions with new developer accounts take longer ([review process](https://developer.chrome.com/docs/webstore/review-process)). You can pick "publish manually" so it does not go live the moment it is approved.

## 3. Microsoft Edge Add-ons

1. Go to the [Microsoft Edge Add-ons developer dashboard](https://partner.microsoft.com/dashboard/microsoftedge/overview) (Partner Center) and register. It is free. You can sign in with a Microsoft account or a personal GitHub account.
2. **Create new extension** and upload the same `reel-meter-<version>-chrome-edge.zip`.
3. Fill in the listing from `store/LISTING.md` (name, description, category, screenshots, and the logo; the form states the exact logo size it wants, and `scripts/make-icons.js` can export the icon at any size), the privacy policy link, and notes for certification: "The extension makes no network requests; permissions are storage and alarms."
4. Submit. Third-party guides quote up to about seven business days; Microsoft's own page does not give a fixed number.

## 4. Firefox (addons.mozilla.org)

1. Create a free account at [addons.mozilla.org/developers](https://addons.mozilla.org/developers/).
2. **Submit a New Add-on**, choose **On this site** (public listing), and upload `reel-meter-<version>-firefox.zip`.
3. Firefox now requires new extensions to declare what data they collect. The package already declares `data_collection_permissions: { required: ["none"] }`, which shows as "collects no data" on the listing ([Mozilla's announcement](https://blog.mozilla.org/addons/2025/10/23/data-collection-consent-changes-for-new-firefox-extensions)).
4. Source code: nothing is minified or built, so the package is the source. If asked, say there is no build step.
5. Paste the listing text, add screenshots and the privacy policy link, and submit. Review is partly automatic and partly manual.
6. Bonus for Android: Firefox for Android installs extensions from the same listing. The extension then counts reels watched in the Firefox mobile browser only, not inside the YouTube or Instagram apps. That is separate from the native Android app plan, and the mobile layout has not been tested.

## 5. Other places

- **Opera add-ons** ([addons.opera.com](https://addons.opera.com/developer/)): accepts the Chrome/Edge package, free, similar steps.
- **Safari** (Mac and iPhone): needs a Mac with Xcode and the Apple Developer Program (paid yearly). Run `xcrun safari-web-extension-converter` on the unpacked `dist/chrome` folder, then submit through App Store Connect. Safari's rules are stricter, and Safari on iPhone cannot see inside other apps either.
- **Sharing without a store**: Chrome and Edge on Windows block installing extensions from outside their stores, other than "Load unpacked" in Developer mode. For friends, an Unlisted or Private store listing is easier than sending a zip.

## 6. After you publish

- Reply to reviews and keep the support email working. Stores can remove extensions with no contact route.
- **Never** add network requests, analytics, new sites or new permissions without updating `store/PRIVACY.md`, the listing and the store's privacy form first. The tests are set up to fail if permissions or network calls creep in, so change them deliberately.
- Sites change their pages. If counting stops on one of them, the fix is small (`classify()` in `src/core.js`), then bump the version, rebuild and upload. Updates are reviewed again, usually faster than the first submission.

## 7. Why it should pass review

Common rejection causes and where this extension stands:

| Reviewers look for | Reel Meter |
|---|---|
| Broad permissions such as `<all_urls>` or `tabs` | Only `storage` and `alarms`, and four named sites |
| Obfuscated or remote code | None: plain readable JavaScript, no remote code, no network access |
| Privacy policy and honest data disclosure | Policy written, nothing leaves the device |
| Misleading listing or trademark misuse | Brand names are used only to say where it works, with a "not affiliated" line, no logos |
| Single clear purpose | Count short videos and time spent |
