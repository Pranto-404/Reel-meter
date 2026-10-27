/* The "Block reels" section of the dashboard: restriction level, per-app blocks, hard limit, Shorts as videos,
   focus timer and schedules.

   Rules for changes (ReelCore.changePolicy): making a block stronger is always free. Loosening a running block
   needs the wait-and-type challenge, is not allowed at all on Full restriction, and is refused while any app is in
   a lockout. Focus timers are started through the background worker, which owns the running block state.

   Presentation notes: the lists are updated in place (rows are kept, not rebuilt) so state chips and schedule rows can
   animate and keyboard focus is never lost. Everything animated uses transform and opacity; reduced motion is handled
   by the shared rule in ui.css. */
(function () {
  'use strict';
  const C = self.ReelCore;
  const K = self.ReelKit;
  if (!C || !K || !document.getElementById('block')) return;
  const { h } = K;
  const $ = (id) => document.getElementById(id);
  const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const WEEKDAYS_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const DOTS = { youtube: 'var(--series-1)', instagram: 'var(--series-2)', tiktok: 'var(--series-3)', facebook: 'var(--series-4)' };
  const form = $('blk-form');
  const toast = K.toaster($('toasts'));

  let settings = C.normalizeSettings();
  let state = C.emptyBlockState();
  let stats = {};
  const focusApps = new Set(C.PLATFORM_ORDER); // which apps the focus buttons act on

  /** A small stroked icon from path strings (built node by node). */
  function pathIcon(...paths) {
    const s = h('svg', { viewBox: '0 0 24 24', class: 'ico', 'aria-hidden': 'true', focusable: 'false' });
    paths.forEach((d) => s.appendChild(h('path', { d })));
    return s;
  }
  const SHIELD = 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z';
  const LEVEL_ICONS = {
    gentle: () => pathIcon('M5 19c0-8.5 5-14 14-14 0 9-5.5 14-14 14z', 'M5 19l7-7'),
    balanced: () => pathIcon(SHIELD),
    strict: () => pathIcon(SHIELD, 'M9.5 12v-1a2.5 2.5 0 0 1 5 0v1', 'M9 12h6v4.2H9z'),
  };
  const STATE_ICONS = { off: 'bars', on: 'lock', break: 'pause', lock: 'lock' };

  async function load() {
    const o = await chrome.storage.local.get(['settings', 'blockState', 'stats']);
    settings = C.normalizeSettings(o.settings);
    state = C.normalizeBlockState(o.blockState);
    stats = o.stats || {};
  }

  const eff = () => C.withBlockState(settings, state);
  const limitOverFor = (s) => C.evaluateLimits(s, C.getDay(stats, C.dayKey(new Date()))).over;
  const hasLimit = (s) => s.dailyReelLimit > 0 || s.dailyMinuteLimit > 0;

  // ------------------------------------------------------------------ status

  /** What is going on with one app right now, in words. */
  function appState(p, now, lo) {
    const e = eff();
    const b = e.block;
    if (b.breaks[p] > now) return { tone: 'break', text: 'On a break until ' + C.formatClock(b.breaks[p]) };
    if (b.lockUntil[p] > now) return { tone: 'lock', text: 'Locked until ' + C.formatClock(b.lockUntil[p]) };
    const why = C.blockReason(e, now, lo, p);
    if (!why) return { tone: 'off', text: 'Counting only' };
    if (why.reason === 'focus') return { tone: 'on', text: 'Focus timer, ' + C.formatLeft(why.until - now) };
    if (why.reason === 'schedule') return { tone: 'on', text: 'Schedule until ' + C.formatClock(why.until) };
    if (why.reason === 'limit') return { tone: 'on', text: 'Daily limit reached, until midnight' };
    return { tone: 'on', text: 'Blocked' };
  }

  /** The four app rows are built once and updated in place; a chip pops when its state changes. */
  const appRows = {};
  function buildAppRows() {
    const list = $('blk-apps');
    if (list.children.length === C.PLATFORM_ORDER.length) return;
    list.replaceChildren(...C.PLATFORM_ORDER.map((p) => {
      const chipIcon = h('span', { class: 'chip-i' });
      const chipText = h('span', { class: 'chip-t' });
      const chip = h('span', { class: 'blk-app-s' }, chipIcon, chipText);
      const used = h('span', { class: 'blk-app-u' });
      const li = h('li', { class: 'blk-app', 'data-tone': 'off', 'data-p': p },
        h('div', { class: 'blk-app-top' },
          h('i', { class: 'dot', style: 'background:' + DOTS[p] }),
          h('span', { class: 'blk-app-n', text: C.PLATFORMS[p].label }),
          chip),
        used);
      appRows[p] = { li, chip, chipIcon, chipText, used, tone: '', sig: '' };
      return li;
    }));
  }

  function updateChip(row, tone, text) {
    const sig = tone + '|' + text;
    if (row.sig === sig) return;
    const first = row.sig === '';
    const toneChanged = row.tone !== tone;
    row.sig = sig;
    row.li.setAttribute('data-tone', tone);
    if (toneChanged) row.chipIcon.replaceChildren(K.icon(STATE_ICONS[tone]));
    row.tone = tone;
    K.setText(row.chipText, text);
    if (!first && !K.reduced()) { // restart the little pop
      row.chip.classList.remove('flip');
      void row.chip.offsetWidth;
      row.chip.classList.add('flip');
    }
  }

  function renderStatus() {
    const now = Date.now();
    const lo = limitOverFor(settings);
    const e = eff();
    const el = $('blk-status');
    const states = C.PLATFORM_ORDER.map((p) => appState(p, now, lo));
    const anyLock = states.some((s) => s.tone === 'lock');
    const anyOn = states.some((s) => s.tone === 'on');
    const anyBreak = states.some((s) => s.tone === 'break');
    let tone = 'off';
    let title = 'Not blocking right now';
    let sub = 'Pick an app, a schedule or a focus timer below.';
    let chip = '';
    if (anyLock) {
      tone = 'lock'; title = 'An app is locked'; sub = 'You unblocked it too often, so it stays blocked until the time shown. Nothing can be loosened until then.';
      chip = C.formatLeft(Math.max.apply(null, C.PLATFORM_ORDER.map((p) => state.lockUntil[p])) - now);
    } else if (anyOn) {
      tone = 'on'; title = 'Blocking is on'; sub = 'Loosening it needs the challenge' + (C.levelRules(e.block.level).settingsChange === 'never' ? ' (not possible on Full restriction)' : '') + '.';
    } else if (anyBreak) {
      tone = 'break'; title = 'On a break'; sub = 'The break ends by itself and the block comes back. Press "Block now" on the reel page to end it early.';
      chip = C.formatLeft(Math.max.apply(null, C.PLATFORM_ORDER.map((p) => state.breaks[p])) - now);
    } else {
      const bits = [];
      const on = settings.block.schedules.filter((s) => s.on).length;
      if (on) bits.push(on + (on === 1 ? ' schedule' : ' schedules') + ' set');
      if (settings.block.hardLimit) bits.push('hard daily limit on');
      if (settings.block.shortsAsVideos) bits.push('Shorts open as normal videos');
      if (bits.length) sub = bits.join(' · ') + '.';
    }
    el.setAttribute('data-tone', tone);
    K.setText($('blk-t'), title);
    K.setText($('blk-s'), sub);
    $('blk-time').hidden = !chip;
    if (chip) K.setText($('blk-time'), chip);

    buildAppRows();
    C.PLATFORM_ORDER.forEach((p, i) => {
      const st = states[i];
      const row = appRows[p];
      updateChip(row, st.tone, st.text);
      const strikes = C.strikeInfo(e, p, now);
      row.used.hidden = !strikes.used;
      if (strikes.used) {
        const sig = strikes.used + '/' + strikes.max;
        if (row.used.getAttribute('data-sig') !== sig) {
          row.used.setAttribute('data-sig', sig);
          row.used.title = 'Reaching ' + strikes.max + ' locks it for ' + strikes.lockHours + ' hours';
          row.used.replaceChildren(
            h('span', { class: 'mini-pips', 'aria-hidden': 'true' }, Array.from({ length: strikes.max }, (_, k) => h('i', { class: k < strikes.used ? 'used' : '' }))),
            h('span', { text: strikes.used + ' of ' + strikes.max + ' unblocks used' }));
        }
      }
    });
  }

  // ---------------------------------------------------------------- controls

  /** The three level cards are built once (so keyboard focus and the selection animation survive changes). */
  function renderLevels() {
    const host = $('blk-levels');
    if (host.children.length !== C.BLOCK_LEVELS.length) {
      host.replaceChildren(...C.BLOCK_LEVELS.map((lv, i) => {
        const r = C.levelRules(lv);
        const input = h('input', { type: 'radio', name: 'blk-level', value: lv });
        return h('label', { class: 'level', 'data-level': lv },
          input,
          h('span', { class: 'level-b' },
            h('span', { class: 'level-top' },
              h('span', { class: 'level-ico' }, LEVEL_ICONS[lv]()),
              h('span', { class: 'level-t', text: r.label }),
              h('span', { class: 'level-str', 'aria-hidden': 'true' }, [0, 1, 2].map((k) => h('i', { class: k <= i ? 'on' : '' })))),
            h('span', { class: 'level-s', text: r.blurb }),
            h('span', { class: 'level-f' },
              h('span', { class: 'lf' }, K.icon('clock'), r.waitSec + ' s wait'),
              h('span', { class: 'lf' }, K.icon('pause'), r.breakMin + ' min break'),
              h('span', { class: 'lf' }, K.icon('lock'), r.strikes + ' unblocks → ' + r.lockHours + ' h lock'))),
          h('span', { class: 'level-tick', 'aria-hidden': 'true' }, K.icon('check')));
      }));
    }
    [...host.children].forEach((c) => { c.querySelector('input').checked = c.dataset.level === settings.block.level; });
  }

  function renderFocusApps() {
    const host = $('blk-focus-apps');
    if (host.children.length !== C.PLATFORM_ORDER.length) {
      host.replaceChildren(...C.PLATFORM_ORDER.map((p) => h('button', {
        type: 'button', class: 'fapp', 'data-p': p, 'aria-pressed': 'true',
      }, h('i', { class: 'dot', style: 'background:' + DOTS[p] }), C.PLATFORMS[p].label.replace(' Shorts', '').replace(' Reels', ''), h('span', { class: 'fapp-ck', 'aria-hidden': 'true' }, K.icon('check')))));
    }
    [...host.children].forEach((b) => b.setAttribute('aria-pressed', String(focusApps.has(b.dataset.p))));
  }

  // schedules: rows are kept by id and updated in place; a new row unfolds, a removed row folds away

  function daysLabel(days) {
    const d = days.slice().sort();
    if (d.length === 7) return 'Every day';
    if (!d.length) return 'No days chosen';
    if (d.join() === '0,1,2,3,4') return 'Weekdays';
    if (d.join() === '5,6') return 'Weekends';
    return d.map((x) => WEEKDAYS[x]).join(', ');
  }
  function lengthLabel(s) {
    const a = C.parseHm(s.start);
    const b = C.parseHm(s.end);
    if (a === null || b === null || a === b) return '';
    const m = (b - a + 1440) % 1440;
    return Math.floor(m / 60) + ' h' + (m % 60 ? ' ' + (m % 60) + ' min' : '');
  }

  function schedRow(s) {
    const dayBtns = WEEKDAYS.map((d, i) => h('button', {
      type: 'button', class: 'day', 'data-day': String(i), 'aria-pressed': String(s.days.includes(i)),
      'aria-label': WEEKDAYS_LONG[i], text: d,
    }));
    const tl = h('div', { class: 'sched-tl', 'aria-hidden': 'true' }, h('i', { class: 'a' }), h('i', { class: 'b' }));
    const row = h('div', { class: 'sched', 'data-id': s.id },
      h('div', { class: 'sched-top' },
        h('label', { class: 'sw', 'aria-label': 'Schedule on' },
          h('input', { type: 'checkbox', role: 'switch', class: 'sched-on', checked: s.on }),
          h('span', { class: 'sw-ui' })),
        h('div', { class: 'times' },
          h('input', { type: 'time', class: 'sched-start', value: s.start, 'aria-label': 'Start time' }),
          h('span', { class: 'to', text: 'to' }),
          h('input', { type: 'time', class: 'sched-end', value: s.end, 'aria-label': 'End time' })),
        h('span', { class: 'grow' }),
        h('button', { type: 'button', class: 'icon-btn sched-del', 'aria-label': 'Delete schedule' }, K.icon('trash'))),
      h('div', { class: 'days', role: 'group', 'aria-label': 'Days' }, dayBtns),
      tl,
      h('div', { class: 'sched-foot' },
        h('p', { class: 'small muted sched-sum' }),
        h('span', { class: 'chip good sched-now', hidden: true, text: 'Active now' })));
    const wrap = h('div', { class: 'sched-wrap', 'data-id': s.id, 'data-open': 'false' }, h('div', { class: 'sched-in' }, row));
    return wrap;
  }

  /** Bring one row up to date with the stored schedule (never overwrites a time box someone is typing in). */
  function fillSched(wrap, s) {
    const row = wrap.querySelector('.sched');
    const on = row.querySelector('.sched-on');
    if (on.checked !== s.on) on.checked = s.on;
    for (const [sel, val] of [['.sched-start', s.start], ['.sched-end', s.end]]) {
      const inp = row.querySelector(sel);
      if (inp !== document.activeElement && inp.value !== val) inp.value = val;
    }
    row.querySelectorAll('.day').forEach((b) => b.setAttribute('aria-pressed', String(s.days.includes(Number(b.dataset.day)))));
    row.classList.toggle('is-off', !s.on);
    // the window on a 24 hour line (an overnight window shows as two pieces)
    const a = C.parseHm(s.start);
    const b = C.parseHm(s.end);
    const segA = row.querySelector('.sched-tl .a');
    const segB = row.querySelector('.sched-tl .b');
    const set = (el, from, to) => { el.style.left = (from / 14.4) + '%'; el.style.width = Math.max(0, (to - from) / 14.4) + '%'; el.hidden = to <= from; };
    if (a === null || b === null || a === b) { segA.hidden = segB.hidden = true; } else if (a < b) { set(segA, a, b); segB.hidden = true; } else { set(segA, a, 1440); set(segB, 0, b); }
    const len = lengthLabel(s);
    K.setText(row.querySelector('.sched-sum'), daysLabel(s.days) + ' · ' + s.start + ' to ' + s.end + (len ? ' (' + len + ')' : ''));
    row.querySelector('.sched-now').hidden = !(s.on && C.scheduleActive(s, new Date()));
  }

  function renderSchedules() {
    const host = $('blk-sched');
    const list = settings.block.schedules;
    const wraps = new Map([...host.querySelectorAll('.sched-wrap')].map((w) => [w.dataset.id, w]));
    const ids = new Set(list.map((s) => s.id));
    // rows that are gone fold away, then leave the page
    wraps.forEach((w, id) => {
      if (ids.has(id) || w.classList.contains('leaving')) return;
      w.classList.add('leaving');
      w.setAttribute('data-open', 'false');
      setTimeout(() => w.remove(), K.reduced() ? 0 : 360);
    });
    const ordered = list.map((s) => {
      let w = wraps.get(s.id);
      if (!w || w.classList.contains('leaving')) {
        w = schedRow(s);
        host.appendChild(w);
        void w.offsetWidth; // so the new row unfolds from nothing
        if (host.dataset.ready) requestAnimationFrame(() => w.setAttribute('data-open', 'true'));
        else w.setAttribute('data-open', 'true'); // the first fill appears at once
      }
      fillSched(w, s);
      return w;
    });
    // keep the stored order (rows that are folding away are skipped)
    let cursor = host.firstElementChild;
    for (const w of ordered) {
      while (cursor && cursor !== w && cursor.classList.contains('leaving')) cursor = cursor.nextElementSibling;
      if (cursor === w) cursor = cursor.nextElementSibling; else host.insertBefore(w, cursor);
    }
    host.dataset.ready = '1';
    const empty = host.querySelector('.sched-empty');
    if (!list.length && !empty) {
      host.appendChild(h('div', { class: 'sched-empty' }, h('span', { class: 'empty-ico' }, K.icon('calendar')), h('p', { class: 'small muted', text: 'No schedules yet. Add one to block at the same hours every week.' })));
    } else if (list.length && empty) {
      empty.remove();
    }
    $('blk-add').disabled = list.length >= C.MAX_SCHEDULES;
  }

  function fillControls() {
    const b = settings.block;
    C.PLATFORM_ORDER.forEach((p) => { form.elements['blk-app-' + p].checked = b.apps[p] === 'block'; });
    form.elements['blk-hardLimit'].checked = b.hardLimit;
    form.elements['blk-shortsAsVideos'].checked = b.shortsAsVideos;
    $('blk-limit-hint').hidden = hasLimit(settings);
    const now = Date.now();
    const running = C.PLATFORM_ORDER.filter((p) => state.focus[p] > now);
    K.setText($('blk-focus-s'), running.length
      ? 'Focus is on for ' + running.map((p) => C.PLATFORMS[p].label.split(' ')[0] + ' (' + C.formatLeft(state.focus[p] - now) + ')').join(', ') + '. Each press adds time.'
      : 'Block reels for a set time on the apps you choose. Each press adds time.');
    $('blk-focus-card').setAttribute('data-running', String(running.length > 0));
    renderLevels();
    renderFocusApps();
    renderSchedules();
  }

  function render() {
    renderStatus();
    fillControls();
  }

  // ----------------------------------------------------------------- changes

  const REFUSALS = {
    'denied-lock': 'An app is locked because you unblocked it too often. Nothing can be loosened until the lock ends.',
    'denied-strict': 'Full restriction does not let a running block be loosened. You can change it when no block is running.',
  };

  /**
   * Apply a change to the block settings, following ReelCore.changePolicy: free, behind the challenge, or refused.
   * Controls always snap back to what is stored when a change is held back or refused.
   */
  async function apply(mutate, okText) {
    const o = await chrome.storage.local.get(['settings', 'blockState', 'stats']);
    const prev = C.normalizeSettings(o.settings);
    state = C.normalizeBlockState(o.blockState);
    stats = o.stats || {};
    const next = JSON.parse(JSON.stringify(prev));
    mutate(next.block);
    const clean = C.normalizeSettings(next);
    if (JSON.stringify(clean) === JSON.stringify(prev)) { settings = prev; fillControls(); return; }
    const policy = C.changePolicy(C.withBlockState(prev, state, Date.now()), clean, Date.now());
    if (policy !== 'free') {
      settings = prev;
      fillControls(); // put the control back where it was
      if (policy === 'challenge') askUnlock(clean);
      else toast(REFUSALS[policy], { tone: 'info', duration: 7000 });
      return;
    }
    await chrome.storage.local.set({ settings: clean });
    settings = clean;
    render();
    if (okText) toast(okText);
  }

  const schedOf = (b, id) => b.schedules.find((s) => s.id === id);

  form.addEventListener('change', (e) => {
    const n = e.target.name || '';
    if (n.startsWith('blk-app-')) {
      const p = n.slice('blk-app-'.length);
      apply((b) => { b.apps[p] = e.target.checked ? 'block' : 'count'; }, e.target.checked ? C.PLATFORMS[p].label + ' is now blocked' : 'Saved');
    } else if (n === 'blk-hardLimit') {
      apply((b) => { b.hardLimit = e.target.checked; }, 'Saved');
    } else if (n === 'blk-shortsAsVideos') {
      apply((b) => { b.shortsAsVideos = e.target.checked; }, 'Saved');
    } else if (n === 'blk-level') {
      apply((b) => { b.level = e.target.value; }, C.levelRules(e.target.value).label + ' is on');
    }
  });

  $('blk-focus-apps').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-p]');
    if (!btn) return;
    const p = btn.dataset.p;
    if (focusApps.has(p) && focusApps.size > 1) focusApps.delete(p);
    else focusApps.add(p);
    renderFocusApps();
  });

  $('blk-focus-btns').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-mins]');
    if (!btn) return;
    const mins = Number(btn.dataset.mins);
    const platforms = C.PLATFORM_ORDER.filter((p) => focusApps.has(p));
    btn.classList.remove('sent');
    void btn.offsetWidth;
    btn.classList.add('sent'); // a short confirming pulse
    setTimeout(() => btn.classList.remove('sent'), 900);
    // the background worker owns the running state: it adds the time and ends any break on those apps
    chrome.runtime.sendMessage({ type: 'focus', platforms, minutes: mins }, (resp) => {
      if (chrome.runtime.lastError || !resp || !resp.ok) { toast('Could not start the focus timer. Please try again.', { tone: 'info' }); return; }
      load().then(() => { render(); toast('Focus on: ' + platforms.map((p) => C.PLATFORMS[p].label.split(' ')[0]).join(', ')); });
    });
  });

  $('blk-add').addEventListener('click', () => {
    if (settings.block.schedules.length >= C.MAX_SCHEDULES) { toast('You can have up to ' + C.MAX_SCHEDULES + ' schedules', { tone: 'info' }); return; }
    const id = 's' + Date.now().toString(36).slice(-6);
    apply((b) => { b.schedules.push({ id, on: true, days: [0, 1, 2, 3, 4, 5, 6], start: '22:00', end: '07:00' }); }, 'Schedule added: every night, 22:00 to 07:00');
  });

  const sched = $('blk-sched');
  sched.addEventListener('click', (e) => {
    const row = e.target.closest('.sched');
    if (!row) return;
    const id = row.dataset.id;
    const day = e.target.closest('.day');
    if (day) {
      const d = Number(day.dataset.day);
      apply((b) => {
        const s = schedOf(b, id);
        if (s) s.days = s.days.includes(d) ? s.days.filter((x) => x !== d) : s.days.concat(d).sort();
      });
    } else if (e.target.closest('.sched-del')) {
      apply((b) => { b.schedules = b.schedules.filter((s) => s.id !== id); }, 'Schedule removed');
    }
  });
  sched.addEventListener('change', (e) => {
    const row = e.target.closest('.sched');
    if (!row) return;
    const id = row.dataset.id;
    if (e.target.classList.contains('sched-on')) {
      apply((b) => { const s = schedOf(b, id); if (s) s.on = e.target.checked; });
    } else if (e.target.classList.contains('sched-start') || e.target.classList.contains('sched-end')) {
      if (C.parseHm(e.target.value) === null) { renderSchedules(); return; } // cleared or invalid: keep the old time
      const key = e.target.classList.contains('sched-start') ? 'start' : 'end';
      apply((b) => { const s = schedOf(b, id); if (s) s[key] = e.target.value; });
    }
  });

  // --------------------------------------------------------------- challenge

  const dlg = $('unlock');
  const input = $('unlock-input');
  const go = $('unlock-go');
  const box = $('unlock-box');
  const prg = $('unlock-prg');
  const RING_C = 2 * Math.PI * 40;
  let pending = null;
  let pendingBase = null; // the settings the dialog was opened from
  let timer = 0;
  let left = 0;
  let wait = 30;
  let cells = []; // one element per letter (and space) of the sentence
  let paint = '';

  const normSentence = (x) => String(x == null ? '' : x).toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ');
  const HINTS = {
    idle: 'Capital letters and punctuation do not matter.',
    typing: 'Looking right so far.',
    off: 'Not quite. The underlined letter is the next one.',
    almost: 'Almost there.',
    ready: 'Ready. You can apply the change, or keep your block as it is.',
  };

  function drawWait() {
    const done = Math.min(1, Math.max(0, (wait - left) / wait));
    prg.style.strokeDashoffset = (RING_C * (1 - done)).toFixed(2);
    K.setText($('unlock-n'), String(Math.max(0, left)));
    box.classList.toggle('done', left <= 0);
    K.setText($('unlock-wait'), left > 0 ? 'You can continue in ' + left + ' s' : 'Now type the sentence:');
  }

  function paintSentence(text) {
    const el = $('unlock-sentence');
    el.replaceChildren();
    cells = [];
    String(text).split(' ').forEach((word, wi) => {
      if (wi) { const sp = h('span', { class: 'c', text: ' ' }); el.appendChild(sp); cells.push(sp); }
      const w = h('span', { class: 'w' });
      for (const ch of word) {
        const c = h('span', { class: 'c', text: ch });
        w.appendChild(c);
        if (/[a-z]/i.test(ch)) cells.push(c); // only letters and spaces count, like C.sentenceMatches
      }
      el.appendChild(w);
    });
    paint = '';
  }

  /** Live feedback while typing: matching letters light up, a slip is marked kindly, then "almost there" and "ready". */
  function paintTyping() {
    const target = normSentence(C.levelRules(settings.block.level).sentence).trim();
    const full = C.sentenceMatches(input.value, settings.block.level);
    let typed = normSentence(input.value).replace(/^ /, '');
    if (full) typed = target;
    let n = 0;
    while (n < typed.length && n < target.length && typed.charAt(n) === target.charAt(n)) n++;
    const bad = !full && n < typed.length;
    const st = full ? 'ready' : bad ? 'off' : n === 0 ? 'idle' : n / target.length >= 0.75 ? 'almost' : 'typing';
    const sig = st + n;
    if (paint === sig) return;
    paint = sig;
    cells.forEach((c, i) => { c.classList.toggle('m', i < n); c.classList.toggle('x', bad && i === n); });
    ['typing', 'off', 'almost', 'ready'].forEach((s) => dlg.classList.toggle('t-' + s, st === s));
    $('unlock-prog').style.transform = 'scaleX(' + (target.length ? (full ? 1 : n / target.length).toFixed(3) : 0) + ')';
    K.setText($('unlock-hint'), HINTS[st]);
  }

  function askUnlock(clean) {
    const rules = C.levelRules(settings.block.level); // the level that is running now, not the one being asked for
    pending = clean;
    pendingBase = settings;
    wait = rules.waitSec;
    paintSentence(rules.sentence);
    input.value = '';
    input.disabled = true;
    go.disabled = true;
    left = wait;
    prg.style.transition = 'none';
    prg.style.strokeDashoffset = RING_C.toFixed(2);
    void prg.getBoundingClientRect();
    prg.style.transition = '';
    box.classList.remove('done');
    drawWait();
    paintTyping();
    clearInterval(timer);
    if (!dlg.open) dlg.showModal();
    // the worker keeps its own wait clock: the wait starts when it says so
    chrome.runtime.sendMessage({ type: 'loosen-start', settings: clean, base: settings }, (resp) => {
      if (!pending || pending !== clean) return;
      if (chrome.runtime.lastError || !resp || !resp.ok) {
        closeUnlock();
        toast(resp && REFUSALS[resp.why] ? REFUSALS[resp.why] : 'Could not start. Please try again.', { tone: 'info', duration: 7000 });
        return;
      }
      timer = setInterval(() => {
        if (document.visibilityState !== 'visible') return; // the wait only counts while you are looking at this tab
        left--;
        drawWait();
        if (left <= 0) { clearInterval(timer); input.disabled = false; input.focus(); }
      }, 1000);
    });
  }

  function closeUnlock() {
    clearInterval(timer);
    pending = null;
    if (dlg.open) dlg.close();
    fillControls();
  }

  input.addEventListener('input', () => { go.disabled = !(left <= 0 && C.sentenceMatches(input.value, settings.block.level)); paintTyping(); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); if (!go.disabled) go.click(); } });
  input.addEventListener('paste', (e) => e.preventDefault());
  $('unlock-form').addEventListener('submit', (e) => e.preventDefault());
  $('unlock-cancel').addEventListener('click', closeUnlock);
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); closeUnlock(); });
  go.addEventListener('click', async () => {
    if (!pending || left > 0 || !C.sentenceMatches(input.value, settings.block.level)) return;
    const next = pending;
    const baseSettings = pendingBase;
    clearInterval(timer);
    pending = null;
    // re-check at the moment of saving: a lockout may have started while the dialog was open
    const o = await chrome.storage.local.get(['settings', 'blockState']);
    const prev = C.normalizeSettings(o.settings);
    const policy = C.changePolicy(C.withBlockState(prev, o.blockState, Date.now()), next, Date.now());
    if (dlg.open) dlg.close();
    if (policy === 'denied-lock' || policy === 'denied-strict') { fillControls(); toast(REFUSALS[policy], { tone: 'info', duration: 7000 }); return; }
    // the background worker checks the rules again with its own wait clock, counts this loosening and saves the settings
    chrome.runtime.sendMessage({ type: 'loosen', settings: next, base: baseSettings, sentence: input.value }, (resp) => {
      if (chrome.runtime.lastError || !resp || !resp.ok) {
        fillControls();
        toast(resp && REFUSALS[resp.why] ? REFUSALS[resp.why] : 'That change was not accepted. Please try again.', { tone: 'info', duration: 7000 });
        return;
      }
      load().then(() => {
        render();
        toast(resp.locked ? 'Applied. That was one loosening too many: no more changes like it for ' + C.levelRules(settings.block.level).lockHours + ' hours.' : 'Your change is applied.', { duration: resp.locked ? 8000 : 4000 });
      });
    });
  });

  // -------------------------------------------------------------------- start

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes.settings || changes.stats || changes.blockState)) load().then(render);
  });
  setInterval(() => { renderStatus(); fillControls(); }, 15000);
  load().then(() => { K.hydrateIcons(); render(); });
})();
