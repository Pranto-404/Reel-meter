'use strict';
// The shared test vectors in shared/test-vectors/ must always match what core.js does today.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { FILES, render, OUT } = require('../scripts/gen-vectors.js');

for (const [name, make] of Object.entries(FILES)) {
  test('shared vector file ' + name + ' is up to date (run: node scripts/gen-vectors.js)', () => {
    const file = path.join(OUT, name);
    assert.ok(fs.existsSync(file), 'missing ' + file);
    assert.equal(fs.readFileSync(file, 'utf8'), render(make));
  });
}
