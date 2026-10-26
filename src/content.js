/*
 * Reel Meter - content script.
 *
 * Runs on YouTube, Instagram, TikTok and Facebook. Once a second it asks three
 * questions: am I on a short-video page, is a video on screen and playing, and
 * has the user touched the page recently. It never reads page text, titles,
 * comments, accounts or pixels, and it sends nothing but
 * "platform, seconds, reels" to the extension's own background worker.
 */
(function () {
  'use strict';

  const C = self.ReelCore;
  if (!C || window.top !== window) return;

  const TICK_MS = 1000;
  const FLUSH_MS = 5000;
  const TOAST_MS = 9000;
  const NOTE_MS = 7000;
  const PAUSE_SECONDS = 10;
  const REVEAL_MS = 1500; // how long the island waits for the reel to be laid out before it settles for the window centre

  let settings = C.normalizeSettings();
  const tracker = new C.ReelTracker(settings);

  let lastInputAt = Date.now();
  let pendingMs = 0;
  let pendingReels = 0;
  let inflightSeconds = 0;
  let inflightReels = 0;
  let lastFlushAt = Date.now();
  let activePlatform = null;
  let onReelPage = false;
  let counting = false;
  let totals = { r: 0, s: 0 };
  let extra = { streak: 0, limits: { reels: 0, mins: 0 } };
  let over = false;
  let hiddenByUser = false;
  let dead = false;
  let timer = 0;
  let settingsReady = false; // nothing is drawn until the stored settings have arrived, so it never jumps afterwards
  let wasSnoozed = false;
  let blocked = null; // the block status while the block screen is up, else null
  let overDay = ''; // the day `over` was last confirmed by the worker (it resets at midnight)
  let blockState = C.emptyBlockState(); // running block state: focus timers, breaks, unblocks, lockouts (per app)
  let onBreak = null; // the block status while THIS app is on a break, else null
  let pendingNote = null; // a message for the island once it is on screen again

  // ------------------------------------------------------------- observations

  const bump = () => { lastInputAt = Date.now(); };
  ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'touchmove', 'scroll'].forEach((t) =>
    window.addEventListener(t, bump, { capture: true, passive: true })
  );

  const videoIds = new WeakMap();
  let nextVideoId = 1;
  function videoKey(v) {
    if (!videoIds.has(v)) videoIds.set(v, nextVideoId++);
    return videoIds.get(v) + ':' + (v.currentSrc || v.src || '');
  }

  function visibleRatio(v) {
    const r = v.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = Math.min(r.right, vw) - Math.max(r.left, 0);
    const h = Math.min(r.bottom, vh) - Math.max(r.top, 0);
    const area = r.width * r.height;
    if (w <= 0 || h <= 0 || !area) return 0;
    return (w * h) / Math.min(area, vw * vh);
  }

  /** The video that dominates the viewport, preferring one that is playing. */
  function pickVideo() {
    let best = null;
    let bestScore = 0;
    for (const v of document.querySelectorAll('video')) {
      const ratio = visibleRatio(v);
      if (ratio < 0.5) continue;
      const score = ratio + (!v.paused && !v.ended ? 1 : 0);
      if (score > bestScore) {
        best = v;
        bestScore = score;
      }
    }
    return best;
  }

  function snapshot(now) {
    const hard = settings.block.hardLimit; // a hard daily limit counts regardless of the pause and the "Apps to track" switches
    if (blocked || (settings.snoozeUntil > now && !hard)) return null; // a blocked page is not watched, so nothing is counted
    const cls = C.classify(location.hostname, location.pathname);
    if (!cls || (!settings.platforms[cls.platform] && !hard)) return null;
    const v = pickVideo();
    const playing = !!v && !v.paused && !v.ended && v.readyState >= 2;
    const key = cls.id ? cls.platform + ':' + cls.id : cls.feed && v ? 'v:' + videoKey(v) : null;
    return {
      platform: cls.platform,
      key,
      playing,
      visible: document.visibilityState === 'visible',
      lastInputAt,
    };
  }

  // ----------------------------------------------------------------- messaging

  function shutdown() {
    dead = true;
    clearInterval(timer);
    if (blocked) ui.orphanBlock(); // keep a running block up and ask for a reload; anything else just goes away
    else ui.destroy();
  }

  function send(msg, done) {
    try {
      chrome.runtime.sendMessage(msg, (resp) => {
        if (chrome.runtime.lastError) {
          if (/context invalidated/i.test(chrome.runtime.lastError.message || '')) shutdown();
          else if (done) done(null, chrome.runtime.lastError.message);
          return;
        }
        if (done) done(resp);
      });
    } catch (e) {
      shutdown(); // extension was reloaded or updated: this copy of the script is orphaned
    }
  }

  function flush() {
    lastFlushAt = Date.now();
    const seconds = Math.floor(pendingMs / 1000);
    if (!activePlatform || (seconds <= 0 && pendingReels <= 0)) return;
    const reels = pendingReels;
    pendingMs -= seconds * 1000;
    pendingReels = 0;
    inflightSeconds += seconds; // still shown on screen until the worker confirms
    inflightReels += reels;
    send({ type: 'flush', platform: activePlatform, seconds, reels }, (resp) => {
      inflightSeconds -= seconds;
      inflightReels -= reels;
      if (!resp) {
        pendingMs += seconds * 1000; // worker was asleep or busy: try again next time
        pendingReels += reels;
        return;
      }
      onResponse(resp);
    });
  }

  function onResponse(resp) {
    // The worker's totals already include what we sent; only unsent time is added on top.
    takeServerState(resp);
    applyGreyscale();
    checkBlock();
    render();
    // with the hard limit on, reaching the limit blocks the page, so the breathing pause is not shown as well
    if (resp.nudge && !(resp.nudge.pause && settings.block.hardLimit)) ui.nudge(resp.nudge, resp);
  }

  function takeServerState(resp) {
    totals = resp.today;
    over = !!resp.over;
    overDay = C.dayKey(new Date());
    extra = { streak: resp.streak || 0, limits: resp.limits || extra.limits };
  }

  // --------------------------------------------------------------------- loop

  /** After the extension is reloaded or updated, this copy of the script is orphaned: its chrome.* calls fail. */
  function orphaned() {
    try { return !chrome.runtime || !chrome.runtime.id; } catch (e) { return true; }
  }

  function tick() {
    if (dead) return;
    if (orphaned()) { shutdown(); return; }
    checkBlock();
    const now = Date.now();
    const snap = snapshot(now);
    const res = tracker.tick(now, snap);
    onReelPage = !!(snap && snap.key);
    counting = res.active;
    if (snap) activePlatform = snap.platform;
    if (res.addMs) pendingMs += res.addMs;
    if (res.newReel) pendingReels += 1;
    if (pendingReels > 0 || now - lastFlushAt >= FLUSH_MS) flush();
    render();
  }

  function render() {
    if (dead || !settingsReady) return;
    const now = Date.now();
    const snoozed = settings.snoozeUntil > now && !settings.block.hardLimit; // no pausing while a hard daily limit is on
    const resumed = wasSnoozed && !snoozed; // the pause ended: by the clock, from the popup or from the island
    wasSnoozed = snoozed;
    if (resumed) applyGreyscale();
    const show = settings.showCounter && !hiddenByUser && !blocked && (onReelPage || (snoozed && isSupportedPage()));
    if (!show) {
      ui.setIsland(null);
      return;
    }
    const reels = totals.r + pendingReels + inflightReels;
    const secs = totals.s + inflightSeconds + Math.floor(pendingMs / 1000);
    const l = extra.limits;
    const pct = Math.max(l.reels > 0 ? reels / l.reels : 0, l.mins > 0 ? secs / 60 / l.mins : 0);
    ui.setIsland({
      paused: snoozed,
      until: settings.snoozeUntil,
      now,
      active: counting && !snoozed,
      reels,
      secs,
      pct,
      over: over || pct >= 1,
      near: pct >= 0.8 && pct < 1,
      streak: extra.streak,
      limits: l,
      hard: settings.block.hardLimit,
      onBreak: onBreak ? { until: onBreak.until } : null,
    });
    if (resumed) ui.note('Tracking resumed', 3500);
    if (pendingNote) { ui.note(pendingNote.text, pendingNote.ms); pendingNote = null; }
  }

  /** Pause (until > now) or resume (0) from the island. The island changes at once; the popup follows through storage. */
  function setSnooze(until) {
    if (dead) return;
    if (until > Date.now() && settings.block.hardLimit) { ui.note('Pausing is off while the hard daily limit is on', 5000); return; }
    if (until > Date.now()) flush(); // send what was counted so far, before the worker starts dropping updates
    settings = Object.assign({}, settings, { snoozeUntil: until });
    if (until > Date.now()) tracker.reset();
    tick();
    try {
      chrome.storage.local.get('settings').then((o) =>
        chrome.storage.local.set({ settings: Object.assign(C.normalizeSettings(o.settings), { snoozeUntil: until }) })
      ).catch(() => {});
    } catch (e) {
      shutdown(); // extension reloaded
    }
  }

  function isSupportedPage() {
    return !!C.classify(location.hostname, location.pathname);
  }

  // ----------------------------------------------------------------- blocking

  /** Settings with the running block state merged in: what every block decision looks at. */
  function eff() {
    return C.withBlockState(settings, blockState, Date.now());
  }

  /** The app this page belongs to, even on pages that are not reel pages. */
  function pagePlatform() {
    return C.platformOfHost(location.hostname);
  }

  /**
   * Decide what this page should be: shown, replaced by the block screen, or (YouTube Shorts as normal videos)
   * moved to the ordinary watch page. Runs every 300 ms, so a swipe to a new address is caught at once.
   * Blocking ignores the tracking pause on purpose: pausing the counter must not switch the block off.
   * Every decision is for THIS app only: a break or a focus timer on one app never touches another.
   */
  function checkBlock() {
    if (dead || !settingsReady) return;
    const now = Date.now();
    const dk = C.dayKey(new Date(now));
    if (overDay && dk !== overDay) {
      overDay = dk; // a new day: the limit starts again, ask the worker for today's numbers
      over = false;
      send({ type: 'peek' }, (resp) => { if (resp) { takeServerState(resp); checkBlock(); render(); } });
    }
    const cls = C.classify(location.hostname, location.pathname);
    const st = C.blockStatus(eff(), { now, cls, limitOver: over });
    onBreak = st.onBreak ? st : null;
    if (st.action === 'redirect') {
      location.replace(location.origin + st.url);
      return;
    }
    if (st.action === 'block') {
      const first = !blocked;
      blocked = st;
      ui.showBlock(st, cls);
      if (first) { tracker.reset(); render(); }
    } else if (blocked) {
      blocked = null;
      ui.hideBlock();
      tracker.reset();
      tick();
    }
  }

  /**
   * Ask the background worker to change the block state (focus, break, unblock). It checks the rules again on its
   * side and answers with the new state, which is applied here at once. `done` gets { ok, why, ... }.
   */
  function blockRequest(msg, done) {
    send(msg, (resp, err) => {
      const r = resp || { ok: false, why: 'error', detail: String(err || 'no reply').slice(0, 100) };
      if (r.ok && r.state) {
        blockState = C.normalizeBlockState(r.state);
        checkBlock();
        render();
      }
      if (done) done(r);
    });
  }

  /** Focus timer from the island: reels are blocked on THIS app for the next `minutes`. */
  function startFocus(minutes) {
    blockRequest({ type: 'focus', platform: pagePlatform(), minutes });
  }

  /** "Block now": end this app's break early. */
  function endBreak() {
    blockRequest({ type: 'end-break', platform: pagePlatform() });
  }

  function applyGreyscale() {
    const on = over && settings.greyscaleOverLimit && settings.snoozeUntil <= Date.now();
    document.documentElement.style.filter = on ? 'grayscale(1)' : '';
  }

  // ---------------------------------------------------------------------- UI
  // Everything lives in a shadow root so the site's CSS cannot touch it and ours cannot touch the site.
  // The counter is a small "island": a black pill that floats at the top of the reel, springs wider when
  // you tap it or when it has something to say, and goes back to its compact size on its own.

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }

    .isl {
      --w: 140px; --glow: rgba(255,255,255,.12);
      /* left/top are set by place(); the island is anchored by its centre (or right edge) through "translate",
         so when its width springs open it grows around that point and never drifts. No transition on left/top. */
      position: fixed; left: 0; top: 0; z-index: 2147483646; width: var(--w); max-width: calc(100vw - 16px);
      background: #000; color: #fff; border-radius: 18px; overflow: hidden;
      box-shadow: inset 0 0 0 1px var(--glow), 0 8px 24px rgba(0,0,0,.45);
      font-size: 13px; line-height: 18px; font-weight: 600; user-select: none; touch-action: none; cursor: grab;
      transform-origin: 50% 0;
    }
    [hidden] { display: none !important; }
    .isl.enter { animation: enter .45s cubic-bezier(.2,.9,.25,1.25) both; }
    .isl.ready { transition: width .42s cubic-bezier(.2,.9,.25,1.15), border-radius .3s ease, box-shadow .3s ease; }
    .isl.drag { transition: width .42s cubic-bezier(.2,.9,.25,1.15); cursor: grabbing; }
    .isl.expanded, .isl.noting { border-radius: 24px; }
    .isl.near { --glow: rgba(250,178,25,.65); }
    .isl.over { --glow: rgba(255,84,84,.8); box-shadow: inset 0 0 0 1px var(--glow), 0 0 22px rgba(255,70,70,.35), 0 8px 24px rgba(0,0,0,.45); }
    .isl.bump { animation: bump .45s cubic-bezier(.2,.9,.25,1.25); }

    .bar { display: flex; align-items: center; gap: 8px; height: 34px; padding: 0 14px; width: max-content; margin: 0 auto; }
    /* live indicator: three bars that dance while a reel is being counted, sit still when idle */
    .eq { display: flex; align-items: center; gap: 2px; height: 14px; flex: none; }
    .eq i { display: block; width: 3px; height: 4px; border-radius: 2px; background: #6b6b66; transition: background .3s; }
    .isl.active .eq i { background: #34d399; animation: eq 0.9s ease-in-out infinite; }
    .isl.active .eq i:nth-child(2) { animation-delay: -.3s; }
    .isl.active .eq i:nth-child(3) { animation-delay: -.6s; }
    .isl.near .eq i { background: #fab219; }
    .isl.over .eq i { background: #ff5454; }
    /* paused: the three bars become a pause symbol */
    .isl.paused .eq { gap: 3px; }
    .isl.paused .eq i { background: #fab219; height: 12px; animation: none; }
    .isl.paused .eq i:nth-child(3) { display: none; }
    .isl.paused .time { color: #a8a7a0; font-weight: 500; }
    .resume {
      flex: none; font: inherit; font-size: 12px; font-weight: 700; line-height: 18px; cursor: pointer;
      border: 0; border-radius: 999px; padding: 3px 11px; margin: 0 -6px 0 2px; background: #fff; color: #000;
      transition: background .15s, transform .15s;
    }
    .resume:hover { background: #e2e1dc; }
    .resume:active { transform: scale(.94); }
    .isl.narrow .bar { gap: 6px; padding: 0 10px; }
    .isl.narrow .sep, .isl.narrow .time { display: none; }
    .isl.active:not(.near):not(.over):not(.bump):not(.enter):not(.onbreak) { animation: glow 3.2s ease-in-out infinite; }
    .isl.milestone .bar { animation: sweep 1.1s ease-out; background-image: linear-gradient(100deg, transparent 30%, rgba(255,255,255,.28) 50%, transparent 70%); background-size: 250% 100%; background-repeat: no-repeat; }
    .num { position: relative; display: inline-block; height: 18px; overflow: hidden; font-variant-numeric: tabular-nums; }
    .num span { display: block; }
    .num span.out { position: absolute; left: 0; top: 0; animation: rollout .3s ease-in forwards; }
    .num span.in { animation: rollin .34s cubic-bezier(.2,.9,.25,1.2); }
    .unit { color: #a8a7a0; font-weight: 500; }
    .sep { width: 1px; height: 12px; background: rgba(255,255,255,.22); }
    .time { color: #e9e8e4; }

    .meter { position: absolute; left: 18px; right: 18px; bottom: 3px; height: 2px; border-radius: 2px; background: rgba(255,255,255,.14); overflow: hidden; opacity: 0; transition: opacity .3s; }
    .isl.has-limit .meter { opacity: 1; }
    .isl.expanded .meter { opacity: 0; }
    .meter i { display: block; height: 100%; width: 0; border-radius: 2px; background: #4f9bf0; transition: width .5s ease, background .3s; }
    .isl.near .meter i { background: #fab219; }
    .isl.over .meter i { background: #ff5454; }

    .fold { display: grid; grid-template-rows: 0fr; transition: grid-template-rows .4s cubic-bezier(.2,.9,.25,1); }
    .fold > .in { overflow: hidden; min-height: 0; }
    .isl.noting .note-fold, .isl.expanded .more-fold { grid-template-rows: 1fr; }
    .note { padding: 2px 16px 12px; color: #e9e8e4; font-weight: 500; font-size: 13px; line-height: 18px; text-align: center; }
    .more { padding: 4px 16px 14px; display: grid; gap: 12px; }
    .big { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
    .big b { font-size: 26px; line-height: 30px; font-weight: 700; letter-spacing: -.02em; }
    .big span { color: #a8a7a0; font-weight: 500; }
    .lim { display: grid; gap: 6px; }
    .lim[hidden], .chip[hidden] { display: none; }
    .track { height: 6px; border-radius: 3px; background: rgba(255,255,255,.14); overflow: hidden; }
    .track i { display: block; height: 100%; width: 0; border-radius: 3px; background: #4f9bf0; transition: width .5s ease, background .3s; }
    .isl.near .track i { background: #fab219; }
    .isl.over .track i { background: #ff5454; }
    .lim small, .chip { color: #a8a7a0; font-size: 12px; font-weight: 500; }
    .pinfo { color: #e9e8e4; font-weight: 500; font-size: 13px; line-height: 18px; }
    .actions { display: flex; flex-wrap: wrap; gap: 8px; }
    .isl.paused .actions button { flex: 1 1 calc(50% - 4px); }
    .actions button.primary { background: #2a78d6; border-color: #2a78d6; }
    .actions button.primary:hover { background: #3987e5; }
    .actions button, .toast button, .pause button {
      font: inherit; font-size: 12px; font-weight: 600; cursor: pointer; border-radius: 999px;
      padding: 6px 12px; border: 1px solid rgba(255,255,255,.22); background: rgba(255,255,255,.06); color: inherit;
      transition: background .15s, transform .15s;
    }
    .actions button { flex: 1; white-space: nowrap; padding: 6px 8px; }
    .actions button:hover, .toast button:hover, .pause button:hover:not(:disabled) { background: rgba(255,255,255,.16); }
    .actions button:active { transform: scale(.96); }
    button:focus-visible { outline: 2px solid #4f9bf0; outline-offset: 2px; }

    .toast {
      position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); z-index: 2147483647;
      max-width: min(420px, calc(100vw - 32px)); padding: 12px 14px; border-radius: 16px;
      background: #000; color: #f0efec; font-size: 14px; line-height: 20px;
      border: 1px solid rgba(255,255,255,.14); box-shadow: 0 6px 24px rgba(0,0,0,.4);
      display: flex; gap: 12px; align-items: center;
    }
    .pause {
      position: fixed; inset: 0; z-index: 2147483647; display: flex; flex-direction: column; gap: 18px;
      align-items: center; justify-content: center; text-align: center; padding: 24px;
      background: rgba(13,13,13,.92); color: #f0efec; backdrop-filter: blur(10px);
    }
    .pause h2 { margin: 0; font-size: 22px; font-weight: 650; }
    .pause p { margin: 0; font-size: 15px; color: #c3c2b7; max-width: 380px; }
    .orb {
      width: 96px; height: 96px; border-radius: 50%; background: #2a78d6; opacity: .85;
      animation: breathe 8s ease-in-out infinite;
    }
    .row { display: flex; gap: 10px; flex-wrap: wrap; justify-content: center; }
    .pause button { font-size: 13px; padding: 8px 16px; }
    .pause button:disabled { opacity: .45; cursor: default; }
    .pause button.primary { background: #2a78d6; border-color: #2a78d6; }
    .pause button.primary:hover:not(:disabled) { background: #3987e5; }

    /* ------------------------------------------------------------------------------------------------
       The block screen: replaces a reel page while a block is on. Dark on purpose (calm, no glare).
       Variants: default (blue and teal), .v-lock (lockout: muted amber), .v-strict (Full restriction, cannot be unblocked: indigo).
       Only transform and opacity are animated while it sits there; nothing here moves or resizes once it has settled.
       ------------------------------------------------------------------------------------------------ */
    .block, .bsplash {
      --bg: #0a0b0d; --fg: #f1f0ec; --mute: #b6b5ad; --dim: #94938c;
      --acc: #6aa8f5; --acc-rgb: 106,168,245; --acc2-rgb: 79,209,181; --g1: #2563c9; --g2: #0e7c86;
    }
    .block.v-lock, .bsplash.v-lock { --bg: #0e0b0a; --acc: #f0b36a; --acc-rgb: 240,179,106; --acc2-rgb: 224,120,104; --g1: #a8571a; --g2: #8c3b34; }
    .block.v-strict, .bsplash.v-strict { --bg: #0a0a11; --acc: #aeadff; --acc-rgb: 174,173,255; --acc2-rgb: 110,160,255; --g1: #4b49c9; --g2: #2f6bc4; }
    .block {
      position: fixed; inset: 0; z-index: 2147483647; display: flex; padding: 24px; isolation: isolate;
      background: var(--bg); color: var(--fg); overflow-x: hidden; overflow-y: auto; -webkit-text-size-adjust: 100%;
      animation: bfade .35s ease-out backwards;
    }
    .aura { position: fixed; inset: 0; z-index: -1; overflow: hidden; pointer-events: none; }
    .aura i { position: absolute; width: 72vmax; height: 72vmax; border-radius: 50%; will-change: transform; }
    .aura i:nth-child(1) { left: -28vmax; top: -34vmax; background: radial-gradient(closest-side, rgba(var(--acc-rgb), .2), rgba(var(--acc-rgb), 0)); animation: drift1 24s ease-in-out infinite alternate; }
    .aura i:nth-child(2) { right: -34vmax; bottom: -40vmax; background: radial-gradient(closest-side, rgba(var(--acc2-rgb), .15), rgba(var(--acc2-rgb), 0)); animation: drift2 30s ease-in-out infinite alternate; }
    .bcard { position: relative; width: min(440px, 100%); margin: auto; display: grid; gap: 14px; justify-items: center; text-align: center; padding: 8px 0; animation: cardin .55s cubic-bezier(.2,.85,.25,1) backwards; transition: gap .4s cubic-bezier(.2,.85,.25,1); }
    .bcard.fopen { gap: 10px; }
    .bcard > * { animation: rise .38s cubic-bezier(.2,.85,.25,1) backwards; animation-delay: calc(var(--i, 0) * 30ms); }
    .block h2 { margin: 0; font-size: 28px; line-height: 34px; font-weight: 700; letter-spacing: -.015em; text-wrap: balance; }
    .block p { margin: 0; font-size: 16px; line-height: 24px; color: var(--mute); text-wrap: pretty; }

    .lock { position: relative; width: 68px; height: 68px; border-radius: 22px; display: grid; place-items: center; color: var(--acc);
      background: linear-gradient(150deg, rgba(var(--acc-rgb), .22), rgba(var(--acc-rgb), .06));
      box-shadow: inset 0 0 0 1px rgba(var(--acc-rgb), .34), 0 12px 32px rgba(var(--acc-rgb), .16); }
    .lock::before, .lock::after { content: ""; position: absolute; inset: 0; border-radius: inherit; box-shadow: 0 0 0 1.5px rgba(var(--acc-rgb), .55); opacity: 0; animation: halo 3.8s ease-out infinite; }
    .lock::after { animation-delay: 1.9s; }
    .block.v-strict .lock { border-radius: 50%; box-shadow: inset 0 0 0 1px rgba(var(--acc-rgb), .4), 0 0 0 7px rgba(var(--acc-rgb), .07), 0 0 0 8px rgba(var(--acc-rgb), .22), 0 12px 32px rgba(var(--acc-rgb), .16); }
    .lock { transition: width .4s cubic-bezier(.2,.85,.25,1), height .4s cubic-bezier(.2,.85,.25,1); }
    .bcard.fopen .lock { width: 48px; height: 48px; }
    .lock svg { transition: width .4s cubic-bezier(.2,.85,.25,1), height .4s cubic-bezier(.2,.85,.25,1); }
    .bcard.fopen .lock svg { width: 22px; height: 22px; }
    .lock svg { width: 30px; height: 30px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; overflow: visible; }
    .lock .shackle { transform-box: fill-box; transform-origin: 50% 100%; animation: shackle 7s ease-in-out infinite; }
    .lock .keyhole { fill: currentColor; stroke: none; }

    .btag { font-size: 12px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--acc); padding: 4px 12px; border-radius: 999px; background: rgba(var(--acc-rgb), .1); border: 1px solid rgba(var(--acc-rgb), .3); }
    .block p.bleft { display: inline-flex; align-items: center; justify-content: center; gap: 9px; min-width: 112px; padding: 6px 16px; border-radius: 999px; font-size: 15px; line-height: 22px; font-weight: 650; color: var(--fg);
      font-variant-numeric: tabular-nums; background: rgba(var(--acc-rgb), .1); border: 1px solid rgba(var(--acc-rgb), .28); }
    .bleft::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: var(--acc); flex: none; animation: dotpulse 2.4s ease-in-out infinite; }
    .block.v-lock p.bleft { font-size: 32px; line-height: 40px; font-weight: 700; letter-spacing: -.01em; min-width: 220px; padding: 10px 26px; gap: 14px; color: #fbe3bf; }
    .block.v-lock .bleft::before { width: 10px; height: 10px; }

    .bnudge { display: flex; align-items: flex-start; justify-content: center; min-height: 46px; max-width: 34ch; }
    .block p.bnudgep { font-size: 14px; line-height: 21px; color: var(--mute); }
    .bnudgep.rot { animation: textin .8s ease backwards; }
    .fd { width: 100%; display: grid; grid-template-rows: 1fr; justify-items: center; transition: grid-template-rows .4s cubic-bezier(.2,.85,.25,1), opacity .3s ease, margin .4s cubic-bezier(.2,.85,.25,1); }
    .fd > .fi { min-height: 0; overflow: hidden; display: grid; justify-items: center; width: 100%; }
    .bcard.fopen .fd.fold-on-open { grid-template-rows: 0fr; opacity: 0; margin-top: -10px; }

    .bnotice { display: flex; gap: 10px; align-items: flex-start; text-align: left; max-width: 390px; padding: 12px 15px; border-radius: 14px;
      background: rgba(var(--acc-rgb), .08); border: 1px solid rgba(var(--acc-rgb), .26); }
    .bnotice svg { flex: none; width: 18px; height: 18px; margin-top: 2px; color: var(--acc); fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
    .block .bnotice p.bfixed { font-size: 14px; line-height: 21px; color: #ebe9e3; }

    .bacts { width: 100%; display: grid; gap: 10px; justify-items: center; margin-top: 6px; }
    .block button {
      font: inherit; font-size: 15px; font-weight: 600; cursor: pointer; border-radius: 999px; min-height: 48px; padding: 0 22px;
      display: inline-flex; align-items: center; justify-content: center; gap: 9px; text-align: center; -webkit-tap-highlight-color: transparent;
      border: 1px solid rgba(255,255,255,.24); background: rgba(255,255,255,.05); color: var(--fg);
      transition: background-color .18s, border-color .18s, transform .18s, box-shadow .25s, opacity .2s, color .2s;
    }
    .block button:hover:not(:disabled) { background: rgba(255,255,255,.12); border-color: rgba(255,255,255,.36); }
    .block button:active:not(:disabled) { transform: scale(.97); }
    .block button:disabled { opacity: .5; cursor: default; }
    .block button:focus-visible { outline: 2px solid var(--acc); outline-offset: 3px; }
    .block button svg { width: 18px; height: 18px; flex: none; fill: none; stroke: currentColor; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; transition: transform .25s cubic-bezier(.2,.85,.25,1); }
    .bacts button { width: 100%; max-width: 340px; }
    .block button.go {
      position: relative; overflow: hidden; min-height: 58px; font-size: 17px; font-weight: 700; border: 0; color: #fff;
      background: linear-gradient(135deg, var(--g1), var(--g2)); box-shadow: 0 12px 30px rgba(var(--acc-rgb), .26), inset 0 1px 0 rgba(255,255,255,.2);
    }
    .block button.go:hover:not(:disabled) { background: linear-gradient(135deg, var(--g1), var(--g2)); transform: translateY(-1px); box-shadow: 0 16px 36px rgba(var(--acc-rgb), .36), inset 0 1px 0 rgba(255,255,255,.24); }
    .block button.go:hover svg { transform: translateX(4px); }
    .block button.go::after { content: ""; position: absolute; inset: 0; background: linear-gradient(105deg, transparent 38%, rgba(255,255,255,.24) 50%, transparent 62%); transform: translateX(-130%); animation: shine 6s ease-in-out 1.4s infinite; pointer-events: none; }
    .block button.go:focus-visible { outline-color: #fff; outline-offset: 3px; }
    .block button.blink {
      border: 0; background: none; min-height: 44px; padding: 0 14px; margin-top: 2px; font-size: 14px; font-weight: 500; color: var(--mute);
      text-decoration: underline; text-underline-offset: 3px; text-decoration-color: rgba(255,255,255,.3); max-height: 60px; overflow: hidden;
      transition: color .2s, opacity .3s ease, max-height .4s cubic-bezier(.2,.85,.25,1), margin .4s cubic-bezier(.2,.85,.25,1), visibility 0s;
    }
    .block button.blink:hover:not(:disabled) { background: none; color: var(--fg); }
    /* hidden by the code (the hook), but kept in the layout while it folds away so nothing jumps */
    .block button.blink[hidden] { display: inline-flex !important; visibility: hidden; opacity: 0; max-height: 0; min-height: 0; margin-top: -14px; padding-top: 0; padding-bottom: 0; pointer-events: none; transition: color .2s, opacity .25s ease, max-height .4s cubic-bezier(.2,.85,.25,1), margin .4s cubic-bezier(.2,.85,.25,1), visibility 0s linear .4s; }

    .bpips { display: grid; gap: 9px; justify-items: center; }
    .pips { display: flex; gap: 11px; justify-content: center; margin: 2px 0 0; }
    .pips i { position: relative; display: block; width: 14px; height: 14px; border-radius: 50%; background: rgba(255,255,255,.1); box-shadow: inset 0 0 0 1.5px rgba(255,255,255,.22);
      animation: pipin .45s cubic-bezier(.3,1.6,.5,1) backwards; animation-delay: calc(var(--k, 0) * 70ms + 220ms); transition: background-color .3s, box-shadow .3s; }
    .pips i.used { background: #f4b942; box-shadow: 0 0 0 3px rgba(244,185,66,.18); }
    .pips i.fresh { animation: pipused .8s cubic-bezier(.3,1.5,.5,1) backwards; }
    .pips i.last::after { content: ""; position: absolute; inset: -5px; border-radius: 50%; border: 2px solid rgba(244,185,66,.75); opacity: 0; animation: pippulse 2s ease-out infinite; }
    .block p.small { font-size: 13px; line-height: 19px; color: var(--dim); max-width: 36ch; }

    .ffold { width: 100%; display: grid; grid-template-rows: 0fr; transition: grid-template-rows .45s cubic-bezier(.2,.85,.25,1); }
    .ffold.open { grid-template-rows: 1fr; }
    .ffold > .fin { min-height: 0; overflow: hidden; }
    .fric { width: 100%; display: grid; gap: 11px; padding: 18px 18px 16px; border-radius: 22px; text-align: left; justify-items: stretch;
      background: linear-gradient(180deg, rgba(255,255,255,.06), rgba(255,255,255,.025)); border: 1px solid rgba(255,255,255,.13); }
    .fric:focus { outline: none; }
    .block .fric[hidden] { display: grid !important; visibility: hidden; transition: visibility 0s linear .45s; }
    .fric p { font-size: 14px; line-height: 21px; }
    .ftop { display: flex; align-items: center; gap: 16px; }
    .fcol { display: grid; gap: 6px; min-width: 0; }
    .block p.fwait { font-size: 15px; line-height: 22px; font-weight: 650; color: var(--fg); font-variant-numeric: tabular-nums; }
    .ring { position: relative; flex: none; width: 88px; height: 88px; }
    .ring::before { content: ""; position: absolute; inset: 10px; border-radius: 50%; background: radial-gradient(closest-side, rgba(var(--acc-rgb), .16), rgba(var(--acc-rgb), 0)); }
    .ring svg.rsv { position: absolute; inset: 0; width: 100%; height: 100%; transform: rotate(-90deg); fill: none; overflow: visible; }
    .ring .trk { stroke: rgba(255,255,255,.12); stroke-width: 6; }
    .ring .prg { stroke: var(--acc); stroke-width: 6; stroke-linecap: round; transition: stroke-dashoffset 1s linear, stroke .4s; }
    .ring .mid { position: absolute; inset: 0; display: grid; place-items: center; align-content: center; transition: opacity .25s, transform .3s; }
    .ring .rn { font-size: 32px; line-height: 32px; font-weight: 700; font-variant-numeric: tabular-nums; letter-spacing: -.02em; }
    .ring .ru { font-size: 11px; line-height: 14px; color: var(--dim); letter-spacing: .1em; text-transform: uppercase; }
    .ring svg.rck { position: absolute; left: 50%; top: 50%; width: 38px; height: 38px; margin: -19px 0 0 -19px; fill: none; stroke: #6ee7b0; stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; opacity: 0; }
    .ring svg.rck path { stroke-dasharray: 26; stroke-dashoffset: 26; }
    .fric.done .ring .prg { stroke: #6ee7b0; }
    .fric.done .ring .mid { opacity: 0; transform: scale(.7); }
    .fric.done .ring svg.rck { opacity: 1; }
    .fric.done .ring svg.rck path { animation: draw .5s .1s ease-out forwards; }
    .fric.done .ring { animation: ringpop .6s cubic-bezier(.3,1.5,.5,1); }
    .block .fric p.finfo { color: var(--mute); }
    .fric p.fwarn { padding: 10px 13px; border-radius: 12px; font-size: 13.5px; line-height: 20px; font-weight: 600; color: #f7d385; background: rgba(244,185,66,.1); border: 1px solid rgba(244,185,66,.3); }
    .block .fric p.sentence { text-align: center; font-size: 18px; line-height: 26px; font-weight: 650; color: var(--mute); padding: 4px 4px 0; text-wrap: balance; }
    .sentence .w { display: inline-block; white-space: nowrap; }
    .sentence .c { transition: color .15s; }
    .sentence .c.m { color: var(--acc); }
    .sentence .c.x { color: #f7c25a; text-decoration: underline; text-decoration-thickness: 2px; text-underline-offset: 4px; }
    .fric.almost .sentence .c.m { color: #7fe3cc; }
    .fric.ready .sentence .c.m { color: #7ff0b8; }
    .inwrap { position: relative; }
    .fric input { width: 100%; font: inherit; font-size: 16px; min-height: 52px; padding: 0 46px 0 16px; border-radius: 14px; border: 1.5px solid rgba(255,255,255,.22); background: rgba(0,0,0,.38); color: #fff;
      transition: border-color .2s, box-shadow .25s, opacity .2s; }
    .fric input::placeholder { color: var(--dim); }
    .fric input:disabled { opacity: .5; }
    .fric input:focus-visible { outline: 2px solid var(--acc); outline-offset: 2px; }
    .fric.typing input { border-color: rgba(var(--acc-rgb), .8); }
    .fric.off input { border-color: #f4b942; box-shadow: 0 0 0 3px rgba(244,185,66,.15); }
    .fric.almost input { border-color: #5fd6c0; box-shadow: 0 0 0 3px rgba(95,214,192,.16); }
    .fric.ready input { border-color: #6ee7b0; box-shadow: 0 0 0 4px rgba(110,231,176,.2); }
    .tick { position: absolute; right: 14px; top: 50%; width: 22px; height: 22px; margin-top: -11px; color: #6ee7b0; opacity: 0; transform: scale(.4); transition: opacity .25s, transform .35s cubic-bezier(.3,1.6,.5,1); pointer-events: none; }
    .tick svg { width: 100%; height: 100%; fill: none; stroke: currentColor; stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; }
    .fric.ready .tick { opacity: 1; transform: none; }
    .tprog { height: 3px; border-radius: 3px; background: rgba(255,255,255,.1); overflow: hidden; margin-top: -4px; }
    .tprog i { display: block; height: 100%; width: 100%; border-radius: 3px; background: var(--acc); transform-origin: 0 50%; transform: scaleX(0); transition: transform .28s cubic-bezier(.2,.85,.25,1), background-color .3s; }
    .fric.off .tprog i { background: #f4b942; }
    .fric.almost .tprog i { background: #5fd6c0; }
    .fric.ready .tprog i { background: #6ee7b0; }
    .block .fric p.fhint { min-height: 21px; font-size: 13px; line-height: 21px; color: var(--dim); text-align: center; transition: color .25s; }
    .fric.typing p.fhint { color: var(--mute); }
    .fric.off p.fhint { color: #f7c25a; }
    .fric.almost p.fhint { color: #7fe3cc; }
    .fric.ready p.fhint { color: #8cf0c0; font-weight: 600; }
    .fric.pop { animation: readypop .6s cubic-bezier(.3,1.4,.5,1); }
    .fric p.ferr { padding: 10px 13px; border-radius: 12px; font-size: 13.5px; line-height: 20px; font-weight: 600; color: #ffb4b4; background: rgba(255,120,120,.1); border: 1px solid rgba(255,120,120,.3); text-align: center; }
    .fric p.ferr.shake { animation: shake .45s ease; }
    .frow { display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; margin-top: 2px; }
    .frow button { flex: 1 1 auto; white-space: nowrap; }
    .block button.stay { border: 0; color: #fff; background: linear-gradient(135deg, var(--g1), var(--g2)); box-shadow: 0 8px 22px rgba(var(--acc-rgb), .22); }
    .block button.stay:hover:not(:disabled) { background: linear-gradient(135deg, var(--g1), var(--g2)); filter: brightness(1.1); }
    .block button.unlock:not(:disabled) { border-color: rgba(110,231,176,.55); color: #c9f7e1; }
    .fric.ready button.unlock { animation: unlockglow 2.4s ease-in-out infinite; }

    /* shown for about a second when a break opens, over the page that comes back underneath; it takes no clicks */
    .bsplash { position: fixed; inset: 0; z-index: 2147483647; display: grid; place-items: center; pointer-events: none; background: var(--bg); color: var(--fg); animation: splashout 1.15s ease-in both; }
    .bsplash .sp { display: grid; gap: 12px; justify-items: center; text-align: center; padding: 24px; animation: splashin 1.15s cubic-bezier(.2,.85,.25,1) both; }
    .bsplash .ok { width: 84px; height: 84px; border-radius: 50%; display: grid; place-items: center; color: #6ee7b0; background: rgba(110,231,176,.12); box-shadow: inset 0 0 0 2px rgba(110,231,176,.5), 0 0 0 10px rgba(110,231,176,.07); }
    .bsplash .ok svg { width: 40px; height: 40px; fill: none; stroke: currentColor; stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; }
    .bsplash .ok path { stroke-dasharray: 26; stroke-dashoffset: 26; animation: draw .45s .12s ease-out forwards; }
    .bsplash h3 { margin: 0; font-size: 22px; line-height: 28px; font-weight: 700; }
    .bsplash p { margin: 0; font-size: 15px; color: var(--mute); }

    /* ------------------------------------------------------------------------ island: break state */
    .isl.onbreak { --glow: rgba(250,178,25,.7); }
    .isl.onbreak .eq i { background: #fab219; }
    .isl.narrow .blocknow, .isl.narrow .brk-t { display: none; }
    .brk { flex: none; display: inline-flex; align-items: center; gap: 6px; color: #fab219; font-weight: 650; font-variant-numeric: tabular-nums; }
    .brk svg { width: 16px; height: 16px; transform: rotate(-90deg); fill: none; stroke-width: 2.6; overflow: visible; }
    .brk .t { stroke: rgba(250,178,25,.25); }
    .brk .p { stroke: #fab219; stroke-linecap: round; transition: stroke-dashoffset 1s linear; }
    .brk-t { display: inline-block; min-width: 3.2ch; }
    .brk:not([hidden]), .resume:not([hidden]) { animation: pillin .38s cubic-bezier(.2,.85,.25,1) backwards; }
    .bar.swap { animation: barswap .34s cubic-bezier(.2,.85,.25,1); }
    .resume.blocknow { background: #fab219; color: #1a1200; }
    .resume.blocknow:hover { background: #ffc24a; }
    .actions button.brkbtn { background: #fab219; border-color: #fab219; color: #1a1200; }
    .actions button.brkbtn:hover { background: #ffc24a; }
    .isl.onbreak:not(.over):not(.bump):not(.enter) { animation: glowbreak 3.6s ease-in-out infinite; }
    @keyframes enter { from { opacity: 0; transform: scale(.6); } to { opacity: 1; transform: scale(1); } }
    @keyframes bump { 0% { transform: scale(1); } 35% { transform: scale(1.07); } 100% { transform: scale(1); } }
    @keyframes eq { 0%, 100% { height: 4px; } 50% { height: 14px; } }
    @keyframes glow {
      0%, 100% { box-shadow: inset 0 0 0 1px rgba(79,155,240,.6), 0 0 16px rgba(79,155,240,.28), 0 8px 24px rgba(0,0,0,.45); }
      50% { box-shadow: inset 0 0 0 1px rgba(52,211,153,.6), 0 0 16px rgba(52,211,153,.28), 0 8px 24px rgba(0,0,0,.45); }
    }
    @keyframes sweep { from { background-position: 150% 0; } to { background-position: -50% 0; } }
    @keyframes rollin { from { transform: translateY(100%); opacity: 0; } to { transform: none; opacity: 1; } }
    @keyframes rollout { to { transform: translateY(-100%); opacity: 0; } }
    @keyframes breathe { 0%, 100% { transform: scale(.7); } 50% { transform: scale(1.15); } }
    @keyframes bfade { from { opacity: 0; } to { opacity: 1; } }
    @keyframes cardin { from { opacity: 0; transform: translateY(10px) scale(.96); } to { opacity: 1; transform: none; } }
    @keyframes rise { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }
    @keyframes halo { from { opacity: .6; transform: scale(1); } to { opacity: 0; transform: scale(1.6); } }
    @keyframes shackle { 0%, 84%, 100% { transform: translateY(0); } 90% { transform: translateY(-1.6px); } 95% { transform: translateY(.3px); } }
    @keyframes drift1 { to { transform: translate3d(8vmax, 6vmax, 0) scale(1.08); } }
    @keyframes drift2 { to { transform: translate3d(-8vmax, -5vmax, 0) scale(1.1); } }
    @keyframes dotpulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: .45; transform: scale(.7); } }
    @keyframes textin { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
    @keyframes shine { 0%, 62% { transform: translateX(-130%); } 100% { transform: translateX(130%); } }
    @keyframes pipin { from { opacity: 0; transform: scale(.3); } to { opacity: 1; transform: none; } }
    @keyframes pipused { 0% { transform: scale(.6); } 55% { transform: scale(1.5); } 100% { transform: scale(1); } }
    @keyframes pippulse { 0% { opacity: .8; transform: scale(.7); } 100% { opacity: 0; transform: scale(1.5); } }
    @keyframes draw { to { stroke-dashoffset: 0; } }
    @keyframes ringpop { 0% { transform: scale(1); } 45% { transform: scale(1.1); } 100% { transform: scale(1); } }
    @keyframes readypop { 0% { transform: scale(1); } 40% { transform: scale(1.012); } 100% { transform: scale(1); } }
    @keyframes shake { 0%, 100% { transform: translateX(0); } 20% { transform: translateX(-6px); } 40% { transform: translateX(5px); } 60% { transform: translateX(-3px); } 80% { transform: translateX(2px); } }
    @keyframes unlockglow { 0%, 100% { box-shadow: 0 0 0 0 rgba(110,231,176,0); } 50% { box-shadow: 0 0 0 5px rgba(110,231,176,.16); } }
    @keyframes splashout { 0%, 38% { opacity: 1; } 100% { opacity: 0; } }
    @keyframes splashin { 0% { opacity: 0; transform: scale(.9); } 22%, 70% { opacity: 1; transform: none; } 100% { opacity: 0; transform: scale(1.05); } }
    @keyframes pillin { from { opacity: 0; transform: translateX(-6px); } to { opacity: 1; transform: none; } }
    @keyframes barswap { from { opacity: .35; transform: translateY(3px); } to { opacity: 1; transform: none; } }
    @keyframes glowbreak {
      0%, 100% { box-shadow: inset 0 0 0 1px rgba(250,178,25,.55), 0 0 14px rgba(250,178,25,.22), 0 8px 24px rgba(0,0,0,.45); }
      50% { box-shadow: inset 0 0 0 1px rgba(250,178,25,.95), 0 0 26px rgba(250,178,25,.45), 0 8px 24px rgba(0,0,0,.45); }
    }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { animation-duration: .01ms !important; animation-delay: 0s !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important; transition-delay: 0s !important; }
    }
  `;

  const ui = (function () {
    let host = null;
    let root = null;
    let isl = null;
    let els = null;
    let expanded = false;
    let dragging = false;
    let dragPos = null; // where the user dragged it, as fractions of the window; this page view only, never saved
    let barW = 140;
    let revealed = false; // false until the first correct placement; the island stays invisible until then
    let revealBy = 0; // give up waiting for the reel (and use the window centre) at this time
    let lastReel = null; // last known top-centre of the reel, kept across a moment where no video is found
    let placedKey = '';
    let lastReels = null;
    let stateKey = null; // live, paused or on a break: when it changes, the bar swaps with a short fade
    const BRK_R = 9;
    const BRK_C = 2 * Math.PI * BRK_R;
    let noteTimer = 0;
    let bumpTimer = 0;
    let toastEl = null;
    let toastTimer = 0;
    let pauseEl = null;
    let pauseTimer = 0;

    function mk(tag, cls, text) {
      const n = document.createElement(tag);
      if (cls) n.className = cls;
      if (text != null) n.textContent = text;
      return n;
    }

    function ensure() {
      if (host && host.isConnected) return;
      host = document.createElement('div');
      host.setAttribute('data-reel-meter', ''); // (empty on purpose: the page learns nothing about the version)
      root = host.attachShadow({ mode: 'closed' });
      const style = document.createElement('style');
      style.textContent = CSS;
      root.appendChild(style);
      isl = null;
      els = null;
      toastEl = null;
      pauseEl = null;
      blockEl = null;
      document.documentElement.appendChild(host);
    }

    /** Roll a changing number: the old digits slide up and out, the new ones slide in. */
    function setNum(el, text, animate) {
      if (el.dataset.v === text) return;
      el.dataset.v = text;
      const cur = el.lastElementChild;
      if (!cur || !animate) {
        el.replaceChildren(mk('span', '', text));
        return;
      }
      // keep exactly one outgoing and one incoming value, even if updates arrive faster than the animation
      for (const c of [...el.children]) if (c !== cur) c.remove();
      cur.className = 'out';
      el.appendChild(mk('span', 'in', text));
      setTimeout(() => cur.remove(), 320);
    }

    function build() {
      ensure();
      isl = mk('div', 'isl');
      isl.setAttribute('role', 'group');
      isl.setAttribute('aria-label', 'Reel Meter. Tap for details, drag to move, double-click to put it back.');
      els = {};

      const bar = mk('div', 'bar');
      els.bar = bar;
      els.dot = mk('span', 'eq');
      els.dot.append(mk('i'), mk('i'), mk('i'));
      els.num = mk('span', 'num');
      els.unit = mk('span', 'unit', 'reels');
      els.sep = mk('span', 'sep');
      els.time = mk('span', 'num time');
      els.resume = mk('button', 'resume', 'Resume');
      els.resume.type = 'button';
      els.resume.hidden = true;
      els.resume.setAttribute('aria-label', 'Resume tracking');
      els.blockNow = mk('button', 'resume blocknow', 'Block now');
      els.blockNow.type = 'button';
      els.blockNow.hidden = true;
      els.blockNow.setAttribute('aria-label', 'End the break and block reels on this app again');
      // on a break: a small ring that drains, with the time left; it replaces the screen time on the bar
      els.brk = mk('span', 'brk');
      els.brk.hidden = true;
      const brkSvg = svgEl('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' });
      els.brkP = svgEl('circle', { class: 'p', cx: 12, cy: 12, r: BRK_R, 'stroke-dasharray': BRK_C.toFixed(2), 'stroke-dashoffset': '0' });
      brkSvg.append(svgEl('circle', { class: 't', cx: 12, cy: 12, r: BRK_R }), els.brkP);
      els.brkT = mk('span', 'brk-t', '0:00');
      els.brk.append(brkSvg, els.brkT);
      bar.append(els.dot, els.num, els.unit, els.sep, els.time, els.brk, els.resume, els.blockNow);

      const noteFold = mk('div', 'fold note-fold');
      const noteIn = mk('div', 'in');
      els.note = mk('div', 'note');
      els.note.setAttribute('role', 'status');
      noteIn.appendChild(els.note);
      noteFold.appendChild(noteIn);

      const moreFold = mk('div', 'fold more-fold');
      const moreIn = mk('div', 'in');
      const more = mk('div', 'more');
      const big = mk('div', 'big');
      els.bigReels = mk('b');
      els.bigTime = mk('span');
      big.append(els.bigReels, els.bigTime);
      els.lim = mk('div', 'lim');
      const track = mk('div', 'track');
      els.trackFill = mk('i');
      track.appendChild(els.trackFill);
      els.limText = mk('small');
      els.lim.append(track, els.limText);
      els.streak = mk('div', 'chip');
      els.pinfo = mk('div', 'pinfo'); // "Tracking paused until 14:35" (only while paused)
      els.pinfo.hidden = true;
      const actions = mk('div', 'actions');
      const pauseBtn = mk('button', '', 'Pause 15m');
      const resumeBtn = mk('button', 'primary', 'Resume now');
      const moreBtn = mk('button', '', '+15m');
      const focusBtn = mk('button', '', 'Focus 30m');
      focusBtn.title = 'Block reels on this app for the next 30 minutes';
      const blockNowBtn = mk('button', 'primary', 'Block now');
      blockNowBtn.className = 'primary brkbtn';
      blockNowBtn.title = 'End the break and block reels on this app again';
      blockNowBtn.type = 'button';
      blockNowBtn.hidden = true;
      els.blockNowBtn = blockNowBtn;
      const dashBtn = mk('button', '', 'Dashboard');
      const hideBtn = mk('button', '', 'Hide');
      pauseBtn.type = resumeBtn.type = moreBtn.type = focusBtn.type = dashBtn.type = hideBtn.type = 'button';
      resumeBtn.hidden = moreBtn.hidden = true;
      els.pauseBtn = pauseBtn;
      els.resumeBtn = resumeBtn;
      els.moreBtn = moreBtn;
      actions.append(blockNowBtn, pauseBtn, resumeBtn, moreBtn, focusBtn, dashBtn, hideBtn);
      focusBtn.addEventListener('click', () => { collapse(); startFocus(30); });
      blockNowBtn.addEventListener('click', () => { collapse(); endBreak(); });
      more.append(big, els.pinfo, els.lim, els.streak, actions);
      moreIn.appendChild(more);
      moreFold.appendChild(moreIn);

      const meter = mk('div', 'meter');
      els.meterFill = mk('i');
      meter.appendChild(els.meterFill);

      isl.append(bar, noteFold, moreFold, meter);
      root.appendChild(isl);

      pauseBtn.addEventListener('click', () => { collapse(); setSnooze(Date.now() + 15 * 60000); });
      resumeBtn.addEventListener('click', () => { collapse(); setSnooze(0); });
      els.resume.addEventListener('click', () => setSnooze(0));
      els.blockNow.addEventListener('click', endBreak);
      moreBtn.addEventListener('click', () => setSnooze(C.extendSnooze(settings.snoozeUntil, Date.now(), 15)));
      dashBtn.addEventListener('click', () => send({ type: 'open-dashboard' }));
      hideBtn.addEventListener('click', () => { collapse(); hiddenByUser = true; render(); });

      makeDraggable(isl);
      // The island starts invisible and is revealed by place() once it knows the right spot; the width
      // transition is switched on one frame later so the first size is applied without animating.
      isl.style.visibility = 'hidden';
      revealed = false;
      revealBy = Date.now() + REVEAL_MS;
      requestAnimationFrame(() => isl && isl.classList.add('ready'));
    }

    function playEnter() {
      isl.classList.remove('enter');
      void isl.offsetWidth; // restart the animation
      isl.classList.add('enter');
      setTimeout(() => isl && isl.classList.remove('enter'), 520);
    }

    /** The visible area without scroll bars: what position: fixed is measured against. */
    function viewport() {
      const e = document.documentElement;
      return {
        w: Math.min(window.innerWidth, e.clientWidth || window.innerWidth),
        h: Math.min(window.innerHeight, e.clientHeight || window.innerHeight),
      };
    }

    /** The width the island is heading for (it animates there), never wider than the window. */
    function targetWidth() {
      const max = Math.max(60, viewport().w - 16);
      if (expanded) return Math.min(300, max);
      if (isl.classList.contains('noting')) return Math.min(Math.max(barW, 300), max);
      return Math.min(barW, max);
    }

    function sizeIsland() {
      isl.style.setProperty('--w', targetWidth() + 'px');
    }

    function expand() {
      expanded = true;
      isl.classList.add('expanded');
      sizeIsland();
      reposition();
    }

    function collapse() {
      if (!isl) return;
      expanded = false;
      isl.classList.remove('expanded');
      sizeIsland();
      reposition();
    }

    /** The top centre of the reel being watched (the dominant visible video), or null while there is none. */
    function reelAnchor() {
      const v = pickVideo();
      const now = Date.now();
      if (v) {
        const r = v.getBoundingClientRect();
        const left = Math.max(r.left, 0);
        const right = Math.min(r.right, viewport().w);
        if (right > left) {
          lastReel = { x: (left + right) / 2, y: Math.max(r.top, 0) + 10, at: now };
          return lastReel;
        }
      }
      // sites swap their <video> elements while you swipe: hold the last spot for a moment instead of jumping
      return lastReel && now - lastReel.at < 1500 ? lastReel : null;
    }

    /**
     * Where the island goes: the spot the user dragged it to on this page view, else the chosen place
     * (default: horizontally centred on the reel, 10px below its top edge, or centred at the top of the window
     * while no reel is on screen yet). The island is anchored by its centre (or right edge / bottom edge for the
     * other choices) so its springing width never moves it. It stays invisible until this first has a real answer.
     */
    function place(el) {
      const { w: vw, h: vh } = viewport();
      const w = targetWidth();
      let x = vw / 2;
      let y = 10;
      let ax = 'c'; // which part of the island sits at x: centre, left edge or right edge
      let ay = 't'; // which part sits at y: top edge, middle or bottom edge
      let waiting = false;
      if (dragPos) {
        x = dragPos.x * vw;
        y = dragPos.y * vh;
      } else {
        switch (settings.counterCorner) {
          case 'video-top': {
            const a = reelAnchor();
            if (a) { x = a.x; y = a.y; } else waiting = true;
            break;
          }
          case 'top-center': y = 72; break;
          case 'middle-right': x = vw - 16; ax = 'r'; y = vh / 2; ay = 'm'; break;
          case 'bottom-right': x = vw - 16; ax = 'r'; y = vh - 16; ay = 'b'; break;
          case 'top-left': x = 16; ax = 'l'; y = 72; break;
          case 'top-right': x = vw - 16; ax = 'r'; y = 72; break;
          default: x = 16; ax = 'l'; y = vh - 16; ay = 'b'; // bottom-left
        }
      }
      if (!revealed && waiting && Date.now() < revealBy) return; // the reel is not laid out yet: do not flash in a wrong place

      // keep it inside the window, judged by the width it is heading for
      const off = ax === 'c' ? w / 2 : ax === 'l' ? 0 : w;
      x = Math.min(Math.max(8, x - off), Math.max(8, vw - w - 8)) + off;
      y = ay === 't' ? Math.min(Math.max(6, y), Math.max(6, vh - 42)) : ay === 'b' ? Math.min(Math.max(42, y), vh - 8) : y;

      const key = Math.round(x) + ',' + Math.round(y) + ax + ay;
      if (key !== placedKey) {
        placedKey = key;
        const s = el.style;
        s.left = Math.round(x) + 'px';
        if (ay === 'b') { s.top = 'auto'; s.bottom = Math.round(vh - y) + 'px'; } else { s.bottom = 'auto'; s.top = Math.round(y) + 'px'; }
        s.translate = (ax === 'c' ? '-50%' : ax === 'r' ? '-100%' : '0') + ' ' + (ay === 'm' ? '-50%' : '0');
      }
      if (!revealed) {
        revealed = true;
        el.style.visibility = '';
        playEnter();
      }
    }

    function reposition() {
      if (isl && isl.style.display !== 'none' && !dragging) place(isl);
    }

    function makeDraggable(el) {
      let start = null;
      el.addEventListener('pointerdown', (e) => {
        if (e.button > 0 || (e.target.closest && e.target.closest('button'))) return;
        const r = el.getBoundingClientRect();
        start = { x: e.clientX, y: e.clientY, left: r.left, top: r.top, moved: false };
        try { el.setPointerCapture(e.pointerId); } catch (err) { /* not an active pointer */ }
      });
      el.addEventListener('pointermove', (e) => {
        if (!start) return;
        const dx = e.clientX - start.x;
        const dy = e.clientY - start.y;
        if (!start.moved && Math.hypot(dx, dy) < 4) return;
        start.moved = true;
        dragging = true;
        el.classList.add('drag');
        // Dragging is temporary: it lasts for this page view only and is never saved, so a refresh
        // always brings the island back to the top centre of the reel.
        const { w: vw, h: vh } = viewport();
        const left = Math.min(Math.max(0, start.left + dx), Math.max(0, vw - el.offsetWidth));
        const top = Math.min(Math.max(0, start.top + dy), Math.max(0, vh - el.offsetHeight));
        dragPos = { x: (left + el.offsetWidth / 2) / vw, y: top / vh };
        place(el);
      });
      el.addEventListener('pointercancel', () => { start = null; dragging = false; el.classList.remove('drag'); });
      // double-click: snap back to the chosen place (top centre of the reel unless the dashboard says otherwise)
      el.addEventListener('dblclick', (e) => {
        if (e.target.closest && e.target.closest('button')) return;
        dragPos = null;
        placedKey = '';
        place(el);
      });
      el.addEventListener('pointerup', () => {
        if (!start) return;
        const s = start;
        start = null;
        dragging = false;
        el.classList.remove('drag');
        if (!s.moved) {
          if (expanded) collapse(); else expand();
        }
      });
    }

    document.addEventListener('pointerdown', (e) => {
      if (expanded && host && !e.composedPath().includes(host)) collapse();
    }, true);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && expanded) collapse(); }, true);

    function setIsland(s) {
      if (s == null) {
        if (isl && isl.style.display !== 'none') {
          // never come back open or half folded
          expanded = false;
          isl.classList.remove('expanded', 'noting');
          clearTimeout(noteTimer);
          isl.style.display = 'none';
          lastReels = null;
          lastReel = null;
          stateKey = null;
        }
        return;
      }
      if (!isl || !host || !host.isConnected) build();
      const wasHidden = isl.style.display === 'none';
      if (wasHidden) {
        // shown again (next reel page, resumed, reloaded): wait for the reel to be laid out before it appears
        isl.classList.remove('ready'); // no width animation from the size it had before it was hidden
        requestAnimationFrame(() => isl && isl.classList.add('ready'));
        isl.style.display = '';
        isl.style.visibility = 'hidden';
        revealed = false;
        revealBy = Date.now() + REVEAL_MS;
        stateKey = null;
      }

      isl.classList.toggle('active', s.active);
      isl.classList.toggle('paused', s.paused);
      isl.classList.toggle('near', s.near && !s.over);
      isl.classList.toggle('over', s.over);
      const hasLimit = s.limits.reels > 0 || s.limits.mins > 0;
      isl.classList.toggle('has-limit', hasLimit);

      const snooze = s.paused ? C.describeSnooze(s.until, s.now) : null;
      els.resume.hidden = !s.paused;
      // on a break (this app only): a "Block now" pill on the bar and in the card
      const breaking = !!s.onBreak && !s.paused;
      isl.classList.toggle('onbreak', breaking);
      els.blockNow.hidden = !breaking;
      els.blockNowBtn.hidden = !breaking;
      els.pinfo.hidden = !(s.paused || breaking);
      const sk = s.paused ? 'paused' : breaking ? 'break' : 'live';
      if (stateKey !== null && sk !== stateKey) {
        els.bar.classList.remove('swap');
        void els.bar.offsetWidth; // restart the short fade
        els.bar.classList.add('swap');
      }
      stateKey = sk;
      if (breaking) els.pinfo.textContent = 'On a break until ' + C.formatClock(s.onBreak.until) + ' (' + C.formatLeft(s.onBreak.until - s.now) + '). After that this app is blocked again.';
      els.pauseBtn.hidden = s.paused || s.hard;
      els.resumeBtn.hidden = !s.paused;
      els.moreBtn.hidden = !s.paused || snooze.rest;
      if (s.paused) {
        // "Paused | 14m left | Resume": the time left is re-drawn on every tick (once a second)
        setNum(els.num, 'Paused', false);
        els.unit.hidden = true;
        els.sep.hidden = els.time.hidden = false;
        setNum(els.time, snooze.short, false);
        els.pinfo.textContent = snooze.long;
      } else {
        els.unit.hidden = els.sep.hidden = els.time.hidden = false;
        setNum(els.num, String(s.reels), lastReels !== null && !wasHidden);
        els.unit.textContent = s.reels === 1 ? 'reel' : 'reels';
        setNum(els.time, C.formatDuration(s.secs), false);
      }
      els.time.hidden = els.time.hidden || breaking;
      els.brk.hidden = !breaking;
      if (breaking) {
        const left = Math.max(0, s.onBreak.until - s.now);
        const total = Math.max(60000, C.levelRules(settings.block.level).breakMin * 60000);
        els.brkP.style.strokeDashoffset = (BRK_C * (1 - Math.min(1, left / total))).toFixed(2);
        const secs = Math.ceil(left / 1000);
        const t = Math.floor(secs / 60) + ':' + String(secs % 60).padStart(2, '0');
        if (els.brkT.textContent !== t) els.brkT.textContent = t;
      }

      els.bigReels.textContent = s.reels + (s.reels === 1 ? ' reel' : ' reels');
      els.bigTime.textContent = C.formatDuration(s.secs) + ' today';
      els.lim.hidden = !hasLimit;
      if (hasLimit) {
        const bits = [];
        if (s.limits.reels) bits.push(s.reels + ' of ' + s.limits.reels + ' reels');
        if (s.limits.mins) bits.push(Math.round(s.secs / 60) + ' of ' + s.limits.mins + ' min');
        els.limText.textContent = bits.join(' · ');
        const w = Math.min(100, Math.round(s.pct * 100)) + '%';
        els.trackFill.style.width = w;
        els.meterFill.style.width = w;
      }
      els.streak.hidden = !(s.streak >= 3);
      els.streak.textContent = s.streak + ' in a row this session';

      if (lastReels !== null && s.reels > lastReels && !s.paused) {
        isl.classList.add('bump');
        clearTimeout(bumpTimer);
        bumpTimer = setTimeout(() => isl && isl.classList.remove('bump'), 450);
        if (isMilestone(s.reels)) {
          // a plain, neutral heads-up with a light sweep across the island; it never cheers you on
          isl.classList.remove('milestone');
          void isl.offsetWidth;
          isl.classList.add('milestone');
          setTimeout(() => isl && isl.classList.remove('milestone'), 1200);
          note(s.reels + ' reels today · ' + C.formatDuration(s.secs), 3500);
        }
      }
      lastReels = s.reels;

      // Measure with offsetWidth, which ignores the island's own scale animations (enter, bump). A getBoundingClientRect
      // here read 60% of the width while the enter animation was starting, and the island came up too narrow.
      // Too wide for the window: drop the divider and time so the rest (and the Resume button) still fit.
      isl.classList.remove('narrow');
      let natural = els.bar.offsetWidth;
      if (natural > viewport().w - 16) {
        isl.classList.add('narrow');
        natural = els.bar.offsetWidth;
      }
      barW = Math.ceil((natural + 1) / 2) * 2; // even, so a centred island lands on whole pixels
      sizeIsland();
      if (!dragging) place(isl);
    }

    function message(kind, resp) {
      const mins = Math.max(1, Math.round((resp.today.s || 0) / 60));
      switch (kind) {
        case 'streak':
          return 'That is ' + resp.streak + ' reels in a row. A good moment to stretch or look away.';
        case 'near': {
          const l = resp.limits;
          const bits = [];
          if (l.reels) bits.push(resp.today.r + ' of ' + l.reels + ' reels');
          if (l.mins) bits.push(mins + ' of ' + l.mins + ' min');
          return 'You are close to today’s limit (' + bits.join(', ') + ').';
        }
        case 'limit-more':
          return 'Still going past your limit: ' + resp.today.r + ' reels, ' + mins + ' min today.';
        default:
          return 'You reached today’s limit: ' + resp.today.r + ' reels, ' + mins + ' min.';
      }
    }

    function isMilestone(n) {
      return n === 10 || n === 25 || n === 50 || (n >= 100 && n % 100 === 0);
    }

    /** A short message that the island carries by stretching open, then folds away again. */
    function note(text, ms) {
      if (!isl || isl.style.display === 'none') return;
      els.note.textContent = text;
      isl.classList.add('noting');
      sizeIsland();
      reposition();
      clearTimeout(noteTimer);
      noteTimer = setTimeout(() => {
        if (!isl) return;
        isl.classList.remove('noting');
        sizeIsland();
        reposition();
      }, ms || NOTE_MS);
    }

    function toast(text) {
      ensure();
      clearTimeout(toastTimer);
      if (toastEl) toastEl.remove();
      toastEl = mk('div', 'toast');
      toastEl.setAttribute('role', 'status');
      const span = mk('span', '', text);
      const btn = mk('button', '', 'OK');
      btn.addEventListener('click', () => { toastEl.remove(); toastEl = null; });
      toastEl.append(span, btn);
      root.appendChild(toastEl);
      toastTimer = setTimeout(() => { if (toastEl) toastEl.remove(); toastEl = null; }, TOAST_MS);
    }

    function pause(text, home) {
      if (pauseEl) return;
      ensure();
      const resume = [];
      document.querySelectorAll('video').forEach((v) => {
        if (!v.paused) { resume.push(v); v.pause(); }
      });

      pauseEl = document.createElement('div');
      pauseEl.className = 'pause';
      pauseEl.setAttribute('role', 'alertdialog');
      pauseEl.setAttribute('aria-label', 'Time for a pause');
      const h = document.createElement('h2');
      h.textContent = 'Take a breath';
      const p = document.createElement('p');
      p.textContent = text;
      const orb = document.createElement('div');
      orb.className = 'orb';
      const cue = document.createElement('p');
      cue.textContent = 'Breathe in…';
      const row = document.createElement('div');
      row.className = 'row';
      const done = document.createElement('button');
      done.className = 'primary';
      done.textContent = 'I’m done for now';
      const keep = document.createElement('button');
      keep.disabled = true;
      row.append(done, keep);
      pauseEl.append(h, p, orb, cue, row);
      root.appendChild(pauseEl);

      let left = PAUSE_SECONDS;
      let breathIn = true;
      keep.textContent = 'Keep scrolling (' + left + ')';
      const close = () => {
        clearInterval(pauseTimer);
        pauseEl.remove();
        pauseEl = null;
      };
      pauseTimer = setInterval(() => {
        left--;
        if (left % 4 === 0) {
          breathIn = !breathIn;
          cue.textContent = breathIn ? 'Breathe in…' : 'Breathe out…';
        }
        if (left <= 0) {
          keep.disabled = false;
          keep.textContent = 'Keep scrolling';
          clearInterval(pauseTimer);
        } else {
          keep.textContent = 'Keep scrolling (' + left + ')';
        }
      }, 1000);
      done.addEventListener('click', () => { close(); location.assign(home); });
      keep.addEventListener('click', () => {
        close();
        resume.forEach((v) => v.play().catch(() => {}));
      });
      done.focus();
    }

    // ---------------------------------------------------------------- block screen

    const BLOCK_EXIT = {
      youtube: 'https://www.youtube.com/',
      instagram: 'https://www.instagram.com/',
      tiktok: 'https://www.tiktok.com/explore', // its home page is the reel feed itself
      facebook: 'https://www.facebook.com/',
    };
    const FRIC_ERRORS = {
      sentence: 'That is not quite the sentence. Check the words and try again.',
      'too-soon': 'The wait is not over yet. Let the ring fill first.',
      lockout: 'This app is locked right now, so it cannot be unblocked.',
      strict: 'Full restriction does not allow this block to be unblocked.',
      'not-blocked': 'This page is not blocked any more.',
      error: 'Something went wrong. Please try again.',
    };
    let blockEl = null;
    let bels = null;
    let blockShown = false;
    let blockKey = '';
    let prevOverflow = '';
    let fricTimer = 0;
    let fricLeft = 0;
    let fricOpen = false;
    let blockPlatform = 'youtube';
    let blockWatchUrl = '';
    let blockStatusNow = null;
    let unlocking = false; // true from pressing Unblock until the worker has answered
    let splashEl = null;
    let splashTimer = 0;
    const lastUsed = {}; // per app: how many unblocks were used the last time the dots were drawn (to animate the new one)
    const mutedByUs = new WeakSet();
    const pausedByUs = new WeakSet();

    /** Keep every video stopped and silent while the block screen is up (sites try to restart them). */
    function quietVideos() {
      document.querySelectorAll('video').forEach((v) => {
        try {
          if (!v.paused) { v.pause(); pausedByUs.add(v); }
          if (!v.muted) { v.muted = true; mutedByUs.add(v); }
        } catch (e) { /* ignore */ }
      });
    }

    /** The block is over (a break, the timer ran out): give back sound and carry on playing what we stopped. */
    function releaseVideos() {
      const onReel = !!C.classify(location.hostname, location.pathname); // never start a video on a page that is not a reel page
      document.querySelectorAll('video').forEach((v) => {
        if (mutedByUs.has(v)) { try { v.muted = false; } catch (e) { /* ignore */ } mutedByUs.delete(v); }
        if (pausedByUs.has(v)) { if (onReel) { try { v.play().catch(() => {}); } catch (e) { /* ignore */ } } pausedByUs.delete(v); }
      });
    }

    /** A page that starts a video again, or turns the sound back on, is stopped the moment it does (not at the next 300 ms check). */
    function stopAgain(e) {
      const v = e.target;
      if (!v || v.tagName !== 'VIDEO') return;
      try {
        if (!v.paused) { v.pause(); pausedByUs.add(v); }
        if (!v.muted) { v.muted = true; mutedByUs.add(v); }
      } catch (err) { /* ignore */ }
    }

    let orphanTimer = 0;
    let orphanMode = false;
    /** The extension was reloaded or updated: this script can no longer talk to it. Keep the block up and ask for a reload. */
    function orphanBlock() {
      if (!blockShown || !bels) { destroy(); return; }
      orphanMode = true;
      bels.title.textContent = 'Reel Meter was updated';
      bels.text.textContent = 'Reload this page to keep your block going. Until then reels stay stopped here.';
      [bels.watch, bels.cont, bels.fric, bels.pips, bels.bpips, bels.pipsText, bels.left, bels.nudge].forEach((el) => { if (el) el.hidden = true; });
      setFixed('');
      bels.go.textContent = 'Reload this page';
      orphanTimer = setInterval(quietVideos, 300);
    }

    /**
     * While blocked the page behind must not react to the keyboard (YouTube shortcuts, arrow keys to the next reel).
     * Keys typed into our own sentence box are kept away from the page too: sites like Facebook use letters such as
     * R and L as shortcuts and cancel them, which would stop those letters from being typed.
     */
    function blockKeys(e) {
      if (host && e.composedPath().includes(host)) {
        e.stopPropagation(); // the page never sees it; the letter is still typed because nothing cancels it
        if (e.type === 'keydown' && e.key === 'Escape' && fricOpen && bels) { // Escape folds the challenge away, like "Never mind"
          e.preventDefault();
          closeFriction();
          try { bels.cont.focus({ preventScroll: true }); } catch (err) { /* ignore */ }
          return;
        }
        // the event no longer reaches the box itself, so Enter is handled here
        if (e.type === 'keydown' && e.key === 'Enter' && root && bels && root.activeElement === bels.input && !bels.unlock.disabled) {
          e.preventDefault();
          bels.unlock.click();
        }
        return;
      }
      e.stopImmediatePropagation();
      e.preventDefault();
    }

    const NS = 'http://www.w3.org/2000/svg';
    function svgEl(tag, attrs) {
      const n = document.createElementNS(NS, tag);
      for (const k of Object.keys(attrs || {})) n.setAttribute(k, attrs[k]);
      return n;
    }

    /** A small stroked icon made of paths (built node by node, never from HTML text). */
    function svgIcon(...paths) {
      const svg = svgEl('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' });
      paths.forEach((d) => svg.appendChild(svgEl('path', { d })));
      return svg;
    }

    function svgLock() {
      const svg = svgEl('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' });
      svg.append(
        svgEl('rect', { x: 5, y: 11, width: 14, height: 10, rx: 2.5 }),
        svgEl('path', { class: 'shackle', d: 'M8 11V8a4 4 0 0 1 8 0v3' }),
        svgEl('circle', { class: 'keyhole', cx: 12, cy: 16, r: 1.3 })
      );
      return svg;
    }

    const RING_R = 40;
    const RING_C = 2 * Math.PI * RING_R;

    /** The wait ring: a track, a progress arc (filled by drawFriction), the seconds in the middle and a tick for when it is done. */
    function makeRing() {
      const wrap = mk('div', 'ring');
      const svg = svgEl('svg', { class: 'rsv', viewBox: '0 0 92 92', 'aria-hidden': 'true', focusable: 'false' });
      const prg = svgEl('circle', { class: 'prg', cx: 46, cy: 46, r: RING_R, 'stroke-dasharray': RING_C.toFixed(2), 'stroke-dashoffset': RING_C.toFixed(2) });
      svg.append(svgEl('circle', { class: 'trk', cx: 46, cy: 46, r: RING_R }), prg);
      const mid = mk('div', 'mid');
      const num = mk('span', 'rn', '0');
      mid.append(num, mk('span', 'ru', 'sec'));
      const tick = svgEl('svg', { class: 'rck', viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' });
      tick.appendChild(svgEl('path', { d: 'M5 12.5l4.5 4.5L19 7.5' }));
      wrap.append(svg, mid, tick);
      return { wrap, prg, num };
    }

    function labelButton(cls, text, icon) {
      const b = mk('button', cls);
      b.type = 'button';
      const label = mk('span', '', text);
      b.appendChild(label);
      if (icon) b.appendChild(icon);
      return { b, label };
    }

    /** A block that can be folded away smoothly (its height animates; nothing jumps). */
    function fold(cls, child) {
      const f = mk('div', 'fd ' + cls);
      const i = mk('div', 'fi');
      i.appendChild(child);
      f.appendChild(i);
      return f;
    }

    const NUDGES = [
      'Urges tend to pass if you give them a couple of minutes.',
      'Take a breath. Nothing here needs you right now.',
      'A short walk, a stretch or a glass of water makes a good swap.',
      'Looking away for a moment is often enough to reset.',
      'You set this up on purpose. That choice still counts.',
    ];
    const NUDGE_EVERY_MS = 16000;
    const normSentence = (x) => String(x == null ? '' : x).toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ');

    const rulesNow = () => C.levelRules(settings.block.level);

    function buildBlock() {
      ensure();
      blockEl = mk('div', 'block');
      blockEl.setAttribute('role', 'alertdialog');
      blockEl.setAttribute('aria-modal', 'true');
      blockEl.setAttribute('aria-label', 'Reels are blocked');
      bels = {};
      const aura = mk('div', 'aura');
      aura.setAttribute('aria-hidden', 'true');
      aura.append(mk('i'), mk('i'));

      const card = mk('div', 'bcard');
      bels.card = card;
      const lock = mk('div', 'lock');
      lock.appendChild(svgLock());
      bels.tag = mk('span', 'btag', 'Full restriction');
      bels.tag.hidden = true;
      bels.title = mk('h2');
      bels.text = mk('p');
      bels.left = mk('p', 'bleft'); // the time left, big when it is a lockout; re-drawn about three times a second at the same size
      bels.nudge = mk('p', 'bnudgep');
      bels.nudgeI = Math.floor(Math.random() * NUDGES.length);
      bels.nudge.textContent = NUDGES[bels.nudgeI];
      bels.nudgeAt = Date.now();
      const nudgeBox = mk('div', 'bnudge');
      nudgeBox.appendChild(bels.nudge);

      bels.fixed = mk('p', 'bfixed'); // why there is no way past this block (lockout, Full restriction)
      bels.notice = mk('div', 'bnotice');
      bels.notice.append(svgIcon('M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z', 'M9 12l2 2 4-4'), bels.fixed);

      const acts = mk('div', 'bacts');
      const go = labelButton('go primary', 'Leave reels', svgIcon('M5 12h14', 'M13 6l6 6-6 6'));
      const watch = labelButton('alt', 'Watch as a normal video');
      bels.go = go.b;
      bels.watch = watch.b;
      bels.watch.hidden = true;
      acts.append(bels.go, bels.watch);
      bels.cont = mk('button', 'blink', 'I need to continue');
      bels.cont.type = 'button';

      // one dot per unblock the plan allows; the used ones are filled
      bels.pips = mk('div', 'pips');
      bels.pips.setAttribute('role', 'img');
      bels.pipsText = mk('p', 'small');
      bels.bpips = mk('div', 'bpips');
      bels.bpips.append(bels.pips, fold('fold-on-open', bels.pipsText));

      // the challenge: a ring that fills during the wait, then the sentence with live feedback
      bels.fric = mk('div', 'fric');
      bels.fric.hidden = true;
      bels.fric.tabIndex = -1;
      const ring = makeRing();
      bels.ringPrg = ring.prg;
      bels.rn = ring.num;
      bels.finfo = mk('p', 'finfo');
      bels.fwait = mk('p', 'fwait');
      const col = mk('div', 'fcol');
      col.append(bels.finfo, bels.fwait);
      const ftop = mk('div', 'ftop');
      ftop.append(ring.wrap, col);
      bels.fwarn = mk('p', 'fwarn');
      bels.fsent = mk('p', 'sentence');
      bels.cells = [];
      bels.input = mk('input');
      bels.input.type = 'text';
      bels.input.autocomplete = 'off';
      bels.input.spellcheck = false;
      bels.input.placeholder = 'Type it here when the ring is full';
      bels.input.setAttribute('aria-label', 'Type the sentence to unblock');
      bels.input.disabled = true;
      const tickBox = mk('span', 'tick');
      tickBox.appendChild(svgIcon('M5 12.5l4.5 4.5L19 7.5'));
      const inwrap = mk('div', 'inwrap');
      inwrap.append(bels.input, tickBox);
      bels.tprog = mk('i');
      const tprog = mk('div', 'tprog');
      tprog.appendChild(bels.tprog);
      bels.fhint = mk('p', 'fhint');
      bels.fhint.setAttribute('aria-live', 'polite');
      bels.ferr = mk('p', 'ferr');
      bels.ferr.setAttribute('role', 'alert');
      bels.ferr.hidden = true;
      const frow = mk('div', 'frow');
      const unlock = labelButton('unlock', 'Unblock');
      const never = labelButton('stay', 'Never mind');
      bels.unlock = unlock.b;
      bels.unlockLabel = unlock.label;
      bels.never = never.b;
      bels.unlock.disabled = true;
      frow.append(bels.never, bels.unlock);
      bels.fric.append(ftop, bels.fwarn, bels.fsent, inwrap, tprog, bels.fhint, bels.ferr, frow);
      const fin = mk('div', 'fin');
      fin.appendChild(bels.fric);
      bels.ffold = mk('div', 'ffold');
      bels.ffold.appendChild(fin);

      // staggered entrance (each part rises a moment after the one before; the buttons are in place within about 0.45 s)
      const nudgeFold = fold('fold-on-open', nudgeBox);
      [[lock, 0], [bels.tag, 1], [bels.title, 1], [bels.text, 2], [bels.left, 3], [nudgeFold, 3], [bels.notice, 3], [acts, 4], [bels.cont, 5], [bels.bpips, 6], [bels.ffold, 7]]
        .forEach(([el, i]) => el.style.setProperty('--i', String(i)));
      card.append(lock, bels.tag, bels.title, bels.text, bels.left, nudgeFold, bels.notice, acts, bels.cont, bels.bpips, bels.ffold);
      blockEl.append(aura, card);

      bels.go.addEventListener('click', () => { if (orphanMode) { location.reload(); return; } location.assign(BLOCK_EXIT[blockPlatform] || 'https://www.youtube.com/'); });
      bels.watch.addEventListener('click', () => { if (blockWatchUrl) location.assign(location.origin + blockWatchUrl); });
      bels.cont.addEventListener('click', openFriction);
      bels.never.addEventListener('click', () => {
        closeFriction();
        try { bels.cont.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
      });
      bels.input.addEventListener('paste', (e) => e.preventDefault()); // the point is to type it
      bels.input.addEventListener('input', () => {
        setErr(null);
        bels.unlock.disabled = !(fricLeft <= 0 && C.sentenceMatches(bels.input.value, settings.block.level));
        paintTyping();
      });
      bels.unlock.addEventListener('click', submitUnlock);
    }

    /** Lay the sentence out as one small element per letter, so the letters typed correctly can be coloured. */
    function paintSentence(text) {
      bels.fsent.replaceChildren();
      bels.cells = [];
      String(text).split(' ').forEach((word, wi) => {
        if (wi) {
          const sp = mk('span', 'c', ' ');
          bels.fsent.appendChild(sp);
          bels.cells.push(sp);
        }
        const w = mk('span', 'w');
        for (const ch of word) {
          const c = mk('span', 'c', ch);
          w.appendChild(c);
          if (/[a-z]/i.test(ch)) bels.cells.push(c); // only letters and spaces count, like C.sentenceMatches
        }
        bels.fsent.appendChild(w);
      });
      bels.paint = null;
    }

    const HINTS = {
      idle: 'Capital letters and punctuation do not matter.',
      typing: 'Looking right so far.',
      off: 'Not quite. The underlined letter is the next one.',
      almost: 'Almost there.',
      ready: 'Ready. You can unblock, or press Never mind and stay on track.',
    };

    /** Live feedback while typing: matching letters light up, a slip is marked kindly, then "almost there" and "ready". */
    function paintTyping() {
      if (!bels) return;
      const target = normSentence(rulesNow().sentence).trim();
      const full = C.sentenceMatches(bels.input.value, settings.block.level);
      let typed = normSentence(bels.input.value).replace(/^ /, '');
      if (full) typed = target;
      let n = 0;
      while (n < typed.length && n < target.length && typed.charAt(n) === target.charAt(n)) n++;
      const bad = !full && n < typed.length;
      const state = full ? 'ready' : bad ? 'off' : n === 0 ? 'idle' : n / target.length >= 0.75 ? 'almost' : 'typing';
      const sig = state + n;
      if (bels.paint === sig) return;
      const was = bels.paint ? bels.paint.replace(/\d+$/, '') : 'idle';
      bels.paint = sig;
      for (let i = 0; i < bels.cells.length; i++) {
        const cl = bels.cells[i].classList;
        cl.toggle('m', i < n);
        cl.toggle('x', bad && i === n);
      }
      ['typing', 'off', 'almost', 'ready'].forEach((s) => bels.fric.classList.toggle(s, state === s));
      bels.tprog.style.transform = 'scaleX(' + (target.length ? (full ? 1 : n / target.length).toFixed(3) : 0) + ')';
      const hint = HINTS[state];
      if (bels.fhint.textContent !== hint) bels.fhint.textContent = hint;
      if (state === 'ready' && was !== 'ready') {
        bels.fric.classList.remove('pop');
        void bels.fric.offsetWidth; // restart the little pop
        bels.fric.classList.add('pop');
        setTimeout(() => { if (bels) bels.fric.classList.remove('pop'); }, 700);
      }
    }

    function setErr(text) {
      if (!bels) return;
      bels.ferr.hidden = !text;
      if (text) {
        bels.ferr.textContent = text;
        bels.ferr.classList.remove('shake');
        void bels.ferr.offsetWidth; // restart the little shake
        bels.ferr.classList.add('shake');
      }
    }

    /** The words for a refused or failed request. A real failure also says which version ran and what went wrong, so it can be reported. */
    function fricErrorText(r) {
      if (r.why !== 'error' && FRIC_ERRORS[r.why]) return FRIC_ERRORS[r.why];
      let v = '';
      try { v = chrome.runtime.getManifest().version; } catch (e) { /* ignore */ }
      return FRIC_ERRORS.error + ' (v' + v + ': ' + (r.detail || r.why || 'no reply') + ')';
    }

    function showFricError(r) {
      setErr(fricErrorText(typeof r === 'string' ? { why: r } : r));
    }

    /** Show or hide the "no way past this" notice (lockout, Full restriction). */
    function setFixed(text) {
      bels.fixed.hidden = !text;
      bels.notice.hidden = !text;
      if (text) bels.fixed.textContent = text;
    }

    /** Step 1: tell the worker the wait has started. It keeps its own clock, so the wait cannot be shortened from here. */
    function openFriction() {
      if (!bels || fricOpen) return;
      fricOpen = true;
      const rules = rulesNow();
      const label = C.PLATFORMS[blockPlatform].label;
      bels.cont.hidden = true;
      bels.fric.hidden = false;
      bels.ffold.classList.add('open');
      bels.card.classList.add('fopen');
      setErr(null);
      bels.finfo.textContent = 'Take a moment first. After ' + rules.waitSec + ' seconds you can type the sentence. That opens a ' + rules.breakMin + ' minute break for ' + label + ' only.';
      const s = blockStatusNow && blockStatusNow.strikes;
      bels.fwarn.hidden = !s;
      if (s) {
        bels.fwarn.textContent = s.used + 1 >= s.max
          ? 'This is your last unblock. After the break, ' + label + ' stays locked for ' + s.lockHours + ' hours.'
          : 'Unblock ' + (s.used + 1) + ' of ' + s.max + '. Reaching ' + s.max + ' locks ' + label + ' for ' + s.lockHours + ' hours.';
      }
      paintSentence(rules.sentence);
      bels.unlockLabel.textContent = 'Unblock for ' + rules.breakMin + ' minutes';
      bels.input.value = '';
      bels.input.disabled = true;
      bels.unlock.disabled = true;
      fricLeft = rules.waitSec;
      bels.ringPrg.style.transition = 'none';
      bels.ringPrg.style.strokeDashoffset = RING_C.toFixed(2);
      void bels.ringPrg.getBoundingClientRect();
      bels.ringPrg.style.transition = '';
      bels.fric.classList.remove('done');
      drawFriction(rules.waitSec);
      paintTyping();
      try { bels.fric.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
      setTimeout(() => { // once it has unfolded, bring the whole panel into view on a small window
        if (!bels || !fricOpen) return;
        const calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        try { bels.fric.scrollIntoView({ block: 'nearest', behavior: calm ? 'auto' : 'smooth' }); } catch (e) { /* ignore */ }
      }, 480);
      clearInterval(fricTimer);
      blockRequest({ type: 'unlock-start', platform: blockPlatform }, (r) => {
        if (!fricOpen) return;
        if (!r.ok) { closeFriction(); setFixed(fricErrorText(r)); return; }
        const wait = r.waitSec || rules.waitSec;
        fricLeft = wait;
        drawFriction(wait);
        fricTimer = setInterval(() => {
          if (document.visibilityState !== 'visible') return; // the wait only counts while you are looking at this tab
          fricLeft--;
          drawFriction(wait);
          if (fricLeft <= 0) { clearInterval(fricTimer); bels.input.disabled = false; bels.input.focus(); }
        }, 1000);
      });
    }

    function drawFriction(wait) {
      const done = Math.min(1, Math.max(0, (wait - fricLeft) / wait));
      bels.ringPrg.style.strokeDashoffset = (RING_C * (1 - done)).toFixed(2);
      bels.rn.textContent = String(Math.max(0, fricLeft));
      bels.fric.classList.toggle('done', fricLeft <= 0);
      bels.fwait.textContent = fricLeft > 0 ? 'You can continue in ' + fricLeft + ' s' : 'Now type the sentence:';
    }

    /** Step 2: send the sentence. The worker checks the wait, the sentence and the rules again before it opens a break. */
    function submitUnlock() {
      if (fricLeft > 0 || !C.sentenceMatches(bels.input.value, settings.block.level)) return;
      bels.unlock.disabled = true;
      unlocking = true; // if the block lifts because of this, hideBlock plays the "break started" moment
      blockRequest({ type: 'unlock', platform: blockPlatform, sentence: bels.input.value }, (r) => {
        unlocking = false;
        if (r.ok) {
          if (r.locked) pendingNote = { text: C.PLATFORMS[blockPlatform].label + ' will be locked for ' + rulesNow().lockHours + ' hours when this break ends.', ms: 9000 };
          return; // the new state hides this screen
        }
        showFricError(r);
        if (r.why === 'too-soon') openFrictionAgain();
        else bels.unlock.disabled = !C.sentenceMatches(bels.input.value, settings.block.level);
      });
    }

    function openFrictionAgain() {
      fricOpen = false;
      closeFriction();
      openFriction();
    }

    function closeFriction() {
      clearInterval(fricTimer);
      fricOpen = false;
      if (!bels) return;
      bels.fric.hidden = true; // stays in the layout for a moment so it folds away instead of vanishing
      bels.ffold.classList.remove('open');
      bels.card.classList.remove('fopen');
      bels.cont.hidden = !(blockStatusNow && blockStatusNow.canUnlock);
      bels.input.value = '';
      paintTyping();
    }

    /** A calm "break started" moment over the page that comes back (about a second, no clicks taken). */
    function playSplash() {
      if (!root || !host || !host.isConnected) return;
      if (splashEl) splashEl.remove();
      clearTimeout(splashTimer);
      splashEl = mk('div', 'bsplash');
      splashEl.setAttribute('aria-hidden', 'true');
      const sp = mk('div', 'sp');
      const ok = mk('div', 'ok');
      const tick = svgEl('svg', { viewBox: '0 0 24 24', focusable: 'false' });
      tick.appendChild(svgEl('path', { d: 'M5 12.5l4.5 4.5L19 7.5' }));
      ok.appendChild(tick);
      sp.append(ok, mk('h3', '', 'Break started'), mk('p', '', rulesNow().breakMin + ' minutes on ' + C.PLATFORMS[blockPlatform].label + '. Then the block comes back.'));
      splashEl.appendChild(sp);
      root.appendChild(splashEl);
      const mine = splashEl;
      splashTimer = setTimeout(() => { mine.remove(); if (splashEl === mine) splashEl = null; }, 1300);
    }

    /** Called every 300 ms while a reel page is blocked; cheap unless the words change. */
    function showBlock(st, cls) {
      if (!blockEl || !blockEl.isConnected) buildBlock();
      if (!blockEl.parentNode) root.appendChild(blockEl);
      const label = C.PLATFORMS[cls.platform].label;
      blockPlatform = cls.platform;
      blockStatusNow = st;
      // "Watch as a normal video" is only for a plain app block (a shared video you need); never for a focus timer, a lockout or Full restriction
      blockWatchUrl = cls.platform === 'youtube' && cls.id && st.reason === 'app' && settings.block.level !== 'strict' ? '/watch?v=' + encodeURIComponent(cls.id) : '';
      const d = C.describeBlock(st, Date.now(), label);
      const s = st.strikes;
      const key = [st.reason, d.title, d.text, blockWatchUrl, st.canUnlock, s && s.used, s && s.max].join('|');
      if (key !== blockKey) {
        blockKey = key;
        const lockout = st.reason === 'lockout';
        const strict = !st.canUnlock && !lockout; // Full restriction: a timed block that has no way past it
        blockEl.classList.toggle('v-lock', lockout);
        blockEl.classList.toggle('v-strict', strict);
        bels.tag.hidden = !strict;
        bels.title.textContent = d.title;
        bels.text.textContent = d.text;
        bels.watch.hidden = !blockWatchUrl;
        bels.cont.hidden = fricOpen || !st.canUnlock;
        setFixed(st.canUnlock ? '' : lockout
          ? 'There is no unblock option for this one. It lifts by itself when the time is up.'
          : 'Full restriction: this block cannot be unblocked. It lifts by itself when the time is up.');
        const show = st.canUnlock && s && s.max > 0;
        bels.pips.hidden = bels.bpips.hidden = !show;
        if (show) {
          const seen = lastUsed[cls.platform];
          lastUsed[cls.platform] = s.used;
          bels.pips.replaceChildren(...Array.from({ length: s.max }, (_, i) => {
            const pip = mk('i', i < s.used ? 'used' : '');
            pip.style.setProperty('--k', String(i));
            if (i < s.used && seen != null && s.used > seen && i === s.used - 1) pip.classList.add('fresh'); // the one just used
            if (i === s.max - 1 && s.used >= s.max - 1) pip.classList.add('last'); // the next unblock is the last one
            return pip;
          }));
          bels.pips.setAttribute('aria-label', s.used + ' of ' + s.max + ' unblocks used');
          bels.pipsText.textContent = s.used + ' of ' + s.max + ' unblocks used in the last ' + (s.windowMin >= 120 ? Math.round(s.windowMin / 60) + ' hours' : s.windowMin + ' minutes') +
            '. Reaching ' + s.max + ' locks ' + label + ' for ' + s.lockHours + ' hours.';
        }
      }
      if (bels.left.textContent !== d.left) bels.left.textContent = d.left;
      bels.left.hidden = !d.left;
      const t = Date.now();
      if (t - bels.nudgeAt > NUDGE_EVERY_MS) { // a new gentle line every so often, without any timer of its own
        bels.nudgeAt = t;
        bels.nudgeI = (bels.nudgeI + 1) % NUDGES.length;
        bels.nudge.textContent = NUDGES[bels.nudgeI];
        bels.nudge.classList.remove('rot');
        void bels.nudge.offsetWidth;
        bels.nudge.classList.add('rot');
      }
      if (!blockShown) {
        blockShown = true;
        if (splashEl) { splashEl.remove(); splashEl = null; }
        prevOverflow = document.documentElement.style.overflow;
        document.documentElement.style.overflow = 'hidden';
        ['keydown', 'keyup', 'keypress'].forEach((t2) => window.addEventListener(t2, blockKeys, true));
        document.addEventListener('play', stopAgain, true);
        document.addEventListener('volumechange', stopAgain, true);
        try { bels.go.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
      }
      // a video in fullscreen sits above everything, including this screen
      if (document.fullscreenElement) { try { document.exitFullscreen().catch(() => {}); } catch (e) { /* ignore */ } }
      quietVideos();
    }

    function hideBlock() {
      if (!blockShown) return;
      blockShown = false;
      blockKey = '';
      blockStatusNow = null;
      const celebrate = unlocking;
      closeFriction();
      if (blockEl) blockEl.remove();
      document.documentElement.style.overflow = prevOverflow;
      ['keydown', 'keyup', 'keypress'].forEach((t) => window.removeEventListener(t, blockKeys, true));
      document.removeEventListener('play', stopAgain, true);
      document.removeEventListener('volumechange', stopAgain, true);
      releaseVideos();
      if (celebrate) playSplash();
    }

    function nudge(n, resp) {
      const text = message(n.kind, resp);
      if (n.pause) pause(text, C.PLATFORMS[activePlatform].home);
      else if (isl && isl.style.display !== 'none') note(text);
      else toast(text);
    }

    function destroy() {
      clearTimeout(toastTimer);
      clearTimeout(noteTimer);
      clearInterval(pauseTimer);
      clearTimeout(bumpTimer);
      hideBlock(); // gives the page its scrolling, keyboard and sound back
      clearInterval(fricTimer);
      clearTimeout(splashTimer);
      if (host) host.remove();
      host = root = isl = els = toastEl = pauseEl = blockEl = null;
      document.documentElement.style.filter = '';
    }

    // The reel slides when you swipe, the window resizes, the YouTube side bar opens: follow it on every frame
    // (the 300 ms timer below covers tabs where frames are paused).
    (function frame() {
      if (dead) return;
      reposition();
      requestAnimationFrame(frame);
    })();

    return { setIsland, reposition, nudge, note, showBlock, hideBlock, orphanBlock, destroy };
  })();

  // -------------------------------------------------------------------- start

  function applySettings(raw) {
    if (dead) return;
    settings = C.normalizeSettings(raw);
    settingsReady = true;
    // with a hard daily limit nothing may make reels count less: every reel counts after 2 s, timing never stops sooner than 2 minutes idle
    tracker.configure(settings.block.hardLimit
      ? { minDwellSec: Math.min(settings.minDwellSec, 2), idleCutoffSec: Math.max(settings.idleCutoffSec, 120) }
      : settings);
    if (settings.snoozeUntil > Date.now() && !settings.block.hardLimit) tracker.reset();
    applyGreyscale();
    // look at the page again right away (not at the next timer tick), so a resume or a new position
    // shows at once instead of after a flicker
    checkBlock();
    tick();
  }

  function refreshServerState() {
    send({ type: 'peek' }, (resp) => { if (resp) { takeServerState(resp); checkBlock(); render(); } });
  }

  try {
    chrome.storage.local.get(['settings', 'blockState']).then((o) => { blockState = C.normalizeBlockState(o.blockState); applySettings(o.settings); }, () => applySettings());
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes.blockState) { blockState = C.normalizeBlockState(changes.blockState.newValue); if (!changes.settings) { checkBlock(); render(); } }
      if (changes.settings) { applySettings(changes.settings.newValue); refreshServerState(); } // a raised limit must lift a "limit reached" block at once
      if (changes.stats) { // counts deleted or lowered from the dashboard
        const nv = changes.stats.newValue;
        const day = nv && nv[C.dayKey(new Date())];
        if (!day || day.r < totals.r) refreshServerState();
      }
    });
  } catch (e) {
    return;
  }

  send({ type: 'peek' }, (resp) => {
    if (resp) {
      takeServerState(resp);
      applyGreyscale();
      checkBlock();
      render();
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
    else if (!dead) { checkBlock(); render(); ui.reposition(); } // back on this tab: show the current state, not the one from before
  });
  window.addEventListener('pagehide', flush);

  timer = setInterval(tick, TICK_MS);
  // The reel slides when you swipe or resize the window; keep the island on it.
  const follow = setInterval(() => { if (dead) clearInterval(follow); else { checkBlock(); ui.reposition(); } }, 300);
  window.addEventListener('resize', () => ui.reposition());
})();
