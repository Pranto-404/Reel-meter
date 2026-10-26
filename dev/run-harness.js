// Runs dev/content-harness.html (the REAL content.js + background.js against a fake page and a compressed clock)
// in a headless Chrome and prints every check that did not pass. Exit code 1 when anything failed.
// It starts its own tiny file server and keeps every temporary file under D:\reel app\.scratch (never on C:).
//
//   node dev/run-harness.js            run everything
//   CHROME="C:\path\to\chrome.exe"     use another browser (Edge works too)
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const CHROME = process.env.CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = Number(process.env.HARNESS_PORT) || 5301 + Math.floor(Math.random() * 400);
const DEBUG = PORT + 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function cdp(url) {
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

async function wsUrl() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${DEBUG}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch (e) { /* not up yet */ }
    await sleep(250);
  }
  throw new Error('the browser did not start');
}

(async () => {
  const scratch = path.join(root, '.scratch');
  fs.mkdirSync(scratch, { recursive: true });
  const profile = fs.mkdtempSync(path.join(scratch, 'harness-'));
  const server = spawn(process.execPath, [path.join(__dirname, 'serve.js'), String(PORT)], { stdio: 'ignore' });
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', ...(process.env.HARNESS_NO_SANDBOX ? ['--no-sandbox'] : []), '--no-first-run', '--no-default-browser-check', '--autoplay-policy=no-user-gesture-required',
    '--mute-audio', `--remote-debugging-port=${DEBUG}`, `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio: 'ignore' });
  let failed = true;
  try {
    await sleep(800);
    const c = cdp(await wsUrl());
    await c.ready;
    await c.send('Page.enable');
    await c.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await c.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/dev/content-harness.html` });
    const t0 = Date.now();
    let result = null;
    while (Date.now() - t0 < 15 * 60 * 1000) {
      await sleep(1000);
      const r = await c.send('Runtime.evaluate', { expression: 'JSON.stringify({done: window.__done || null, log: (document.getElementById("log")||{}).textContent || ""})', returnByValue: true });
      const v = JSON.parse(r.result.value);
      if (v.done) { result = v; break; }
    }
    if (!result) throw new Error('the harness did not finish in 15 minutes');
    const lines = result.log.split('\n');
    const pass = lines.filter((l) => l.startsWith('PASS')).length;
    const bad = lines.filter((l) => l && !l.startsWith('PASS') && !l.startsWith('location.assign') && !/^(ALL CHECKS PASSED|\d+ FAILED)$/.test(l.trim()));
    console.log('checks passed: ' + pass + '   problems: ' + bad.length + '   (' + Math.round((Date.now() - t0) / 1000) + ' s)');
    bad.forEach((l) => console.log('  ' + l));
    // the extension pages under the real security policy: no violation, no script error
    const pageProblems = [];
    for (const [name, query] of [['dashboard', 'page=dashboard&busy=1'], ['dashboard (block scenarios)', 'page=dashboard&block=lock&level=strict'], ['popup', 'page=popup&busy=1']]) {
      await c.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/dev/harness.html?${query}` });
      await sleep(3500);
      const r2 = await c.send('Runtime.evaluate', { expression: 'JSON.stringify({csp: window.__csp || [], errors: window.__errors || [], body: document.body ? document.body.innerText.length : 0})', returnByValue: true });
      const v = JSON.parse(r2.result.value);
      if (v.csp.length || v.errors.length || v.body < 50) pageProblems.push(name + ': ' + JSON.stringify(v));
    }
    console.log('extension pages under the real policy: ' + (pageProblems.length ? pageProblems.length + ' problem(s)' : 'clean'));
    pageProblems.forEach((l) => console.log('  ' + l));
    failed = bad.length > 0 || pageProblems.length > 0 || (result.done && (result.done.failures || result.done.error));
    c.close();
  } finally {
    chrome.kill();
    server.kill();
    await sleep(600);
    fs.rmSync(profile, { recursive: true, force: true });
    try { fs.rmdirSync(scratch); } catch (e) { /* not empty or already gone */ }
  }
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e.message || e); process.exit(2); });
