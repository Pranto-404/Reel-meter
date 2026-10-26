/*
 * Reel Meter - core logic.
 *
 * Pure functions only: no DOM, no chrome.* calls. The same file runs in the
 * content script, the background worker, the extension pages and Node tests.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ReelCore = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  // ---------------------------------------------------------------- platforms

  const PLATFORM_ORDER = ['youtube', 'instagram', 'tiktok', 'facebook'];

  const PLATFORMS = {
    youtube: { label: 'YouTube Shorts', home: 'https://www.youtube.com/' },
    instagram: { label: 'Instagram Reels', home: 'https://www.instagram.com/' },
    tiktok: { label: 'TikTok', home: 'https://www.tiktok.com/' },
    facebook: { label: 'Facebook Reels', home: 'https://www.facebook.com/' },
  };

  const SITES = {
    'youtube.com': 'youtube',
    'instagram.com': 'instagram',
    'tiktok.com': 'tiktok',
    'facebook.com': 'facebook',
  };

  /** "www.youtube.com." / "de-de.facebook.com" / "mbasic.facebook.com" -> the plain site name. */
  function normHost(hostname) {
    return String(hostname || '').toLowerCase().replace(/\.$/, '').replace(/^(?:www|m|web|mobile|mbasic|touch|[a-z]{2}-[a-z]{2})\./, '');
  }

  /** Which app a host name belongs to ("www.youtube.com" -> "youtube"), or null. */
  function platformOfHost(hostname) {
    const host = normHost(hostname);
    return Object.prototype.hasOwnProperty.call(SITES, host) ? SITES[host] : null;
  }

  /** True only for the four known app names (never for "__proto__" and friends). */
  function isPlatform(p) {
    return typeof p === 'string' && PLATFORM_ORDER.includes(p);
  }

  /**
   * Decide whether a URL is a short-video page.
   * Returns { platform, id, feed } or null.
   *   id   - the reel id from the URL when the site puts one there
   *   feed - true for endless feeds whose URL never changes (e.g. TikTok For You);
   *          there the content script tells reels apart by which <video> is on screen
   * Only the host and path are read; nothing is stored.
   */
  function classify(hostname, pathname) {
    const platform = platformOfHost(hostname);
    if (!platform) return null;
    const path = String(pathname || '/');
    let m;
    switch (platform) {
      case 'youtube':
        if ((m = /^\/shorts\/([\w-]{3,})/.exec(path))) return { platform, id: m[1], feed: false };
        return null;
      case 'instagram':
        if ((m = /^\/reels?\/(?!audio(?:\/|$))([\w-]+)/.exec(path))) return { platform, id: m[1], feed: false };
        if ((m = /^\/[\w.]+\/reels?\/([\w-]+)/.exec(path))) return { platform, id: m[1], feed: false }; // /<user>/reel/<id>
        if (/^\/reels\/?$/.test(path)) return { platform, id: null, feed: true };
        return null;
      case 'tiktok':
        if ((m = /^\/(?:@[^/]+\/)?video\/(\d+)/.exec(path))) return { platform, id: m[1], feed: false };
        if (/^(?:\/[a-z]{2}(?:-[a-z]{2})?)?(?:\/(?:foryou|following|friends))?\/?$/i.test(path)) {
          return { platform, id: null, feed: true };
        }
        return null;
      case 'facebook':
        if ((m = /^\/reels?\/(\d+)/.exec(path))) return { platform, id: m[1], feed: false };
        if ((m = /^\/share\/r\/([\w-]+)/.exec(path))) return { platform, id: m[1], feed: false };
        if (/^\/reels?\/?$/.test(path)) return { platform, id: null, feed: true };
        return null;
      default:
        return null;
    }
  }

  // ----------------------------------------------------------------- settings

  const DEFAULTS = Object.freeze({
    minDwellSec: 2, // a reel counts once it has played this long
    idleCutoffSec: 120, // stop timing after this long without touching the page
    dailyReelLimit: 0, // 0 = off
    dailyMinuteLimit: 0, // 0 = off
    streakNudge: 25, // gentle reminder every N reels in a row (0 = off)
    nearLimitNudge: true, // heads-up at 80% of a limit
    mindfulPause: true, // 10 second breathing pause when a limit is reached
    greyscaleOverLimit: false,
    showCounter: true,
    counterCorner: 'video-top', // where the live counter sits (dragging it is temporary and never saved)
    showBadge: true,
    platforms: { youtube: true, instagram: true, tiktok: true, facebook: true },
    snoozeUntil: 0, // epoch ms; tracking is paused until then
  });

  const CORNERS = ['video-top', 'top-center', 'middle-right', 'bottom-left', 'bottom-right', 'top-left', 'top-right'];

  function clampInt(v, min, max, fallback) {
    const n = Math.round(Number(v));
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  function bool(v, fallback) {
    return typeof v === 'boolean' ? v : fallback;
  }

  /** Merge stored settings with defaults and clamp every value to a sane range. */
  function normalizeSettings(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const d = DEFAULTS;
    const platforms = {};
    for (const p of PLATFORM_ORDER) {
      platforms[p] = bool(r.platforms && r.platforms[p], d.platforms[p]);
    }
    // A dragged position (r.counterPos) used to be saved by version 1.0.0. It is dropped here on purpose:
    // the counter always starts at its chosen place, and every settings write removes the old value.
    return {
      minDwellSec: clampInt(r.minDwellSec, 1, 10, d.minDwellSec),
      idleCutoffSec: clampInt(r.idleCutoffSec, 30, 600, d.idleCutoffSec),
      dailyReelLimit: clampInt(r.dailyReelLimit, 0, 5000, d.dailyReelLimit),
      dailyMinuteLimit: clampInt(r.dailyMinuteLimit, 0, 1440, d.dailyMinuteLimit),
      streakNudge: clampInt(r.streakNudge, 0, 500, d.streakNudge),
      nearLimitNudge: bool(r.nearLimitNudge, d.nearLimitNudge),
      mindfulPause: bool(r.mindfulPause, d.mindfulPause),
      greyscaleOverLimit: bool(r.greyscaleOverLimit, d.greyscaleOverLimit),
      showCounter: bool(r.showCounter, d.showCounter),
      counterCorner: CORNERS.includes(r.counterCorner) ? r.counterCorner : d.counterCorner,
      showBadge: bool(r.showBadge, d.showBadge),
      platforms,
      snoozeUntil: clampInt(r.snoozeUntil, 0, 8.64e15, 0),
      block: normalizeBlock(r.block),
    };
  }

  // ----------------------------------------------------------------- blocking
  //
  // Optional "reel blocker". On a reel page the extension can replace the page with a block screen.
  //
  // Two kinds of data, kept apart on purpose:
  //   settings.block  what the user configured: level, blocked apps, schedules, hard limit, Shorts as videos.
  //   blockState      what is running: focus timers, breaks, recent unblocks and lockouts, ALL PER APP.
  //                   Only the background worker changes it (one at a time), so tabs and pages cannot overwrite each other.
  // Every block decision is per app: unblocking Facebook never unblocks YouTube.
  //
  // Why a page is blocked (first match wins): lockout, focus timer, schedule, hard daily limit, per-app block.
  // The way past a block is a short challenge (wait, then type a sentence) that opens a 5 minute break.
  // Unblocking too often triggers a lockout: after N unblocks inside a time window the app stays blocked for hours.
  // How strict all of that is depends on the restriction level.

  const BLOCK_LEVELS = ['gentle', 'balanced', 'strict'];
  const LEVELS = Object.freeze({
    gentle: Object.freeze({
      label: 'Less restriction', waitSec: 10, breakMin: 5, strikes: 5, strikeWindowMin: 60, lockHours: 1,
      sentence: 'I choose to keep scrolling', timedUnlock: true, settingsChange: 'challenge',
      blurb: 'A short pause, then you decide. Five unblocks in an hour lock that app for an hour.',
    }),
    balanced: Object.freeze({
      label: 'Restricted', waitSec: 30, breakMin: 5, strikes: 3, strikeWindowMin: 180, lockHours: 6,
      sentence: 'I choose to keep scrolling', timedUnlock: true, settingsChange: 'challenge',
      blurb: 'A 30 second wait and a typed sentence. Three unblocks within three hours lock that app for 6 hours.',
    }),
    strict: Object.freeze({
      label: 'Full restriction', waitSec: 60, breakMin: 5, strikes: 2, strikeWindowMin: 1440, lockHours: 12,
      sentence: 'I know this is against my plan and I choose to scroll anyway', timedUnlock: false, settingsChange: 'never',
      blurb: 'A 60 second wait and a longer sentence. Focus timers, schedules and the daily limit cannot be unblocked at all, two unblocks in a day lock that app for 12 hours, and a running block cannot be loosened.',
    }),
  });
  const MAX_SCHEDULES = 5;
  const FOCUS_CHOICES_MIN = [30, 60, 120, 240];
  const FOCUS_MAX_MS = 12 * 3600000; // a focus timer can never be stacked beyond 12 hours from now
  const BLOCK_MODES = ['count', 'block'];
  const TIMED_REASONS = ['focus', 'schedule', 'limit', 'lockout'];
  // the longest a break or a lock can ever run, from now: stored times beyond this come from a wrong clock and are cut back
  const MAX_BREAK_MS = Math.max.apply(null, BLOCK_LEVELS.map((l) => LEVELS[l].breakMin)) * 60000;
  const MAX_LOCK_MS = Math.max.apply(null, BLOCK_LEVELS.map((l) => LEVELS[l].lockHours)) * 3600000 + MAX_BREAK_MS;

  function levelRules(level) {
    return LEVELS[level] || LEVELS.balanced;
  }

  /** "07:30" -> 450, anything invalid -> null */
  function parseHm(s) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(s == null ? '' : s).trim());
    if (!m) return null;
    const h = Number(m[1]);
    const min = Number(m[2]);
    return h <= 23 && min <= 59 ? h * 60 + min : null;
  }

  function fmtHm(mins) {
    return pad2(Math.floor(mins / 60) % 24) + ':' + pad2(mins % 60);
  }

  function normalizeSchedule(raw, i) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const days = [...new Set((Array.isArray(r.days) ? r.days : [0, 1, 2, 3, 4, 5, 6])
      .map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
    const start = parseHm(r.start);
    const end = parseHm(r.end);
    return {
      id: typeof r.id === 'string' && /^[\w-]{1,24}$/.test(r.id) ? r.id : 's' + i,
      on: bool(r.on, true),
      days,
      start: fmtHm(start === null ? 22 * 60 : start),
      end: fmtHm(end === null ? 7 * 60 : end),
    };
  }

  /** The user's block configuration, clean and bounded. (Running state lives in blockState, see below.) */
  function normalizeBlock(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const apps = {};
    for (const p of PLATFORM_ORDER) apps[p] = r.apps && BLOCK_MODES.includes(r.apps[p]) ? r.apps[p] : 'count';
    const seen = new Set();
    const schedules = (Array.isArray(r.schedules) ? r.schedules : []).slice(0, MAX_SCHEDULES).map(normalizeSchedule)
      .filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true)));
    return {
      level: BLOCK_LEVELS.includes(r.level) ? r.level : 'balanced',
      apps,
      hardLimit: bool(r.hardLimit, false),
      schedules,
      shortsAsVideos: bool(r.shortsAsVideos, false),
    };
  }

  const perApp = (fill) => { const o = {}; for (const p of PLATFORM_ORDER) o[p] = typeof fill === 'function' ? fill(p) : fill; return o; };

  function emptyBlockState() {
    return { focus: perApp(0), breaks: perApp(0), lockUntil: perApp(0), unlocks: perApp(() => []), loosenUnlocks: [], loosenLock: 0 };
  }

  const cleanTimes = (list, now) => (Array.isArray(list) ? list : [])
    .map(Number).filter((t) => Number.isFinite(t) && t > 0).map((t) => (now === undefined ? t : Math.min(t, now))).sort((a, b) => a - b).slice(-20);

  /**
   * The running block state, clean and bounded. With `now`, every end time is also cut back to the longest it can
   * legitimately be from now, so a clock that was wrong (or moved on purpose) at the moment of writing cannot leave
   * a break or a lock running for years, and unblock times from the "future" count as now.
   */
  function normalizeBlockState(raw, now) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const out = emptyBlockState();
    const cap = (v, max) => (now === undefined ? v : Math.min(v, now + max));
    for (const p of PLATFORM_ORDER) {
      out.focus[p] = cap(clampInt(r.focus && r.focus[p], 0, 8.64e15, 0), FOCUS_MAX_MS);
      out.breaks[p] = cap(clampInt(r.breaks && r.breaks[p], 0, 8.64e15, 0), MAX_BREAK_MS);
      out.lockUntil[p] = cap(clampInt(r.lockUntil && r.lockUntil[p], 0, 8.64e15, 0), MAX_LOCK_MS);
      out.unlocks[p] = cleanTimes(r.unlocks && r.unlocks[p], now);
    }
    out.loosenUnlocks = cleanTimes(r.loosenUnlocks, now);
    out.loosenLock = cap(clampInt(r.loosenLock, 0, 8.64e15, 0), MAX_LOCK_MS);
    return out;
  }

  /** Settings with the running state merged into `block`: the shape every decision function below takes. Pass `now`. */
  function withBlockState(settings, state, now) {
    return Object.assign({}, settings, { block: Object.assign({}, settings.block, normalizeBlockState(state, now)) });
  }

  function weekdayOf(date) {
    return (date.getDay() + 6) % 7; // Monday = 0
  }

  /** Is this schedule blocking at `date`? Overnight windows (22:00 to 07:00) belong to the day they start on. */
  function scheduleActive(s, date) {
    if (!s || !s.on) return false;
    const a = parseHm(s.start);
    const b = parseHm(s.end);
    if (a === null || b === null || a === b) return false;
    const m = date.getHours() * 60 + date.getMinutes();
    const wd = weekdayOf(date);
    if (a < b) return s.days.includes(wd) && m >= a && m < b;
    return (s.days.includes(wd) && m >= a) || (s.days.includes((wd + 6) % 7) && m < b);
  }

  /** When the window that is active at `date` ends (epoch ms). Only meaningful while scheduleActive is true. */
  function scheduleEnd(s, date) {
    const a = parseHm(s.start);
    const b = parseHm(s.end);
    const m = date.getHours() * 60 + date.getMinutes();
    const end = new Date(date.getTime());
    end.setHours(Math.floor(b / 60), b % 60, 0, 0);
    if (a > b && m >= a) end.setDate(end.getDate() + 1);
    return end.getTime();
  }

  function nextMidnight(now) {
    const d = new Date(now);
    d.setHours(24, 0, 0, 0);
    return d.getTime();
  }

  /** Recent unblocks of one app, and how many it takes to trigger the lockout. */
  function strikeInfo(eff, platform, now) {
    const rules = levelRules(eff.block.level);
    const recent = eff.block.unlocks[platform].filter((t) => t > now - rules.strikeWindowMin * 60000);
    return { used: recent.length, max: rules.strikes, lockHours: rules.lockHours, windowMin: rules.strikeWindowMin };
  }

  /**
   * Why is this app (or, with no platform, any app) blocked right now, ignoring breaks and the page? null when nothing blocks.
   * `eff` is settings merged with the block state. `limitOver` is whether today's limit has been reached.
   */
  function blockReason(eff, now, limitOver, platform) {
    const b = eff.block;
    const apps = platform ? [platform] : PLATFORM_ORDER;
    const lock = Math.max.apply(null, apps.map((p) => b.lockUntil[p]));
    if (lock > now) return { reason: 'lockout', until: lock };
    const focus = Math.max.apply(null, apps.map((p) => b.focus[p]));
    if (focus > now) return { reason: 'focus', until: focus };
    const date = new Date(now);
    const active = b.schedules.filter((s) => scheduleActive(s, date));
    if (active.length) return { reason: 'schedule', until: Math.max.apply(null, active.map((s) => scheduleEnd(s, date))) };
    if (b.hardLimit && limitOver) return { reason: 'limit', until: nextMidnight(now) };
    if (apps.some((p) => b.apps[p] === 'block')) return { reason: 'app', until: null };
    return null;
  }

  /**
   * What to do with this page. ctx = { now, cls (from classify, or null), limitOver }.
   * Returns { action: 'allow' | 'block' | 'redirect', reason, until, url, onBreak, timed, canUnlock, strikes }.
   */
  function blockStatus(eff, ctx) {
    const b = eff.block;
    const p = ctx.cls && ctx.cls.platform;
    if (!p) return { action: 'allow' };
    const now = ctx.now;
    if (b.breaks[p] > now) return { action: 'allow', onBreak: true, until: b.breaks[p] }; // a break comes before a lockout that starts after it
    const why = blockReason(eff, now, !!ctx.limitOver, p);
    if (why) {
      const timed = TIMED_REASONS.includes(why.reason);
      const canUnlock = why.reason !== 'lockout' && !(timed && !levelRules(b.level).timedUnlock);
      return { action: 'block', reason: why.reason, until: why.until, timed, canUnlock, strikes: strikeInfo(eff, p, now) };
    }
    if (b.shortsAsVideos && p === 'youtube' && ctx.cls.id) {
      return { action: 'redirect', reason: 'shorts', url: '/watch?v=' + encodeURIComponent(ctx.cls.id) };
    }
    return { action: 'allow' };
  }

  /** Apps that are blocked right now (not on a break). */
  function blockedPlatforms(eff, now, limitOver) {
    return PLATFORM_ORDER.filter((p) => eff.block.breaks[p] <= now && blockReason(eff, now, !!limitOver, p) !== null);
  }

  /** True while some block would stop reels (used to lock settings that weaken it). */
  function blockActiveNow(eff, now, limitOver) {
    return blockedPlatforms(eff, now, limitOver).length > 0;
  }

  /** Is any app in a lockout (including one that starts when its break ends)? */
  function lockoutActive(eff, now) {
    return PLATFORM_ORDER.some((p) => eff.block.lockUntil[p] > now);
  }

  /** Words for the block screen. */
  function describeBlock(status, now, platformLabel) {
    const left = status.until ? status.until - now : 0;
    switch (status.reason) {
      case 'lockout':
        return { title: 'Locked for a while', text: 'You unblocked ' + (platformLabel || 'this app') + ' several times in a row, so it stays blocked until ' + formatClock(status.until) + '. This is the plan you chose.', left: formatLeft(left) };
      case 'focus':
        return { title: 'Focus time', text: 'Reels are blocked on ' + (platformLabel || 'this app') + ' while your focus timer runs.', left: formatLeft(left) };
      case 'schedule':
        return { title: 'Blocked by your schedule', text: 'Reels are blocked until ' + formatClock(status.until) + '.', left: formatLeft(left) };
      case 'limit':
        return { title: 'Daily limit reached', text: 'You reached today’s limit, so reels stay blocked until midnight.', left: formatLeft(left) };
      default:
        return { title: 'Reels are blocked', text: (platformLabel || 'This app') + ' is set to block reels.', left: '' };
    }
  }

  /** Typed unlock sentence: case, spacing and punctuation are forgiven. */
  function sentenceMatches(typed, level) {
    const norm = (x) => String(x == null ? '' : x).toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
    return norm(typed) === norm(levelRules(level).sentence);
  }

  /** What an unblock would do: { ok, why } where why is 'lockout' | 'strict' | 'not-blocked' when it is refused. */
  function unlockCheck(eff, platform, now, limitOver) {
    const st = blockStatus(eff, { now, cls: { platform, id: null, feed: true }, limitOver });
    if (st.action !== 'block') return { ok: false, why: 'not-blocked' };
    if (st.reason === 'lockout') return { ok: false, why: 'lockout' };
    if (!st.canUnlock) return { ok: false, why: 'strict' };
    return { ok: true, status: st };
  }

  /**
   * The challenge was passed: open a break for this app only, count it, and start a lockout when it was one too many.
   * Returns { state, breakUntil, used, max, locked, lockUntil }. `state` is the whole new block state.
   */
  function applyUnlock(eff, platform, now) {
    const rules = levelRules(eff.block.level);
    const state = normalizeBlockState(eff.block);
    const breakUntil = now + rules.breakMin * 60000;
    const history = state.unlocks[platform];
    // count only the window, but never throw older times away when saving: a clock moved forward must not wipe the history
    const recent = history.filter((t) => t > now - rules.strikeWindowMin * 60000).concat(now);
    state.breaks[platform] = breakUntil;
    let locked = false;
    if (recent.length >= rules.strikes) {
      locked = true;
      state.lockUntil[platform] = breakUntil + rules.lockHours * 3600000; // the lock starts when the break ends
      state.unlocks[platform] = []; // the strikes are used up: a clean slate once the lock is over
    } else {
      state.unlocks[platform] = history.concat(now).slice(-20);
    }
    return { state, breakUntil, used: recent.length, max: rules.strikes, locked, lockUntil: state.lockUntil[platform] };
  }

  /** "Block now": end the break early. Making a block stronger never needs a challenge. */
  function applyEndBreak(state, platform) {
    const next = normalizeBlockState(state);
    next.breaks[platform] = 0;
    return next;
  }

  /** Start or extend a focus timer for some apps. Never beyond 12 hours from now; ends any break on those apps. */
  function applyFocus(state, platforms, minutes, now) {
    const next = normalizeBlockState(state);
    if (!Number.isFinite(minutes) || !(minutes > 0)) return next;
    for (const p of platforms) {
      if (!isPlatform(p)) continue;
      next.focus[p] = Math.min(Math.max(next.focus[p], now) + minutes * 60000, now + FOCUS_MAX_MS);
      next.breaks[p] = 0;
    }
    return next;
  }

  /** Minutes of a reference week that some schedule blocks (minute by minute, so no trimming slips through). */
  function scheduleCoverage(list) {
    const cells = new Set();
    if (!list.length) return cells;
    for (let wd = 0; wd < 7; wd++) {
      for (let m = 0; m < 1440; m++) {
        const d = new Date(2026, 0, 5 + wd, Math.floor(m / 60), m % 60);
        if (list.some((s) => scheduleActive(s, d))) cells.add(wd * 1440 + m);
      }
    }
    return cells;
  }

  /**
   * Changing settings through the dashboard is "loosening" too, and is counted like an unblock: too many in a window
   * and no loosening is possible for hours. Returns { state, used, max, locked, lockUntil }.
   */
  function applyLoosen(eff, now) {
    const rules = levelRules(eff.block.level);
    const state = normalizeBlockState(eff.block);
    const recent = state.loosenUnlocks.filter((t) => t > now - rules.strikeWindowMin * 60000).concat(now);
    let locked = false;
    if (recent.length >= rules.strikes) {
      locked = true;
      state.loosenLock = now + rules.lockHours * 3600000;
      state.loosenUnlocks = [];
    } else {
      state.loosenUnlocks = state.loosenUnlocks.concat(now).slice(-20);
    }
    return { state, used: recent.length, max: rules.strikes, locked, lockUntil: state.loosenLock };
  }

  /** Is something configured or running that a lower level would weaken? */
  function protectedNow(b, now) {
    const configured = PLATFORM_ORDER.some((p) => b.apps[p] === 'block') || b.hardLimit || b.schedules.some((s) => s.on);
    const running = !!b.focus && PLATFORM_ORDER.some((p) => b.focus[p] > now || b.breaks[p] > now || b.lockUntil[p] > now);
    return configured || running;
  }

  /**
   * Would saving `newS` make the block weaker than `oldS`? `oldS` may carry the running state (see withBlockState).
   * It does not matter whether a block happens to be running at this very moment: a schedule is protected at 21:59 as
   * much as at 22:00. While a hard daily limit is on, anything that makes reels count less is a loosening too
   * (turning an app off in "Apps to track", counting a reel later, timing less).
   */
  function weakens(oldS, newS, now) {
    const o = oldS.block;
    const n = newS.block;
    if (BLOCK_LEVELS.indexOf(n.level) < BLOCK_LEVELS.indexOf(o.level) && protectedNow(o, now === undefined ? Date.now() : now)) return true;
    if (PLATFORM_ORDER.some((p) => o.apps[p] === 'block' && n.apps[p] !== 'block')) return true;
    if (o.shortsAsVideos && !n.shortsAsVideos) return true;
    if (o.hardLimit) {
      if (!n.hardLimit) return true;
      const loose = (a, b) => a > 0 && (b === 0 || b > a); // limit removed or raised
      if (loose(oldS.dailyReelLimit, newS.dailyReelLimit) || loose(oldS.dailyMinuteLimit, newS.dailyMinuteLimit)) return true;
      if (PLATFORM_ORDER.some((p) => oldS.platforms[p] && !newS.platforms[p])) return true;
      if (newS.minDwellSec > oldS.minDwellSec || newS.idleCutoffSec < oldS.idleCutoffSec) return true;
    }
    const before = scheduleCoverage(o.schedules);
    const after = scheduleCoverage(n.schedules);
    for (const c of before) if (!after.has(c)) return true;
    return false;
  }

  /**
   * May this settings change be saved?
   *   'free'          yes
   *   'challenge'     only after the wait-and-type challenge (counted like an unblock)
   *   'denied-lock'   no: an app is in a lockout, or too many loosenings happened recently
   *   'denied-strict' no: Full restriction does not let a block be loosened from the dashboard
   * It never matters whether a block is running at this very moment (that was a loophole).
   */
  function changePolicy(eff, newS, now) {
    if (!weakens(eff, newS, now)) return 'free';
    if (lockoutActive(eff, now) || eff.block.loosenLock > now) return 'denied-lock';
    return levelRules(eff.block.level).settingsChange === 'never' ? 'denied-strict' : 'challenge';
  }

  // ------------------------------------------------------------------ tracker

  /**
   * Turns once-a-second observations into "seconds watched" and "new reel" events.
   *
   * It never sees page content. Each tick gets only:
   *   platform     - which site we are on (null when not on a reel page)
   *   key          - an opaque string that changes when the reel changes
   *   playing      - a video is on screen and actually playing
   *   visible      - the tab is visible
   *   lastInputAt  - when the user last touched the page (ms)
   */
  class ReelTracker {
    constructor(opts) {
      this.maxStepMs = 2500; // a longer gap (laptop asleep, throttled tab) is not counted
      this.configure(opts || {});
      this.reset();
    }

    configure(opts) {
      this.minDwellMs = (opts.minDwellSec != null ? opts.minDwellSec : DEFAULTS.minDwellSec) * 1000;
      this.idleCutoffMs = (opts.idleCutoffSec != null ? opts.idleCutoffSec : DEFAULTS.idleCutoffSec) * 1000;
    }

    reset() {
      this.lastTick = null;
      this.curKey = null;
      this.dwellMs = 0;
      this.counted = null;
    }

    tick(now, s) {
      const dt = this.lastTick == null ? 0 : Math.min(Math.max(now - this.lastTick, 0), this.maxStepMs);
      this.lastTick = now;

      if (!s || !s.platform || !s.key) {
        this.curKey = null;
        this.dwellMs = 0;
        this.counted = null;
        return { addMs: 0, newReel: false, active: false };
      }

      if (s.key !== this.curKey) {
        this.curKey = s.key;
        this.dwellMs = 0;
      }

      const idle = now - s.lastInputAt > this.idleCutoffMs;
      const active = !!(s.visible && s.playing && !idle);
      if (!active) return { addMs: 0, newReel: false, active: false };

      this.dwellMs += dt;
      let newReel = false;
      if (this.dwellMs >= this.minDwellMs && this.counted !== this.curKey) {
        this.counted = this.curKey;
        newReel = true;
      }
      return { addMs: dt, newReel, active: true };
    }
  }

  // -------------------------------------------------------------------- dates

  function pad2(n) {
    return n < 10 ? '0' + n : String(n);
  }

  /** Local calendar day as YYYY-MM-DD (never UTC, so late-night scrolling lands on the right day). */
  function dayKey(date) {
    return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate());
  }

  function parseDayKey(key) {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d, 12); // noon: immune to DST shifts
  }

  function addDays(key, n) {
    const d = parseDayKey(key);
    d.setDate(d.getDate() + n);
    return dayKey(d);
  }

  /** Monday = 0 ... Sunday = 6 */
  function weekdayIndex(key) {
    return (parseDayKey(key).getDay() + 6) % 7;
  }

  // -------------------------------------------------------------------- stats
  //
  // stats = { 'YYYY-MM-DD': { r: reels, s: seconds, p: { youtube: {r, s}, ... }, h: [24 x seconds] } }
  // Only these totals are stored. No URLs, ids, titles or timestamps of single reels.

  function emptyDay() {
    return { r: 0, s: 0, p: {}, h: new Array(24).fill(0) };
  }

  function getDay(stats, key) {
    const d = stats && stats[key];
    if (!d) return emptyDay();
    return {
      r: d.r || 0,
      s: d.s || 0,
      p: d.p || {},
      h: Array.isArray(d.h) && d.h.length === 24 ? d.h : new Array(24).fill(0),
    };
  }

  function recordActivity(stats, date, ev) {
    const key = dayKey(date);
    const day = stats[key] || (stats[key] = emptyDay());
    if (!Array.isArray(day.h) || day.h.length !== 24) day.h = new Array(24).fill(0);
    if (!day.p) day.p = {};
    day.r += ev.reels;
    day.s += ev.seconds;
    const p = day.p[ev.platform] || (day.p[ev.platform] = { r: 0, s: 0 });
    p.r += ev.reels;
    p.s += ev.seconds;
    day.h[date.getHours()] += ev.seconds;
    return stats;
  }

  function pruneStats(stats, todayKey, keepDays) {
    const cutoff = addDays(todayKey, -(keepDays || 400));
    for (const k of Object.keys(stats)) if (k < cutoff) delete stats[k];
    return stats;
  }

  /** The n days ending at endKey, oldest first. */
  function rangeDays(stats, endKey, n) {
    const out = [];
    for (let i = n - 1; i >= 0; i--) {
      const key = addDays(endKey, -i);
      out.push(Object.assign({ key }, getDay(stats, key)));
    }
    return out;
  }

  function sumDays(days) {
    const total = { r: 0, s: 0, p: {} };
    for (const d of days) {
      total.r += d.r;
      total.s += d.s;
      for (const [name, v] of Object.entries(d.p || {})) {
        const t = total.p[name] || (total.p[name] = { r: 0, s: 0 });
        t.r += v.r || 0;
        t.s += v.s || 0;
      }
    }
    return total;
  }

  /** 7 (Mon..Sun) x 24 (hour) matrix of seconds over the n days ending at endKey. */
  function weekdayHourHeat(stats, endKey, n) {
    const grid = Array.from({ length: 7 }, () => new Array(24).fill(0));
    for (const d of rangeDays(stats, endKey, n)) {
      const row = grid[weekdayIndex(d.key)];
      for (let h = 0; h < 24; h++) row[h] += d.h[h] || 0;
    }
    return grid;
  }

  // ------------------------------------------------------------------- limits

  function evaluateLimits(settings, day) {
    const reelsPct = settings.dailyReelLimit > 0 ? day.r / settings.dailyReelLimit : 0;
    const minsPct = settings.dailyMinuteLimit > 0 ? day.s / 60 / settings.dailyMinuteLimit : 0;
    const pct = Math.max(reelsPct, minsPct);
    const hasLimit = settings.dailyReelLimit > 0 || settings.dailyMinuteLimit > 0;
    return { hasLimit, reelsPct, minsPct, pct, over: hasLimit && pct >= 1, near: hasLimit && pct >= 0.8 && pct < 1 };
  }

  /** true / false when a limit exists, null when the user has not set a goal. */
  function goalMet(settings, day) {
    const lim = evaluateLimits(settings, day);
    if (!lim.hasLimit) return null;
    return !lim.over;
  }

  /** Days in a row (ending today) that stayed under the limit, counting only days since install. */
  function goalStreak(stats, endKey, settings, installedOn) {
    if (!evaluateLimits(settings, emptyDay()).hasLimit) return 0;
    let streak = 0;
    for (let i = 0; i < 365; i++) {
      const key = addDays(endKey, -i);
      if (installedOn && key < installedOn) break;
      if (!goalMet(settings, getDay(stats, key))) break;
      streak++;
    }
    return streak;
  }

  // ------------------------------------------------------------------ nudges

  const SESSION_GAP_MS = 5 * 60 * 1000; // a break this long ends a "streak"
  const LIMIT_REMIND_REELS = 10;
  const LIMIT_REMIND_SEC = 600;

  function newSession(now, carry) {
    return {
      start: now,
      last: now,
      streak: 0,
      sec: 0,
      streakNudges: 0,
      limitDay: carry ? carry.limitDay : '',
      limitReels: carry ? carry.limitReels : 0,
      limitSec: carry ? carry.limitSec : 0,
      nearDay: carry ? carry.nearDay : '',
    };
  }

  function advanceSession(session, now, reels, seconds) {
    let s;
    if (session && now - session.last <= SESSION_GAP_MS) s = Object.assign({}, session);
    else s = newSession(now, session);
    s.last = now;
    s.streak += reels;
    s.sec += seconds;
    return s;
  }

  /**
   * Pick at most one nudge for this update. Gentle by design:
   * limit > near-limit > streak, and each fires once (or every 10 reels over the limit).
   */
  function decideNudge(settings, day, dk, session) {
    const s = Object.assign({}, session);
    const lim = evaluateLimits(settings, day);
    let nudge = null;

    const streakCount = settings.streakNudge > 0 ? Math.floor(s.streak / settings.streakNudge) : 0;
    const streakDue = streakCount > s.streakNudges;
    s.streakNudges = Math.max(s.streakNudges, streakCount);

    if (lim.over) {
      const first = s.limitDay !== dk;
      const moreReels = day.r - s.limitReels >= LIMIT_REMIND_REELS;
      const moreSec = day.s - s.limitSec >= LIMIT_REMIND_SEC;
      if (first || moreReels || moreSec) {
        nudge = { kind: first ? 'limit' : 'limit-more', pause: first && settings.mindfulPause };
        s.limitDay = dk;
        s.limitReels = day.r;
        s.limitSec = day.s;
      }
    } else if (lim.near && settings.nearLimitNudge && s.nearDay !== dk) {
      nudge = { kind: 'near' };
      s.nearDay = dk;
    }
    if (!nudge && streakDue) nudge = { kind: 'streak' };
    return { nudge, session: s };
  }

  // ------------------------------------------------------------- presentation

  function formatDuration(sec) {
    sec = Math.max(0, Math.round(sec));
    if (sec < 60) return sec + 's';
    const m = Math.floor(sec / 60);
    if (m < 60) return m + 'm';
    return Math.floor(m / 60) + 'h ' + pad2(m % 60) + 'm';
  }

  /** Local clock time as HH:MM (24 hour), for "paused until 14:35". */
  function formatClock(ms) {
    const d = new Date(ms);
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  /** "45s left", "14m left", "1h 05m left". Rounds up so a fresh 15 minute pause reads "15m left". */
  function formatLeft(ms) {
    if (!(ms > 0)) return '0s left';
    const secs = Math.ceil(ms / 1000);
    if (secs < 60) return secs + 's left';
    const mins = Math.ceil(secs / 60);
    if (mins < 60) return mins + 'm left';
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return h + 'h' + (m ? ' ' + pad2(m) + 'm' : '') + ' left';
  }

  /** True when a pause ends exactly at a local midnight, which is what "Rest of today" in the popup sets. */
  function isRestOfDay(until) {
    if (!(until > 0)) return false;
    const d = new Date(until);
    return d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0 && d.getMilliseconds() === 0;
  }

  /**
   * Plain-language description of a pause for the on-page counter.
   *   short - fits on the compact bar ("14m left", "till midnight")
   *   long  - one sentence for the opened card
   *   rest  - the pause lasts until midnight, so "+15m" makes no sense
   */
  function describeSnooze(until, now) {
    const left = until - now;
    if (!(left > 0)) return { active: false, left: 0, rest: false, short: '', long: '' };
    const rest = isRestOfDay(until);
    return {
      active: true,
      left,
      rest,
      short: rest ? 'till midnight' : formatLeft(left),
      long: 'Tracking paused until ' + (rest ? 'midnight' : formatClock(until)),
    };
  }

  /** New end time for "+15m": adds to what is left, or starts from now when nothing is left. */
  function extendSnooze(until, now, minutes) {
    return Math.max(until || 0, now) + minutes * 60000;
  }

  function formatCompact(n) {
    n = Math.round(n);
    if (n < 1000) return String(n);
    if (n < 10000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
    return Math.round(n / 1000) + 'k';
  }

  /** Round the axis maximum up to a clean number and return ~4 ticks. */
  function niceScale(max) {
    if (!(max > 0)) return { max: 1, ticks: [0, 1] };
    const rough = max / 4;
    const mag = Math.pow(10, Math.floor(Math.log10(rough)));
    const norm = rough / mag;
    const step = (norm <= 1.5 ? 1 : norm <= 3 ? 2 : norm <= 7 ? 5 : 10) * mag;
    const top = Math.ceil(max / step) * step;
    const ticks = [];
    for (let v = 0; v <= top + step / 2; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
    return { max: top, ticks };
  }

  function pctChange(now, before) {
    if (!(before > 0)) return null;
    return Math.round(((now - before) / before) * 100);
  }

  /** Plain-language observations for the dashboard: [{ kind, text }], kind drives the icon and tone. */
  function buildInsights(stats, endKey, settings, installedOn) {
    const week = rangeDays(stats, endKey, 7);
    const prev = rangeDays(stats, addDays(endKey, -7), 7);
    const w = sumDays(week);
    const p = sumDays(prev);
    if (w.s === 0 && p.s === 0) {
      return [{ kind: 'empty', text: 'No reels tracked yet. Browse as usual and your numbers will appear here.' }];
    }
    const out = [];

    const monthSec = (w.s * 30) / 7;
    out.push({
      kind: 'summary',
      text: 'Last 7 days: ' + w.r + ' reels, ' + formatDuration(w.s) + '. At this pace that is about ' +
        (monthSec >= 3600 ? Math.round(monthSec / 3600) + ' hours' : Math.round(monthSec / 60) + ' minutes') +
        ' a month.',
    });

    // Only compare with the week before when that whole week was tracked.
    const prevComplete = !installedOn || prev[0].key >= installedOn;
    const change = prevComplete ? pctChange(w.s, p.s) : null;
    if (change !== null && Math.abs(change) >= 5) {
      out.push(
        change > 0
          ? { kind: 'up', text: 'Up ' + change + '% on the week before.' }
          : { kind: 'down', text: 'Down ' + Math.abs(change) + '% on the week before. Nice.' }
      );
    }

    const hours = new Array(24).fill(0);
    for (const d of rangeDays(stats, endKey, 30)) for (let h = 0; h < 24; h++) hours[h] += d.h[h] || 0;
    const peak = Math.max.apply(null, hours);
    if (peak > 0) {
      const h = hours.indexOf(peak);
      out.push({ kind: 'peak', text: 'You scroll most between ' + pad2(h) + ':00 and ' + pad2((h + 1) % 24) + ':00.' });
    }

    const streak = goalStreak(stats, endKey, settings, installedOn);
    if (streak >= 2) out.push({ kind: 'streak', text: streak + ' days in a row under your daily limit.' });

    return out;
  }

  /** One row per day, for export. */
  function toCsv(stats) {
    const head = ['date', 'reels', 'seconds'];
    for (const p of PLATFORM_ORDER) head.push(p + '_reels', p + '_seconds');
    const rows = [head.join(',')];
    for (const key of Object.keys(stats).sort()) {
      const d = getDay(stats, key);
      const row = [key, d.r, d.s];
      for (const p of PLATFORM_ORDER) row.push((d.p[p] && d.p[p].r) || 0, (d.p[p] && d.p[p].s) || 0);
      rows.push(row.join(','));
    }
    return rows.join('\n') + '\n';
  }

  return {
    PLATFORM_ORDER, PLATFORMS, DEFAULTS, CORNERS,
    SESSION_GAP_MS, LIMIT_REMIND_REELS, LIMIT_REMIND_SEC,
    classify, platformOfHost, isPlatform, normalizeSettings, ReelTracker,
    dayKey, parseDayKey, addDays, weekdayIndex,
    emptyDay, getDay, recordActivity, pruneStats, rangeDays, sumDays, weekdayHourHeat,
    evaluateLimits, goalMet, goalStreak,
    newSession, advanceSession, decideNudge,
    BLOCK_LEVELS, LEVELS, MAX_SCHEDULES, FOCUS_CHOICES_MIN, FOCUS_MAX_MS, BLOCK_MODES, levelRules,
    normalizeBlock, normalizeBlockState, emptyBlockState, withBlockState, parseHm, fmtHm, scheduleActive, scheduleEnd, nextMidnight,
    strikeInfo, blockReason, blockStatus, blockedPlatforms, blockActiveNow, lockoutActive, describeBlock, sentenceMatches,
    MAX_BREAK_MS, MAX_LOCK_MS, unlockCheck, applyUnlock, applyLoosen, applyEndBreak, applyFocus, weakens, changePolicy,
    formatDuration, formatClock, formatLeft, isRestOfDay, describeSnooze, extendSnooze, formatCompact, niceScale, pctChange, buildInsights, toCsv,
  };
});
