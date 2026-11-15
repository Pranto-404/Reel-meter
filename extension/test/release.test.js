'use strict';
// Checks the store packages and store assets that scripts/build.js and dev/shots.js produce.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { build, referencedFiles } = require('../scripts/build.js');
const { zip, unzip } = require('../scripts/zip.js');

const root = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'reel-meter-release-'));
const result = build(out);
const read = (target) => unzip(fs.readFileSync(result.targets[target].zip));
const names = (entries) => entries.map((e) => e.name);
const manifestOf = (entries) => JSON.parse(entries.find((e) => e.name === 'manifest.json').data.toString('utf8'));

test.after(() => fs.rmSync(out, { recursive: true, force: true }));

test('zip writer round-trips files and keeps forward-slash paths', () => {
  const files = [
    { name: 'a.txt', data: Buffer.from('hello hello hello hello') },
    { name: 'dir\\b.bin', data: Buffer.from([1, 2, 3, 4, 5]) },
    { name: 'dir/empty.txt', data: Buffer.alloc(0) },
  ];
  const back = unzip(zip(files));
  assert.deepEqual(names(back), ['a.txt', 'dir/b.bin', 'dir/empty.txt']);
  assert.equal(back[0].data.toString(), 'hello hello hello hello');
  assert.deepEqual([...back[1].data], [1, 2, 3, 4, 5]);
});

test('version is consistent and release-shaped', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.version, manifest.version);
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.equal(result.version, manifest.version);
});

test('listing text fits the store limits and matches the manifest', () => {
  assert.ok(manifest.name.length <= 45, 'name too long for Chrome Web Store');
  assert.ok(manifest.description.length <= 132, 'description over 132 characters');
  const listing = fs.readFileSync(path.join(root, 'store', 'LISTING.md'), 'utf8');
  assert.ok(listing.includes(manifest.description), 'store/LISTING.md short description differs from manifest.json');
});

for (const target of ['chrome', 'firefox']) {
  test(target + ' package: contains only what the extension needs', () => {
    const entries = read(target);
    const list = names(entries);
    assert.ok(list.includes('manifest.json'), 'manifest.json must be at the zip root');
    assert.ok(list.every((n) => !n.includes('\\') && !n.startsWith('/')), 'bad path separators');
    for (const n of list) {
      assert.ok(n === 'manifest.json' || /^(src|icons)\//.test(n), 'unexpected file in package: ' + n);
    }
    const m = manifestOf(entries);
    for (const f of referencedFiles(m)) assert.ok(list.includes(f), 'package is missing ' + f);
    assert.ok(result.targets[target].bytes < 2 * 1024 * 1024, 'package unexpectedly large');
  });
}

test('chrome/edge package: service worker only and no Firefox-only keys', () => {
  const m = manifestOf(read('chrome'));
  assert.deepEqual(m.background, { service_worker: 'src/background.js' });
  assert.equal(m.browser_specific_settings, undefined);
  assert.deepEqual([...m.permissions].sort(), ['alarms', 'storage']);
  assert.equal(m.host_permissions, undefined);
});

test('firefox package: event page, gecko id and the "collects no data" declaration', () => {
  const m = manifestOf(read('firefox'));
  assert.equal(m.background.service_worker, undefined);
  assert.deepEqual(m.background.scripts, ['src/core.js', 'src/background.js']);
  assert.match(m.browser_specific_settings.gecko.id, /^[^@\s]+@[^@\s]+$/);
  assert.deepEqual(m.browser_specific_settings.gecko.data_collection_permissions, { required: ['none'] });
  assert.equal(m.minimum_chrome_version, undefined);
});

function pngSize(file) {
  const b = fs.readFileSync(file);
  assert.equal(b.toString('latin1', 1, 4), 'PNG', file + ' is not a PNG');
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

test('store images have the exact sizes the stores ask for', () => {
  const dir = path.join(root, 'store', 'screenshots');
  const shots = fs.readdirSync(dir).filter((f) => f.endsWith('.png'));
  assert.ok(shots.length >= 1 && shots.length <= 5, 'the Chrome Web Store takes 1 to 5 screenshots; keep extras in store/screenshots/spare/');
  for (const f of shots) assert.deepEqual(pngSize(path.join(dir, f)), [1280, 800], f);
  assert.deepEqual(pngSize(path.join(root, 'store', 'promo', 'promo-440x280.png')), [440, 280]);
  assert.deepEqual(pngSize(path.join(root, 'icons', 'icon128.png')), [128, 128]);
});

test('privacy policy and publishing guide exist and name the real permissions', () => {
  const policy = fs.readFileSync(path.join(root, 'store', 'PRIVACY.md'), 'utf8');
  for (const p of manifest.permissions) assert.ok(policy.includes('`' + p + '`'), 'policy does not explain permission ' + p);
  assert.ok(fs.existsSync(path.join(root, 'docs', 'PUBLISHING.md')));
});
