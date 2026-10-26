// Makes the store screenshots with a real headless Chrome and the Chrome DevTools Protocol (no dependencies).
// Needs the preview server running:  node dev/serve.js 5178
// Run: node dev/shots.js
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const CHROME = process.env.CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = 'http://127.0.0.1:' + (process.env.PORT || 5178);
const PORT = 9333;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function connect() {
  for (let i = 0; i < 50; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch (e) { /* not up yet */ }
    await sleep(200);
  }
  throw new Error('Chrome did not start');
}

function client(url) {
  const ws = new WebSocket(url);
  let id = 0;
  const pending = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  const ready = new Promise((r) => { ws.onopen = r; });
  const send = (method, params) => new Promise((resolve, reject) => {
    const n = ++id;
    pending.set(n, (m) => (m.error ? reject(new Error(method + ': ' + m.error.message)) : resolve(m.result)));
    ws.send(JSON.stringify({ id: n, method, params }));
  });
  return { ready, send, close: () => ws.close() };
}

const SHOTS = [
  { name: '1-overview', url: '/dev/harness.html?page=dashboard&busy=1', w: 1280, h: 800, scheme: 'light', scroll: null },
  { name: 'spare/patterns', url: '/dev/harness.html?page=dashboard&busy=1', w: 1280, h: 800, scheme: 'light', scroll: 'patterns' },
  { name: 'spare/limits', url: '/dev/harness.html?page=dashboard&busy=1', w: 1280, h: 800, scheme: 'light', scroll: 'limits' },
  { name: '4-block-settings', url: '/dev/harness.html?page=dashboard&busy=1', w: 1280, h: 800, scheme: 'light', scroll: 'block' },
  { name: 'spare/dark', url: '/dev/harness.html?page=dashboard&busy=1', w: 1280, h: 800, scheme: 'dark', scroll: null },
  {
    name: '5-popup', url: '/dev/harness.html?page=popup&busy=1', w: 1280, h: 800, scheme: 'light', scroll: null,
    style: 'html{background:#dfe4ec!important}body{zoom:1.05;margin:12px auto!important;border-radius:14px;box-shadow:0 18px 60px rgba(20,30,60,.25)}',
  },
];

(async () => {
  const outDir = path.join(root, 'store', 'screenshots');
  fs.mkdirSync(outDir, { recursive: true });
  // temporary browser profile lives inside the project (D:), not in the system temp folder on C:
  const scratch = path.join(root, '.scratch');
  fs.mkdirSync(scratch, { recursive: true });
  const profile = fs.mkdtempSync(path.join(scratch, 'shots-'));
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio: 'ignore' });
  try {
    const c = client(await connect());
    await c.ready;
    await c.send('Page.enable');
    for (const s of SHOTS) {
      await c.send('Emulation.setDeviceMetricsOverride', { width: s.w, height: s.h, deviceScaleFactor: 1, mobile: false });
      await c.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: s.scheme }] });
      await c.send('Page.navigate', { url: BASE + s.url });
      await sleep(3500);
      if (s.style) {
        await c.send('Runtime.evaluate', { expression: `(()=>{const e=document.createElement('style');e.textContent=${JSON.stringify(s.style)};document.head.appendChild(e)})()` });
      }
      if (s.scroll) {
        await c.send('Runtime.evaluate', { expression: `document.getElementById(${JSON.stringify(s.scroll)}).scrollIntoView({block:'start',behavior:'instant'})` });
      }
      await sleep(2500); // let reveal animations finish
      const shot = await c.send('Page.captureScreenshot', { format: 'png' });
      const file = path.join(outDir, s.name + '.png');
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
      console.log('wrote', path.relative(root, file));
    }
    // the real content script against a plain test page (no third-party content): the island, then the block screen
    const waitDone = async () => {
      for (let i = 0; i < 600; i++) {
        await sleep(500);
        const r = await c.send('Runtime.evaluate', { expression: 'Boolean(window.__done)', returnByValue: true });
        if (r.result.value) return;
      }
      throw new Error('the test page did not finish');
    };
    const save = async (rel) => {
      const shot = await c.send('Page.captureScreenshot', { format: 'png' });
      const file = path.join(outDir, rel);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
      console.log('wrote', path.relative(root, file));
    };
    await c.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await c.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
    await c.send('Page.navigate', { url: BASE + '/dev/content-harness.html?hold=A&shot=1' });
    await waitDone();
    await sleep(1800);
    await save('spare/island-compact.png');
    await c.send('Runtime.evaluate', { expression: `(()=>{const i=document.querySelector('[data-reel-meter]').shadowRoot.querySelector('.isl');i.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:5,clientY:5,pointerId:1}));i.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,clientX:5,clientY:5,pointerId:1}))})()` });
    await sleep(1800);
    await save('2-island-open.png');
    await c.send('Page.navigate', { url: BASE + '/dev/content-harness.html?hold=M&shot=1' });
    await waitDone();
    await sleep(1500);
    await save('3-block-screen.png');

    // promo tile (440x280) from store/promo/promo.html
    const promo = path.join(root, 'store', 'promo', 'promo.html');
    if (fs.existsSync(promo)) {
      await c.send('Emulation.setDeviceMetricsOverride', { width: 440, height: 280, deviceScaleFactor: 1, mobile: false });
      await c.send('Page.navigate', { url: BASE + '/store/promo/promo.html' });
      await sleep(2500);
      const shot = await c.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(root, 'store', 'promo', 'promo-440x280.png'), Buffer.from(shot.data, 'base64'));
      console.log('wrote store/promo/promo-440x280.png');
    }
    c.close();
  } finally {
    chrome.kill();
    await sleep(500);
    fs.rmSync(profile, { recursive: true, force: true });
    try { fs.rmdirSync(path.join(root, '.scratch')); } catch (e) { /* not empty or already gone */ }
  }
})().catch((e) => { console.error(e); process.exit(1); });
