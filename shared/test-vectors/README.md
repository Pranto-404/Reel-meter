# Shared test vectors

Cases that **both** Reelity products must pass, so the Android app behaves exactly like the extension.

- **Source of truth:** `extension/src/core.js`. The files here are generated, never edited by hand:
  `cd extension && node scripts/gen-vectors.js`.
- **Extension:** `extension/test/vectors.test.js` fails if a file is missing or out of date.
- **Android:** `android/core/src/test/.../VectorsTest.kt` runs every case against the Kotlin port in `:core`.
- **CI:** a change under `shared/` runs both products' checks.

Each file is `{ "function", "about", "cases": [ { "input": {...}, "expect": {...} } ] }`. Only rules are shared;
UI text (labels, descriptions) lives in each product's own resources.

| File | Function | Ported to Android |
|---|---|---|
| `level-rules.json` | `levelRules(level)` | yes |

New functions get a generator in `extension/scripts/gen-vectors.js` and a test in `VectorsTest` as they are ported
(see docs/android/ROADMAP.md, M2 and M4).
