// Writes shared/test-vectors/*.json from extension/src/core.js, the reference implementation.
// Both products run these cases: extension/test/vectors.test.js checks the files are up to date, and the Android
// :core module (VectorsTest) checks the Kotlin port gives the same answers.
//
//   node scripts/gen-vectors.js          write the files
//   node scripts/gen-vectors.js --check  exit 1 if a file is missing or stale (used by the tests)
'use strict';
const fs = require('fs');
const path = require('path');
const C = require('../src/core.js');

const OUT = path.join(__dirname, '..', '..', 'shared', 'test-vectors');

/** Only the fields that are rules (UI text such as label and blurb is not shared). */
const RULE_FIELDS = ['waitSec', 'breakMin', 'strikes', 'strikeWindowMin', 'lockHours', 'sentence', 'timedUnlock', 'settingsChange'];
const pick = (o) => Object.fromEntries(RULE_FIELDS.map((k) => [k, o[k]]));

function levelRules() {
  const inputs = [...C.BLOCK_LEVELS, '', 'nonsense', null];
  return {
    function: 'levelRules',
    about: 'Rules of each restriction level; a missing or unknown level falls back to "balanced".',
    cases: inputs.map((level) => ({ input: { level }, expect: pick(C.levelRules(level)) })),
  };
}

const FILES = { 'level-rules.json': levelRules };

function render(make) {
  return JSON.stringify(make(), null, 2) + '\n';
}

function main() {
  const check = process.argv.includes('--check');
  let stale = [];
  fs.mkdirSync(OUT, { recursive: true });
  for (const [name, make] of Object.entries(FILES)) {
    const file = path.join(OUT, name);
    const text = render(make);
    if (check) {
      if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== text) stale.push(name);
    } else {
      fs.writeFileSync(file, text);
    }
  }
  if (stale.length) {
    console.error('Stale test vectors (run: node scripts/gen-vectors.js): ' + stale.join(', '));
    process.exit(1);
  }
}

if (require.main === module) main();
module.exports = { FILES, render, OUT };
