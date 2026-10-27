(function () {
  'use strict';
  const C = self.ReelCore;
  const K = self.ReelKit;
  const Ch = self.ReelCharts;
  const { h, setText, countTo } = K;
  const $ = (id) => document.getElementById(id);
  const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const WEEKDAYS_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const HOUR_LABELS = ['12a', '3a', '6a', '9a', '12p', '3p', '6p', '9p'];
  const SECTIONS = ['overview', 'patterns', 'limits', 'block', 'privacy'];
  const fmtInt = (n) => Math.round(n).toLocaleString();
  const pad2 = (n) => String(n).padStart(2, '0');

  let stats = {};
  let settings = C.normalizeSettings();
  let meta = {};
  let blockState = C.emptyBlockState();
  let range = 7;
  let metric = 'r';
  let tableView = false;
  let lastDay = '';

  const toast = K.toaster($('toasts'));
  const platRows = K.platformRows($('platforms'), C, { words: true });
  const syncers = [];

  // ------------------------------------------------------------------- data

  async function load() {
    const o = await chrome.storage.local.get(['stats', 'settings', 'meta', 'blockState']);
    stats = o.stats || {};
    settings = C.normalizeSettings(o.settings);
    meta = o.meta || {};
    blockState = C.normalizeBlockState(o.blockState);
  }

  function today() {
    return C.dayKey(new Date());
  }

  function isFresh() {
    for (const k of Object.keys(stats)) {
      const d = stats[k];
      if (d && (d.r || d.s)) return false;
    }
    return true;
  }

  const timeOfDay = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  // ------------------------------------------------------------------- hero

  const hourBars = [];
  let hoursPrimed = false;

  function buildHours() {
    const host = $('hours');
    for (let i = 0; i < 24; i++) {
      const b = h('i');
      hourBars.push(b);
      host.appendChild(b);
    }
  }

  function renderHero() {
    const key = today();
    const day = C.getDay(stats, key);
    const lim = C.evaluateLimits(settings, day);
    const fresh = isFresh();
    const hero = $('hero');
    const mode = fresh ? 'empty' : lim.hasLimit ? 'limit' : 'calm';
    const modeChanged = hero.dataset.mode !== mode;
    hero.dataset.mode = mode;

    setText($('hero-date'), new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' }));
    countTo($('hero-reels'), day.r, fmtInt);
    setText($('hero-unit'), day.r === 1 ? 'reel' : 'reels');
    setText($('hero-time'), C.formatDuration(day.s));

    const y = C.getDay(stats, C.addDays(key, -1));
    const showY = !fresh && (y.r || y.s);
    $('hero-yday').hidden = !showY;
    if (showY) setText($('hero-yday'), 'Yesterday: ' + fmtInt(y.r) + (y.r === 1 ? ' reel' : ' reels') + ' · ' + C.formatDuration(y.s));

    // limit ring and wording
    if (lim.hasLimit) {
      const ring = $('ring');
      const fill = $('ring-fill');
      const pct = Math.round(lim.pct * 100);
      if (modeChanged && mode === 'limit') {
        fill.style.strokeDashoffset = '100';
        void fill.getBoundingClientRect(); // so the arc sweeps in from empty
      }
      ring.classList.toggle('near', lim.near);
      ring.classList.toggle('over', lim.over);
      ring.classList.toggle('zero', lim.pct <= 0);
      fill.style.strokeDashoffset = String(100 - Math.min(100, lim.pct * 100));
      ring.setAttribute('aria-label', pct + '% of today’s limit used');
      countTo($('ring-pct'), pct, (n) => n + '%');

      const byReels = settings.dailyReelLimit > 0 && (settings.dailyMinuteLimit <= 0 || lim.reelsPct >= lim.minsPct);
      const left = byReels ? settings.dailyReelLimit - day.r : Math.round(settings.dailyMinuteLimit - day.s / 60);
      const unit = (n) => (byReels ? n + (n === 1 ? ' reel' : ' reels') : n + ' min');
      let status;
      if (lim.over) status = left === 0 ? 'You have reached today’s limit' : 'Over today’s limit by ' + unit(Math.abs(left));
      else if (lim.near) status = 'Close to your limit: ' + unit(left) + ' left';
      else status = unit(left) + ' left today';
      setText($('hero-status'), status);

      const bits = [];
      if (settings.dailyReelLimit) bits.push(fmtInt(day.r) + ' of ' + fmtInt(settings.dailyReelLimit) + ' reels');
      if (settings.dailyMinuteLimit) bits.push(Math.round(day.s / 60) + ' of ' + settings.dailyMinuteLimit + ' min');
      setText($('hero-limit-text'), bits.join(' · '));

      const streak = C.goalStreak(stats, key, settings, meta.installedOn);
      $('hero-streak').hidden = streak < 2;
      if (streak >= 2) setText($('hero-streak-t'), streak + '-day streak under your limit');
    }

    // calm mode: today by hour
    if (mode === 'calm') {
      const max = Math.max(0, ...day.h);
      if (!hoursPrimed) {
        hoursPrimed = true;
        hourBars.forEach((b) => b.style.setProperty('--v', '0%'));
        void $('hours').offsetHeight;
      }
      hourBars.forEach((b, i) => {
        const v = day.h[i] || 0;
        b.style.setProperty('--v', (max > 0 && v > 0 ? Math.max(6, (v / max) * 100) : 0) + '%');
        b.classList.toggle('on', v > 0);
        b.setAttribute('data-tip', pad2(i) + ':00\n' + (v > 0 ? C.formatDuration(v) : 'nothing tracked'));
      });
    }
    renderPaused();
  }

  function renderPaused() {
    const left = settings.snoozeUntil - Date.now();
    const paused = left > 0;
    $('hero-paused').hidden = !paused;
    if (paused) setText($('hero-paused-t'), 'Tracking paused until ' + timeOfDay(settings.snoozeUntil));
  }

  // ------------------------------------------------------------------ tiles

  function deltaFor(now, before, prevStart) {
    // A comparison with a period that began before the install would just reflect missing data.
    if (meta.installedOn && prevStart < meta.installedOn) return null;
    const pct = C.pctChange(now, before);
    if (pct === null) return null;
    const vs = 'vs previous ' + range + ' days';
    if (pct === 0) return { cls: '', pill: 'No change', text: vs };
    return pct > 0
      ? { cls: 'up', pill: '▲ ' + pct + '%', text: vs }
      : { cls: 'down', pill: '▼ ' + Math.abs(pct) + '%', text: vs };
  }

  function setDelta(id, d) {
    const el = $(id);
    el.hidden = !d;
    if (!d) return;
    const sig = d.cls + '|' + d.pill + '|' + d.text;
    if (el.getAttribute('data-sig') === sig) return;
    el.setAttribute('data-sig', sig);
    el.className = 'd ' + d.cls;
    el.replaceChildren(h('span', { class: 'pill', text: d.pill }), h('span', { text: d.text }));
  }

  function renderTiles(days, prevDays) {
    const t = C.sumDays(days);
    const p = C.sumDays(prevDays);
    countTo($('t-reels'), t.r, C.formatCompact);
    countTo($('t-time'), t.s, C.formatDuration);
    countTo($('t-avg'), t.s / range, C.formatDuration);
    countTo($('t-rpd'), t.r / range, (n) => String(Math.round(n)));
    setDelta('d-reels', deltaFor(t.r, p.r, prevDays[0].key));
    setDelta('d-time', deltaFor(t.s, p.s, prevDays[0].key));
    setDelta('d-avg', null);
    setDelta('d-rpd', null);
  }

  // -------------------------------------------------------- chart and table

  let pane = '';
  let tableSig = '';
  const chartEmpty = K.empty('bars', 'No reels in this range',
    'Once you watch some, a bar for each day appears here. Try a longer range if you have been away.');
  $('chart-empty').appendChild(chartEmpty);

  function showPane(next) {
    if (pane === next) return;
    pane = next;
    const els = { chart: $('chart'), table: $('table-wrap'), empty: $('chart-empty') };
    for (const k of Object.keys(els)) {
      els[k].hidden = k !== next;
      if (k === next && !K.reduced()) {
        els[k].classList.remove('pane-in');
        void els[k].offsetWidth;
        els[k].classList.add('pane-in');
      }
    }
  }

  function renderChart() {
    const days = C.rangeDays(stats, today(), range);
    const t = C.sumDays(days);
    const empty = t.r === 0 && t.s === 0;
    setText($('chart-title'), (metric === 'r' ? 'Reels' : 'Minutes') + ' per day');
    setText($('chart-sub'), empty ? '' : metric === 'r'
      ? fmtInt(t.r) + ' total · ' + fmtInt(t.r / range) + ' a day'
      : C.formatDuration(t.s) + ' total · ' + C.formatDuration(t.s / range) + ' a day');
    showPane(empty ? 'empty' : tableView ? 'table' : 'chart');
    if (empty || tableView) {
      if (tableView && !empty) renderTable(days);
      return;
    }
    const limit = metric === 'r' ? settings.dailyReelLimit : settings.dailyMinuteLimit;
    Ch.columns($('chart'), days, { metric, axes: true, height: 250, limit: limit || 0 });
  }

  function renderTable(days) {
    const sig = days.map((d) => d.key + ':' + d.r + ':' + d.s).join('|');
    if (sig === tableSig) return;
    tableSig = sig;
    const table = document.createElement('table');
    const head = table.createTHead().insertRow();
    ['Date', 'Reels', 'Time'].concat(C.PLATFORM_ORDER.map((p) => C.PLATFORMS[p].label)).forEach((label) => {
      head.appendChild(h('th', { scope: 'col', text: label }));
    });
    const body = table.createTBody();
    for (const d of days.slice().reverse()) {
      const row = body.insertRow();
      const date = C.parseDayKey(d.key).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
      const cells = [date, fmtInt(d.r), C.formatDuration(d.s)].concat(
        C.PLATFORM_ORDER.map((p) => (d.p[p] ? fmtInt(d.p[p].r) + ' · ' + C.formatDuration(d.p[p].s) : '–'))
      );
      cells.forEach((c) => { row.insertCell().textContent = c; });
    }
    $('table-wrap').replaceChildren(h('div', { class: 'tablescroll', tabindex: '0', role: 'region', 'aria-label': 'Daily totals table' }, table));
  }

  // ------------------------------------------------------ by app, insights

  const platEmpty = K.empty('grid', 'No app activity yet', 'The split by app appears after your first counted reel.');
  $('plat-empty').appendChild(platEmpty);
  const insEmpty = K.empty('sparkle', 'Nothing to read yet', 'After you have watched a few reels, plain-language observations show up here.');
  $('ins-empty').appendChild(insEmpty);

  function renderPlatforms(days) {
    const t = C.sumDays(days);
    const empty = t.r === 0 && t.s === 0;
    $('platforms').hidden = empty;
    $('plat-empty').hidden = !empty;
    setText($('plat-sub'), 'Last ' + range + ' days');
    platRows.update(t.p, metric === 'r' ? 'r' : 's');
  }

  const INSIGHT_STYLE = {
    up: ['up', 'bad'], down: ['down', 'good'], peak: ['moon', ''], streak: ['flame', 'good'], summary: ['clock', ''],
  };
  const insightStyle = (kind) => INSIGHT_STYLE[kind] || ['sparkle', ''];

  let insSig = '';
  function renderInsights() {
    const list = $('insights');
    const quiet = C.sumDays(C.rangeDays(stats, today(), 14)).s === 0;
    list.hidden = quiet;
    $('ins-empty').hidden = !quiet;
    if (quiet) { insSig = ''; return; }
    const items = C.buildInsights(stats, today(), settings, meta.installedOn);
    const sig = items.map((i) => i.kind + ':' + i.text).join('\n');
    if (sig === insSig) return;
    insSig = sig;
    list.replaceChildren(...items.map(({ kind, text }, i) => {
      const [ic, tone] = insightStyle(kind);
      const li = h('li', { style: '--i:' + i }, h('span', { class: 'ins-ico ' + tone }, K.icon(ic)), h('p', { text }));
      return li;
    }));
  }

  // ---------------------------------------------------------------- heatmap

  const heatCells = [];
  const heatEmpty = K.empty('calendar', 'No pattern to show yet',
    'When you have a few days of data, this map shows which weekdays and hours you scroll the most.');
  $('heat-empty').appendChild(heatEmpty);

  function buildHeat() {
    const host = $('heat');
    const head = h('div', { class: 'hr', role: 'row' }, h('span', { role: 'columnheader', class: 'sr-only', text: 'Weekday' }));
    for (let hr = 0; hr < 24; hr++) {
      head.appendChild(h('span', {
        class: 'colh' + (hr % 6 === 0 ? ' six' : ''), role: 'columnheader',
        text: hr % 3 === 0 ? HOUR_LABELS[hr / 3] : '',
        'aria-label': hr % 3 === 0 ? undefined : pad2(hr) + ':00',
      }));
    }
    host.appendChild(head);
    for (let wd = 0; wd < 7; wd++) {
      const row = h('div', { class: 'hr', role: 'row' }, h('span', { class: 'rowh', role: 'rowheader', text: WEEKDAYS[wd] }));
      heatCells.push([]);
      for (let hr = 0; hr < 24; hr++) {
        const c = h('span', { class: 'cell', role: 'cell', 'data-l': '0', style: '--r:' + wd + ';--c:' + hr });
        heatCells[wd].push(c);
        row.appendChild(c);
      }
      host.appendChild(row);
    }
  }

  function renderHeat() {
    const grid = C.weekdayHourHeat(stats, today(), 90);
    const max = Math.max(0, ...grid.map((r) => Math.max(...r)));
    const empty = max <= 0;
    $('heat-body').hidden = empty;
    $('heat-empty').hidden = !empty;
    $('heat-sum').hidden = empty;
    if (empty) return;
    let best = [0, 0];
    grid.forEach((row, wd) => row.forEach((v, hr) => {
      if (v > grid[best[0]][best[1]]) best = [wd, hr];
      const cell = heatCells[wd][hr];
      const level = v <= 0 ? 0 : Math.min(5, 1 + Math.floor((v / max) * 4.999));
      const lv = String(level);
      if (cell.getAttribute('data-l') !== lv) cell.setAttribute('data-l', lv);
      const text = WEEKDAYS[wd] + ' ' + pad2(hr) + ':00\n' + (v > 0 ? C.formatDuration(v) + ' in total' : 'nothing tracked');
      if (cell.getAttribute('data-tip') !== text) {
        cell.setAttribute('data-tip', text);
        cell.setAttribute('aria-label', text.replace('\n', ', '));
      }
    }));
    const [bw, bh] = best;
    setText($('heat-sum-t'), 'Busiest slot: ' + WEEKDAYS_LONG[bw] + ' ' + pad2(bh) + ':00 to ' + pad2((bh + 1) % 24) + ':00, about ' + C.formatDuration(grid[bw][bh]) + ' in total.');
  }

  // --------------------------------------------------------------- settings

  const NUMBERS = ['dailyReelLimit', 'dailyMinuteLimit', 'streakNudge', 'minDwellSec', 'idleCutoffSec'];
  const CHECKS = ['nearLimitNudge', 'mindfulPause', 'greyscaleOverLimit', 'showCounter', 'showBadge'];
  const POS_LABEL = {};
  document.querySelectorAll('.pos').forEach((l) => { POS_LABEL[l.querySelector('input').value] = l.getAttribute('data-label'); });

  function fillForm(skipActive) {
    const f = $('settings');
    const active = skipActive ? document.activeElement : null;
    NUMBERS.forEach((n) => { if (f.elements[n] !== active) f.elements[n].value = settings[n]; });
    CHECKS.forEach((n) => { f.elements[n].checked = settings[n]; });
    C.PLATFORM_ORDER.forEach((p) => { f.elements['platform-' + p].checked = settings.platforms[p]; });
    f.elements.counterCorner.value = settings.counterCorner;
    syncers.forEach((s) => s());
    updatePicker();
  }

  function updatePicker() {
    setText($('pos-cap'), POS_LABEL[settings.counterCorner] || '');
  }

  let saveTimer = 0;
  let savePending = false;
  function scheduleSave(delay) {
    clearTimeout(saveTimer);
    savePending = true;
    saveTimer = setTimeout(saveForm, delay);
  }

  async function saveForm() {
    savePending = false;
    const f = $('settings');
    const o = await chrome.storage.local.get('settings');
    const prev = C.normalizeSettings(o.settings);
    const next = Object.assign({}, prev);
    NUMBERS.forEach((n) => { next[n] = f.elements[n].value === '' ? 0 : Number(f.elements[n].value); });
    CHECKS.forEach((n) => { next[n] = f.elements[n].checked; });
    next.platforms = {};
    C.PLATFORM_ORDER.forEach((p) => { next.platforms[p] = f.elements['platform-' + p].checked; });
    next.counterCorner = f.elements.counterCorner.value;
    const clean = C.normalizeSettings(next);
    // a hard daily limit must not be loosened by editing the limit while a block is running
    const policy = C.changePolicy(C.withBlockState(prev, blockState, Date.now()), clean, Date.now());
    if (policy !== 'free') {
      settings = prev;
      fillForm(false);
      toast('A running block stops this change. Loosen the block first, in Block reels' + (policy === 'denied-strict' ? ' (not possible on Full restriction while it runs)' : policy === 'denied-lock' ? ' (not possible during a lockout)' : '') + '.', { tone: 'info', duration: 7000 });
      return;
    }
    const changed = JSON.stringify(clean) !== JSON.stringify(prev);
    settings = clean;
    fillForm(false); // shows the clamped values the extension will really use
    if (changed) {
      await chrome.storage.local.set({ settings: clean });
      toast('Saved');
    }
    renderHero();
    renderChart();
  }

  // ----------------------------------------------------------------- privacy

  function buildPerms() {
    const mf = chrome.runtime.getManifest();
    const perms = $('perms');
    perms.replaceChildren();
    const add = (parts) => { perms.appendChild(h('li', null, parts)); };
    const code = (t) => h('code', { text: t });
    const perm = mf.permissions || [];
    const why = [];
    if (perm.includes('storage')) why.push('storage keeps your totals on this device');
    if (perm.includes('alarms')) why.push('alarms refreshes the toolbar badge at midnight');
    add(['Permissions requested: ', code(perm.join(', ') || 'none'), why.length ? ' (' + why.join('; ') + ')' : '']);
    const hosts = (mf.content_scripts || []).flatMap((c) => c.matches);
    add(['Runs only on: ', code(hosts.join('  '))]);
    add(['Host permissions for any other site: ', code((mf.host_permissions || []).length ? mf.host_permissions.join(', ') : 'none')]);
    add(['No ', code('tabs'), ', ', code('history'), ', ', code('webRequest'), ' or ', code('downloads'), ' permission.']);
  }

  function renderPrivacy() {
    const keys = Object.keys(stats).sort();
    const bytes = new Blob([JSON.stringify(stats)]).size;
    countTo($('s-days'), keys.length, fmtInt);
    setText($('s-oldest'), keys[0]
      ? C.parseDayKey(keys[0]).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : 'none');
    setText($('s-size'), bytes < 1024 ? bytes + ' bytes' : (bytes / 1024).toFixed(1) + ' KB');
  }

  function download(name, type, text) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportAs(kind) {
    const n = Object.keys(stats).length;
    if (!n) { toast('Nothing to export yet', { tone: 'info' }); return false; }
    if (kind === 'json') download('reel-meter-' + today() + '.json', 'application/json', JSON.stringify({ exportedOn: today(), stats }, null, 2));
    else download('reel-meter-' + today() + '.csv', 'text/csv', C.toCsv(stats));
    toast('Exported ' + n + (n === 1 ? ' day' : ' days') + ' as ' + kind.toUpperCase());
    return true;
  }

  const dlg = $('confirm');

  function askDelete() {
    const keys = Object.keys(stats);
    if (!keys.length) { toast('There is nothing stored to delete', { tone: 'info' }); return; }
    const t = C.sumDays(keys.map((k) => C.getDay(stats, k)));
    setText($('confirm-d'), 'This removes ' + keys.length + (keys.length === 1 ? ' day' : ' days') + ' of counts from this device: ' +
      fmtInt(t.r) + ' reels and ' + C.formatDuration(t.s) + ' of screen time.');
    dlg.returnValue = '';
    dlg.showModal();
  }

  async function deleteAll() {
    const snapshot = { stats: JSON.parse(JSON.stringify(stats)), meta: JSON.parse(JSON.stringify(meta)) };
    // with a hard daily limit today's count stays: deleting it would lift a limit block that is running
    const keepToday = settings.block.hardLimit && stats[today()] ? { [today()]: stats[today()] } : null;
    await chrome.storage.local.remove(['stats']);
    if (keepToday) await chrome.storage.local.set({ stats: keepToday });
    await chrome.storage.local.set({ meta: { installedOn: today() } });
    try { await (chrome.storage.session || chrome.storage.local).remove('session'); } catch (e) { /* none */ }
    await refresh();
    toast(settings.block.hardLimit ? 'Counts deleted (today\u2019s stays while the hard daily limit is on)' : 'All counts deleted', { action: { label: 'Undo', onClick: () => restore(snapshot) }, duration: 10000 });
  }

  async function restore(snapshot) {
    const cur = await chrome.storage.local.get('stats');
    await chrome.storage.local.set({ stats: Object.assign({}, cur.stats || {}, snapshot.stats), meta: snapshot.meta });
    await refresh();
    toast('Your counts are back');
  }

  // ----------------------------------------------------------------- welcome

  function initWelcome() {
    if (location.hash !== '#welcome') return;
    const w = $('welcome');
    w.hidden = false;
    const close = () => {
      if (w.contains(document.activeElement)) $('main').focus({ preventScroll: true });
      w.classList.add('closing');
      setTimeout(() => { w.hidden = true; }, K.reduced() ? 0 : 480);
      try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* ignore */ }
    };
    $('welcome-x').addEventListener('click', close);
    $('welcome-ok').addEventListener('click', close);
  }

  // ------------------------------------------------------------- navigation

  function initNav() {
    const header = $('top');
    const links = [...document.querySelectorAll('#nav a')];
    let ticking = false;
    const update = () => {
      ticking = false;
      const y = header.offsetHeight + 90;
      let cur = SECTIONS[0];
      for (const id of SECTIONS) {
        if ($(id).getBoundingClientRect().top <= y) cur = id;
      }
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) cur = SECTIONS[SECTIONS.length - 1];
      links.forEach((a) => {
        const on = a.getAttribute('data-sec') === cur;
        if (on) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current');
      });
      header.classList.toggle('scrolled', window.scrollY > 4);
    };
    const queue = () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } };
    window.addEventListener('scroll', queue, { passive: true });
    window.addEventListener('resize', queue);
    links.forEach((a) => a.addEventListener('click', () => {
      links.forEach((x) => x.removeAttribute('aria-current'));
      a.setAttribute('aria-current', 'true');
    }));
    const setHdr = () => document.documentElement.style.setProperty('--hdr', header.offsetHeight + 'px');
    if (self.ResizeObserver) new ResizeObserver(setHdr).observe(header);
    setHdr();
    update();
  }

  // --------------------------------------------------------------------- run

  function renderOverview() {
    const days = C.rangeDays(stats, today(), range);
    const prev = C.rangeDays(stats, C.addDays(today(), -range), range);
    renderTiles(days, prev);
    renderChart();
    renderPlatforms(days);
  }

  function renderAll() {
    lastDay = today();
    renderHero();
    renderOverview();
    renderInsights();
    renderHeat();
    renderPrivacy();
    updatePicker();
  }

  async function refresh() {
    await load();
    renderAll();
  }

  function bindSeg(id, attr, onPick) {
    const root = $(id);
    const sync = K.seg(root);
    syncers.push(sync);
    root.addEventListener('click', (e) => {
      const b = e.target.closest('button[' + attr + ']');
      if (!b) return;
      [...root.querySelectorAll('button')].forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      sync();
      onPick(b.getAttribute(attr));
    });
  }

  function bind() {
    bindSeg('range-seg', 'data-range', (v) => { range = Number(v); renderOverview(); });
    bindSeg('metric-seg', 'data-metric', (v) => { metric = v; renderOverview(); });
    $('table-toggle').addEventListener('click', () => {
      tableView = !tableView;
      $('table-toggle').setAttribute('aria-pressed', String(tableView));
      renderChart();
    });

    document.querySelectorAll('.stepper').forEach((s) => syncers.push(K.stepper(s)));
    const form = $('settings');
    form.addEventListener('change', (e) => scheduleSave(e.target.type === 'number' ? 220 : 0));
    form.addEventListener('submit', (e) => e.preventDefault());
    form.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.type === 'number') { e.preventDefault(); e.target.blur(); } });

    const picker = $('picker');
    picker.addEventListener('mouseover', (e) => {
      const l = e.target.closest('.pos');
      if (l) setText($('pos-cap'), l.getAttribute('data-label'));
    });
    picker.addEventListener('mouseleave', updatePicker);

    $('hero-resume').addEventListener('click', async () => {
      const o = await chrome.storage.local.get('settings');
      await chrome.storage.local.set({ settings: Object.assign(C.normalizeSettings(o.settings), { snoozeUntil: 0 }) });
      toast('Tracking resumed');
    });

    $('export-json').addEventListener('click', () => exportAs('json'));
    $('export-csv').addEventListener('click', () => exportAs('csv'));
    $('delete-all').addEventListener('click', askDelete);
    $('confirm-export').addEventListener('click', () => exportAs('json'));
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close('cancel'); });
    dlg.addEventListener('close', () => { if (dlg.returnValue === 'delete') deleteAll(); });

    Ch.attachTooltip(document.body, $('tip'));
    if (self.ResizeObserver) {
      let lastW = 0;
      new ResizeObserver(() => {
        const w = $('chart').clientWidth;
        if (w && w !== lastW) { lastW = w; if (pane === 'chart') renderChart(); }
      }).observe($('chart'));
    }

    let pending = 0;
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      clearTimeout(pending);
      pending = setTimeout(async () => {
        await refresh();
        if (!savePending) fillForm(true); // a typed value is about to be saved: do not write the old one back over it
      }, 80);
    });
    // midnight rollover and pause expiry
    setInterval(() => {
      if (today() !== lastDay) refresh(); else renderPaused();
    }, 20000);
  }

  async function init() {
    K.hydrateIcons();
    // short accessible names for the switches; the helper text becomes the description
    document.querySelectorAll('.switch-row').forEach((row, i) => {
      const t = row.querySelector('.t');
      const s = row.querySelector('.s');
      const input = row.querySelector('input');
      t.id = 'sw-t' + i;
      input.setAttribute('aria-labelledby', t.id);
      if (s) { s.id = 'sw-s' + i; input.setAttribute('aria-describedby', s.id); }
    });
    buildHours();
    buildHeat();
    buildPerms();
    K.reveal([...document.querySelectorAll('#hero, .toolbar, .tiles, .chart-card, .grid-2 > .card, #patterns .sec-h, .heat-card, #limits .sec-h, .set, #privacy .sec-h, .privacy, .data-card')]);
    initWelcome();
    bind();
    initNav();
    try {
      await load();
    } catch (e) {
      console.error('Reel Meter: could not read storage', e);
    }
    renderAll();
    fillForm(false);
    document.body.classList.remove('is-loading');
    $('main').setAttribute('aria-busy', 'false');
    const id = location.hash.slice(1);
    if (SECTIONS.includes(id)) $(id).scrollIntoView({ block: 'start', behavior: 'instant' });
  }

  $('ver').textContent = '· v' + (chrome.runtime.getManifest().version || 'dev');
  init();
})();
