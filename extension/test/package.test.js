'use strict';
// Static checks on the shipped extension: manifest wiring, file references, and privacy guarantees.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const exists = (p) => fs.existsSync(path.join(root, p));
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

function walk(dir) {
  return fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
}

test('every file the manifest points at exists', () => {
  const files = [
    ...Object.values(manifest.icons),
    ...Object.values(manifest.action.default_icon),
    manifest.action.default_popup,
    manifest.options_ui.page,
    manifest.background.service_worker,
    ...manifest.background.scripts,
    ...manifest.content_scripts.flatMap((c) => c.js),
  ];
  for (const f of files) assert.ok(exists(f), 'missing ' + f);
});

test('HTML pages only reference scripts and styles that exist', () => {
  for (const page of ['src/ui/popup.html', 'src/ui/dashboard.html']) {
    const html = read(page);
    for (const m of html.matchAll(/(?:src|href)="([^"#]+\.(?:js|css))"/g)) {
      assert.ok(exists(path.join(path.dirname(page), m[1])), page + ' references missing ' + m[1]);
    }
    assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/.test(html), page + ' has an inline script (blocked by the extension CSP)');
  }
});

test('every JavaScript file parses', () => {
  for (const f of walk('src').filter((p) => p.endsWith('.js'))) {
    execFileSync(process.execPath, ['--check', path.join(root, f)]);
  }
});

test('privacy: minimal permissions, no broad hosts, network blocked on extension pages', () => {
  assert.deepEqual([...manifest.permissions].sort(), ['alarms', 'storage']);
  assert.equal(manifest.host_permissions, undefined);
  assert.equal(manifest.optional_permissions, undefined);
  assert.match(manifest.content_security_policy.extension_pages, /connect-src 'none'/);
  for (const m of manifest.content_scripts.flatMap((c) => c.matches)) {
    assert.match(m, /^https:\/\/(www\.|m\.|web\.|\*\.)(youtube|instagram|tiktok|facebook)\.com\/\*$/);
  }
});

test('privacy: no source file makes a network request or touches page content', () => {
  const banned = [/\bfetch\s*\(/, /XMLHttpRequest/, /WebSocket/, /sendBeacon/, /navigator\.mediaDevices/, /getDisplayMedia/, /captureVisibleTab/, /\.innerText/, /\.textContent\s*\)?\s*(?:\.|;)\s*(?:slice|match|includes)/];
  for (const f of walk('src').filter((p) => p.endsWith('.js'))) {
    const code = read(f);
    for (const re of banned) assert.ok(!re.test(code), f + ' matches ' + re);
  }
});

test('content script reads no page text and sends only platform, seconds and reels', () => {
  const code = read('src/content.js');
  assert.ok(!/document\.title/.test(code));
  assert.ok(!/location\.(href|search|hash)/.test(code));
  const flush = /type: 'flush', platform: activePlatform, seconds, reels/.test(code);
  assert.ok(flush, 'flush message shape changed: re-check what leaves the page');
});
