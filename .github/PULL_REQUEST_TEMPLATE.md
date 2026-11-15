## What and why

## Product
- [ ] Extension (`extension/`)
- [ ] Android (`android/`)
- [ ] Shared rules (`shared/`, `extension/src/core.js`)
- [ ] Repository, CI or docs

## Checks
- [ ] Title follows Conventional Commits, e.g. `feat(android): count reels` (the "PR title" check enforces it)
- [ ] "CI result" is green (it covers the extension tests, the browser harness and the Android build)
- [ ] Rules changed? Regenerated the shared vectors: `cd extension && node scripts/gen-vectors.js`
- [ ] No new permissions, sites or network requests without a decision in the docs
- [ ] Changelog updated for user-visible changes (`extension/CHANGELOG.md`, later `android/CHANGELOG.md`)
