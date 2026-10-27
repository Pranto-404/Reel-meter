(function () {
  'use strict';
  const C = self.ReelCore;
  const K = self.ReelKit;
  const Ch = self.ReelCharts;
  const { setText, countTo } = K;
  const $ = (id) => document.getElementById(id);
  const fmtInt = (n) => Math.round(n).toLocaleString();

  let stats = {};
  let blockState = C.emptyBlockState();
  let settings = C.normalizeSettings();
  let ready = false;
  let wasPaused = null;
  const rows = K.platformRows($('plats'), C);

  async function load() {
    const o = await chrome.storage.local.get(['stats', 'settings', 'blockState']);
    stats = o.stats || {};
    settings = C.normalizeSettings(o.settings);
    blockState = C.normalizeBlockState(o.blockState);
    render();
  }

  function setMeter(meter, pct) {
    const fill = meter.firstElementChild;
    if (!meter.hasAttribute('data-init')) {
      meter.setAttribute('data-init', '1');
      fill.style.width = '0%';
      void fill.offsetWidth; // so the first fill sweeps in from empty
    }
    fill.style.width = pct + '%';
    meter.setAttribute('aria-valuenow', String(pct));
  }

  function render() {
    const today = C.dayKey(new Date());
    const day = C.getDay(stats, today);

    countTo($('today-reels'), day.r, fmtInt);
    setText($('today-unit'), day.r === 1 ? 'reel' : 'reels');
    countTo($('today-time'), day.s, C.formatDuration);

    const lim = C.evaluateLimits(settings, day);
    $('limit-block').hidden = !lim.hasLimit;
    $('nolimit').hidden = lim.hasLimit;
    if (lim.hasLimit) {
      const meter = $('limit-meter');
      meter.className = 'meter' + (lim.over ? ' over' : lim.near ? ' warn' : '');
      setMeter(meter, Math.min(100, Math.round(lim.pct * 100)));
      const bits = [];
      if (settings.dailyReelLimit) bits.push(fmtInt(day.r) + ' of ' + fmtInt(settings.dailyReelLimit) + ' reels');
      if (settings.dailyMinuteLimit) bits.push(Math.round(day.s / 60) + ' of ' + settings.dailyMinuteLimit + ' min');
      setText($('limit-text'), bits.join(' · '));
      const byReels = settings.dailyReelLimit > 0 && (settings.dailyMinuteLimit <= 0 || lim.reelsPct >= lim.minsPct);
      const left = byReels ? settings.dailyReelLimit - day.r : Math.round(settings.dailyMinuteLimit - day.s / 60);
      const unit = (n) => (byReels ? n + (n === 1 ? ' reel' : ' reels') : n + ' min');
      setText($('limit-left'), lim.over ? (left === 0 ? 'Limit reached' : 'Over by ' + unit(Math.abs(left))) : unit(left) + ' left');
    }

    rows.update(day.p, 'r');
    const never = !Object.keys(stats).some((k) => stats[k] && (stats[k].r || stats[k].s));
    $('plat-hint').hidden = !never;
    $('plats').hidden = never; // four empty rows tell a new user nothing; the hint says what to do
    if (never) {
      setText($('plat-hint'), 'Nothing counted yet. Open a reel on YouTube, Instagram, TikTok or Facebook. Refresh tabs that were already open first.');
    }

    const week = C.rangeDays(stats, today, 7);
    const wt = C.sumDays(week);
    setText($('week-sub'), fmtInt(wt.r) + (wt.r === 1 ? ' reel' : ' reels') + ' · ' + C.formatDuration(wt.s));
    Ch.columns($('week'), week, { metric: 'r', height: 86, valueLabels: true });

    renderPause();
    renderFocus(day);
    if (!ready) {
      ready = true;
      document.body.classList.remove('is-loading');
      $('main').setAttribute('aria-busy', 'false');
    }
  }

  // ------------------------------------------------------------------ pause

  function remaining(ms) {
    const mins = Math.ceil(ms / 60000);
    if (mins <= 1) return 'under a minute';
    if (mins < 60) return mins + ' more min';
    const hrs = Math.floor(mins / 60);
    const m = mins % 60;
    return hrs + ' h' + (m ? ' ' + m + ' min' : '') + ' more';
  }

  function renderPause() {
    const left = settings.snoozeUntil - Date.now();
    const paused = left > 0;
    $('pause-opts').setAttribute('data-open', String(!paused));
    $('pause-active').setAttribute('data-open', String(paused));
    const status = $('status');
    status.setAttribute('data-state', paused ? 'paused' : 'on');
    status.className = 'chip ' + (paused ? 'warn' : 'good');
    setText($('status-t'), paused ? 'Paused' : 'Tracking');
    if (paused) {
      setText($('pause-t'), left < 90000 ? 'Paused for under a minute' : 'Paused for ' + remaining(left));
      setText($('pause-sub'), 'Back on at ' + new Date(settings.snoozeUntil).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
    }
    if (wasPaused !== null && wasPaused !== paused) {
      setText($('pause-live'), paused ? 'Tracking paused. ' + $('pause-t').textContent : 'Tracking resumed.');
    }
    wasPaused = paused;
    // with a hard daily limit reels are always counted, so a pause would be a way around it
    const hard = settings.block.hardLimit;
    $('pause-opts').querySelectorAll('button').forEach((b) => { b.disabled = hard; b.title = hard ? 'Pausing is off while the hard daily limit is on' : ''; });
  }

  async function setSnooze(until) {
    const o = await chrome.storage.local.get('settings');
    const next = Object.assign(C.normalizeSettings(o.settings), { snoozeUntil: until });
    if (until > Date.now() && next.block.hardLimit) return; // see renderPause
    await chrome.storage.local.set({ settings: next });
  }

  $('pause-opts').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-mins]');
    if (!b) return;
    let until;
    if (b.dataset.mins === 'day') {
      const d = new Date();
      d.setHours(24, 0, 0, 0);
      until = d.getTime();
    } else {
      until = Date.now() + Number(b.dataset.mins) * 60000;
    }
    setSnooze(until);
  });
  $('resume').addEventListener('click', () => setSnooze(0));

  // ------------------------------------------------------------------ focus

  /** Change a line of text with a short fade, so a changing state reads as a change and not a flicker. */
  function swapText(el, text) {
    if (el.textContent === text) return;
    el.textContent = text;
    if (K.reduced() || !ready) return;
    el.classList.remove('swap');
    void el.offsetWidth;
    el.classList.add('swap');
  }

  function renderFocus(day) {
    const now = Date.now();
    const e = C.withBlockState(settings, blockState);
    const lim = C.evaluateLimits(settings, day || C.getDay(stats, C.dayKey(new Date())));
    const names = (list) => list.map((q) => C.PLATFORMS[q].label.split(' ')[0]).join(', ');
    const locked = C.PLATFORM_ORDER.filter((q) => blockState.lockUntil[q] > now);
    const focus = C.PLATFORM_ORDER.filter((q) => blockState.focus[q] > now);
    const breaks = C.PLATFORM_ORDER.filter((q) => blockState.breaks[q] > now);
    let text = 'Block reels on all four sites for a while. Each press adds time.';
    let tone = 'idle'; // what the little chip says: off, focus on, on a break, locked, or blocking for another reason
    let chip = 'Off';
    if (locked.length) {
      text = names(locked) + ' locked until ' + C.formatClock(Math.max.apply(null, locked.map((q) => blockState.lockUntil[q]))) + ' (unblocked too often).';
      tone = 'lock'; chip = 'Locked';
    } else if (focus.length) {
      const leftText = C.formatLeft(Math.max.apply(null, focus.map((q) => blockState.focus[q])) - now);
      text = 'Focus is on for ' + names(focus) + ' (' + leftText + '). Each press adds time.';
      tone = 'focus'; chip = leftText;
    } else if (breaks.length) {
      text = 'On a break: ' + names(breaks) + '. It ends by itself.';
      tone = 'break'; chip = 'On a break';
    } else if (C.blockActiveNow(e, now, lim.over)) {
      text = 'Reels are blocked right now (schedule, limit or blocked app). Manage it in the dashboard.';
      tone = 'blocking'; chip = 'Blocking';
    }
    const card = $('focus-card');
    if (card.getAttribute('data-tone') !== tone) card.setAttribute('data-tone', tone);
    swapText($('focus-sub'), text);
    swapText($('focus-chip-t'), chip);
  }

  $('focus-btns').addEventListener('click', (ev) => {
    const btn = ev.target.closest('button[data-mins]');
    if (!btn) return;
    // the background worker owns the running block state and adds the time (ending any break on those apps)
    btn.classList.remove('sent');
    void btn.offsetWidth;
    btn.classList.add('sent'); // a short confirming pulse; the card below changes as soon as the worker has saved
    setTimeout(() => btn.classList.remove('sent'), 900);
    chrome.runtime.sendMessage({ type: 'focus', platforms: C.PLATFORM_ORDER, minutes: Number(btn.dataset.mins) }, () => { void chrome.runtime.lastError; });
  });

  // ------------------------------------------------------------- navigation

  $('open-dash').addEventListener('click', () => { chrome.runtime.openOptionsPage(); window.close(); });
  function openLimits() {
    const url = chrome.runtime.getURL ? chrome.runtime.getURL('src/ui/dashboard.html#limits') : '';
    if (url && chrome.tabs && chrome.tabs.create) chrome.tabs.create({ url });
    else chrome.runtime.openOptionsPage();
    window.close();
  }
  $('open-settings').addEventListener('click', openLimits);
  $('set-limit').addEventListener('click', openLimits);

  K.hydrateIcons();
  Ch.attachTooltip(document.body, $('tip'));
  chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local') load(); });
  setInterval(() => { renderPause(); renderFocus(); }, 15000);
  load();
  document.getElementById('ver').textContent = '· v' + (chrome.runtime.getManifest().version || 'dev');
})();
