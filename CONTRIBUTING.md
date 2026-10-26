# Contributing

Thanks for helping. A few rules keep the privacy promise intact.

## Ground rules
- No network requests, analytics, accounts or new permissions. Tests fail if they creep in.
- Nothing about what is watched is stored: only daily totals and settings.
- No build step and no dependencies: plain JavaScript, loaded unpacked straight from the repository.

## Run it
1. Chrome or Edge: `chrome://extensions` or `edge://extensions`, turn on Developer mode, **Load unpacked**, pick this folder.
2. After changing code, press the reload arrow on the extension card (each browser separately) and open a new tab.

## Checks
```bash
npm test          # unit tests (about 2 seconds)
npm run harness   # real content script + worker against a fake page in headless Chrome (about 90 seconds)
npm run build     # store packages in dist/
```
`src/core.js` holds all pure logic and is shared by the page script, the worker, the UI and the tests.
See `README.md` for the layout and `docs/HANDOFF.md` for design notes.

## Releases
Bump `version` in `manifest.json` and `package.json` together, add a `CHANGELOG.md` entry, commit, then tag:
```bash
git tag v1.2.4
git push origin main --tags
```
The Release workflow builds the zips and attaches them to a GitHub release.
