// Builds store-ready packages: one for Chrome/Edge/Brave/Opera and one for Firefox.
// Run: node scripts/build.js [--out <dir>]      (default output: dist/)
'use strict';
const fs = require('fs');
const path = require('path');
const { zip } = require('./zip');

const root = path.join(__dirname, '..');

function walk(rel) {
  const abs = path.join(root, rel);
  return fs.readdirSync(abs, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(rel, e.name)) : [path.join(rel, e.name).replace(/\\/g, '/')]);
}

function referencedFiles(m) {
  return [
    ...Object.values(m.icons || {}),
    ...Object.values((m.action && m.action.default_icon) || {}),
    m.action && m.action.default_popup,
    m.options_ui && m.options_ui.page,
    m.background && m.background.service_worker,
    ...((m.background && m.background.scripts) || []),
    ...(m.content_scripts || []).flatMap((c) => [...(c.js || []), ...(c.css || [])]),
  ].filter(Boolean);
}

/** Chrome, Edge, Brave, Opera: service worker only, no Firefox-only keys. */
function chromeManifest(m) {
  const out = JSON.parse(JSON.stringify(m));
  delete out.browser_specific_settings;
  out.background = { service_worker: m.background.service_worker };
  return out;
}

/** Firefox: background scripts (event page), gecko id and the "collects no data" declaration. */
function firefoxManifest(m) {
  const out = JSON.parse(JSON.stringify(m));
  delete out.minimum_chrome_version;
  out.background = { scripts: m.background.scripts };
  return out;
}

function build(outDir) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  const missing = referencedFiles(manifest).filter((f) => !fs.existsSync(path.join(root, f)));
  if (missing.length) throw new Error('manifest points at missing files: ' + missing.join(', '));

  const shared = [...walk('src'), ...walk('icons')].sort();
  const targets = {
    chrome: { manifest: chromeManifest(manifest), zip: `reel-meter-${manifest.version}-chrome-edge.zip` },
    firefox: { manifest: firefoxManifest(manifest), zip: `reel-meter-${manifest.version}-firefox.zip` },
  };

  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const result = { version: manifest.version, targets: {} };

  for (const [name, t] of Object.entries(targets)) {
    const files = [{ name: 'manifest.json', data: Buffer.from(JSON.stringify(t.manifest, null, 2) + '\n') }];
    for (const rel of shared) files.push({ name: rel, data: fs.readFileSync(path.join(root, rel)) });

    // unpacked copy for loading straight into the browser while testing the package
    for (const f of files) {
      const dest = path.join(outDir, name, f.name);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, f.data);
    }
    const zipPath = path.join(outDir, t.zip);
    fs.writeFileSync(zipPath, zip(files));
    result.targets[name] = { zip: zipPath, files: files.length, bytes: fs.statSync(zipPath).size };
  }
  return result;
}

module.exports = { build, chromeManifest, firefoxManifest, referencedFiles };

if (require.main === module) {
  const i = process.argv.indexOf('--out');
  const out = i > -1 ? path.resolve(process.argv[i + 1]) : path.join(root, 'dist');
  const r = build(out);
  console.log('Reel Meter ' + r.version);
  for (const [name, t] of Object.entries(r.targets)) {
    console.log('  ' + name.padEnd(8) + t.files + ' files, ' + (t.bytes / 1024).toFixed(1) + ' KB  ' + path.relative(root, t.zip));
  }
}
