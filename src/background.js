/*
 * Reel Meter - background worker.
 *
 * Receives small "N seconds, M reels on <platform>" updates from the content
 * script, adds them to local daily totals, keeps the toolbar badge current and
 * decides when a nudge is due. Nothing here touches the network.
 */
'use strict';

if (typeof importScripts === 'function') importScripts('core.js'); // Chrome worker; Firefox lists core.js in the manifest

const C = self.ReelCore;
const store = chrome.storage.local;
const sessionStore = chrome.storage.session || chrome.storage.local;

// All writes go through one queue so two tabs can never overwrite each other's totals.
let chain = Promise.resolve();
function enqueue(fn) {
  const p = chain.then(fn);
  chain = p.catch(() => {});
  return p;
}

function clampInt(v, min, max) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : 0;
}

async function load() {
  const o = await store.get(['stats', 'settings', 'meta']);
  return { stats: o.stats || {}, settings: C.normalizeSettings(o.settings), meta: o.meta || {} };
}

async function loadSession() {
  const o = await sessionStore.get('session');
  return o.session || null;
}

function buildPayload(settings, day, session, nudge) {
  const lim = C.evaluateLimits(settings, day);
  return {
    today: { r: day.r, s: day.s },
    over: lim.over,
    streak: session ? session.streak : 0,
    nudge: nudge || null,
    limits: { reels: settings.dailyReelLimit, mins: settings.dailyMinuteLimit },
  };
}

async function updateBadge(settings, day) {
  try {
    if (!settings.showBadge || day.r === 0) {
      await chrome.action.setBadgeText({ text: '' });
      return;
    }
    const over = C.evaluateLimits(settings, day).over;
    await chrome.action.setBadgeText({ text: C.formatCompact(day.r) });
    await chrome.action.setBadgeBackgroundColor({ color: over ? '#d03b3b' : '#2a78d6' });
    if (chrome.action.setBadgeTextColor) await chrome.action.setBadgeTextColor({ color: '#ffffff' });
  } catch (e) {
    /* badge is cosmetic */
  }
}

async function refreshBadge() {
  const { stats, settings } = await load();
  await updateBadge(settings, C.getDay(stats, C.dayKey(new Date())));
}

function handleFlush(msg) {
  return enqueue(async () => {
    const platform = msg.platform;
    if (!C.isPlatform(platform)) return null;
    const seconds = clampInt(msg.seconds, 0, 600);
    const reels = clampInt(msg.reels, 0, 50);

    const now = Date.now();
    const date = new Date(now);
    const dk = C.dayKey(date);
    const { stats, settings, meta } = await load();
    let session = await loadSession();

    // Paused after this batch was already on its way: drop it.
    // (a hard daily limit counts regardless: otherwise pausing or switching the app off would be a way around it)
    if ((settings.snoozeUntil > now || !settings.platforms[platform]) && !settings.block.hardLimit) {
      return buildPayload(settings, C.getDay(stats, dk), session, null);
    }

    if (seconds > 0 || reels > 0) {
      C.recordActivity(stats, date, { platform, reels, seconds });
      C.pruneStats(stats, dk);
      if (!meta.installedOn) meta.installedOn = dk;
      await store.set({ stats, meta });
    }

    const day = C.getDay(stats, dk);
    session = C.advanceSession(session, now, reels, seconds);
    const decision = C.decideNudge(settings, day, dk, session);
    await sessionStore.set({ session: decision.session });
    await updateBadge(settings, day);
    return buildPayload(settings, day, decision.session, decision.nudge);
  });
}

// ------------------------------------------------------------------ blocking
//
// The running block state (focus timers, breaks, unblock counts, lockouts) is changed only here, one request at a
// time, and only after the rules are checked again on this side. A page can ask; it cannot decide.

const WAIT_SLACK_MS = 1500; // the page counts its own wait; allow a little timer drift
const START_MAX_AGE_MS = 10 * 60000; // a started wait is good for 10 minutes, so it cannot be paid for in advance

/** The started waits kept in session storage. Whatever an older version (or anything else) left there, only {key: time} pairs are used. */
async function readStarts() {
  const o = await sessionStore.get('unlockStarts');
  const starts = {};
  const raw = o.unlockStarts;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const k of Object.keys(raw)) if (Number.isFinite(raw[k])) starts[k] = raw[k];
  }
  return starts;
}

async function loadBlock() {
  const o = await store.get(['stats', 'settings', 'blockState']);
  const settings = C.normalizeSettings(o.settings);
  const day = C.getDay(o.stats || {}, C.dayKey(new Date()));
  return {
    settings,
    state: C.normalizeBlockState(o.blockState, Date.now()),
    limitOver: C.evaluateLimits(settings, day).over,
  };
}

/** Who is asking? A reel page may only change its own app. Extension pages (popup, dashboard) may name any app. */
function askerPlatform(sender) {
  if (!sender || sender.id !== chrome.runtime.id) return { ok: false };
  const url = sender.url || (sender.tab && sender.tab.url) || '';
  if (url.startsWith(chrome.runtime.getURL(''))) return { ok: true, page: true, platform: null };
  try {
    const platform = C.platformOfHost(new URL(url).hostname);
    return platform && sender.tab ? { ok: true, page: false, platform, tabId: sender.tab.id } : { ok: false };
  } catch (e) {
    return { ok: false };
  }
}

function blockReply(ok, extra) {
  return Object.assign({ ok }, extra || {});
}

/**
 * The dashboard asks to save settings that would make a block weaker. The worker decides with the same rules as the
 * dashboard (ReelCore.changePolicy), keeps its own wait clock, counts the loosening, and writes the settings itself.
 * msg.settings is the full proposed settings object; it is cleaned first.
 */
async function handleLoosen(msg, who, now, eff, limitOver) {
  if (!who.page) return blockReply(false, { why: 'sender' });
  // only what the user changed is applied, on top of the newest settings (a pause set meanwhile must survive)
  const proposed = C.normalizeSettings(msg.base && typeof msg.base === 'object' ? C.mergeChanges(C.normalizeSettings(msg.base), C.normalizeSettings(msg.settings), eff) : msg.settings);
  const policy = C.changePolicy(eff, proposed, now);
  if (policy === 'free') {
    if (msg.type === 'loosen') await store.set({ settings: proposed });
    return blockReply(true, { free: true });
  }
  if (policy !== 'challenge') return blockReply(false, { why: policy });
  const rules = C.levelRules(eff.block.level);
  const starts = await readStarts();
  if (msg.type === 'loosen-start') {
    starts.loosen = now;
    await sessionStore.set({ unlockStarts: starts });
    return blockReply(true, { waitSec: rules.waitSec, level: eff.block.level });
  }
  if (!starts.loosen || now - starts.loosen < rules.waitSec * 1000 - WAIT_SLACK_MS || now - starts.loosen > START_MAX_AGE_MS) return blockReply(false, { why: 'too-soon' });
  if (!C.sentenceMatches(msg.sentence, eff.block.level)) return blockReply(false, { why: 'sentence' });
  delete starts.loosen;
  await sessionStore.set({ unlockStarts: starts });
  const r = C.applyLoosen(eff, now);
  await store.set({ settings: proposed, blockState: r.state });
  return blockReply(true, { used: r.used, max: r.max, locked: r.locked, lockUntil: r.lockUntil });
}

function handleBlock(msg, sender) {
  return enqueue(async () => {
    const who = askerPlatform(sender);
    if (!who.ok) return blockReply(false, { why: 'sender' });
    const now = Date.now();
    const { settings, state, limitOver } = await loadBlock();
    const eff = C.withBlockState(settings, state, now);

    if (msg.type === 'loosen-start' || msg.type === 'loosen') return handleLoosen(msg, who, now, eff, limitOver);

    if (msg.type === 'focus') {
      const wanted = Array.isArray(msg.platforms) ? msg.platforms : [msg.platform];
      let platforms = [...new Set(wanted.filter((p) => C.isPlatform(p)))];
      if (!who.page) platforms = platforms.filter((p) => p === who.platform); // a reel page can only start a focus for its own app
      const minutes = Math.round(Number(msg.minutes));
      if (!platforms.length || !Number.isFinite(minutes) || minutes < 1 || minutes > 240) return blockReply(false, { why: 'bad-request' });
      const next = C.applyFocus(state, platforms, minutes, now);
      await store.set({ blockState: next });
      return blockReply(true, { state: next });
    }

    // the remaining messages are about one app
    const platform = who.page ? msg.platform : who.platform;
    if (!C.isPlatform(platform) || (!who.page && msg.platform !== who.platform)) return blockReply(false, { why: 'bad-request' });

    if (msg.type === 'end-break') {
      const next = C.applyEndBreak(state, platform);
      await store.set({ blockState: next });
      return blockReply(true, { state: next });
    }

    if (msg.type === 'unlock-start') {
      const check = C.unlockCheck(eff, platform, now, limitOver);
      if (!check.ok) return blockReply(false, { why: check.why });
      const starts = await readStarts();
      starts[who.tabId + ':' + platform] = now;
      // keep the list small: forget starts older than an hour
      for (const k of Object.keys(starts)) if (now - starts[k] > START_MAX_AGE_MS) delete starts[k];
      await sessionStore.set({ unlockStarts: starts });
      const rules = C.levelRules(settings.block.level);
      return blockReply(true, { waitSec: rules.waitSec, level: settings.block.level });
    }

    if (msg.type === 'unlock') {
      const check = C.unlockCheck(eff, platform, now, limitOver);
      if (!check.ok) return blockReply(false, { why: check.why });
      const rules = C.levelRules(settings.block.level);
      const starts = await readStarts();
      const key = who.tabId + ':' + platform;
      if (!starts[key] || now - starts[key] < rules.waitSec * 1000 - WAIT_SLACK_MS || now - starts[key] > START_MAX_AGE_MS) return blockReply(false, { why: 'too-soon' });
      if (!C.sentenceMatches(msg.sentence, settings.block.level)) return blockReply(false, { why: 'sentence' });
      delete starts[key];
      await sessionStore.set({ unlockStarts: starts });
      const r = C.applyUnlock(eff, platform, now);
      await store.set({ blockState: r.state });
      return blockReply(true, { state: r.state, breakUntil: r.breakUntil, used: r.used, max: r.max, locked: r.locked, lockUntil: r.lockUntil });
    }

    return blockReply(false, { why: 'bad-request' });
  });
}

function handlePeek() {
  return enqueue(async () => {
    const { stats, settings } = await load();
    const session = await loadSession();
    return buildPayload(settings, C.getDay(stats, C.dayKey(new Date())), session, null);
  });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !msg || typeof msg !== 'object') {
    console.log('Reel Meter worker: message ignored (sender ' + (sender && sender.id) + ', this extension ' + chrome.runtime.id + ')');
    return false;
  }
  if (msg.type === 'flush') {
    handleFlush(msg).then(sendResponse, () => sendResponse(null));
    return true;
  }
  if (msg.type === 'open-dashboard') {
    chrome.runtime.openOptionsPage();
    return false;
  }
  if (msg.type === 'peek') {
    handlePeek().then(sendResponse, () => sendResponse(null));
    return true;
  }
  if (['unlock-start', 'unlock', 'end-break', 'focus', 'loosen-start', 'loosen'].includes(msg.type)) {
    console.log('Reel Meter worker: ' + msg.type + ' from ' + (sender.url || (sender.tab && sender.tab.url) || '?'));
    handleBlock(msg, sender).then((r) => { console.log('Reel Meter worker: ' + msg.type + ' answered ' + JSON.stringify(r).slice(0, 120)); sendResponse(r); }, (e) => { console.error('Reel Meter worker error', e && e.stack); sendResponse({ ok: false, why: 'error', detail: String((e && e.message) || e).slice(0, 100) }); });
    return true;
  }
  console.log('Reel Meter worker: unknown message type ' + msg.type);
  return false;
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.settings || changes.stats)) refreshBadge();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'refresh') refreshBadge(); // moves the badge over at midnight
});

chrome.runtime.onInstalled.addListener((details) => {
  chrome.alarms.create('refresh', { periodInMinutes: 15 });
  if (details.reason === 'install') {
    store.get('meta').then((o) => {
      const meta = o.meta || {};
      if (!meta.installedOn) meta.installedOn = C.dayKey(new Date());
      store.set({ meta });
    });
    chrome.tabs.create({ url: chrome.runtime.getURL('src/ui/dashboard.html#welcome') });
  }
});

chrome.alarms.get('refresh').then((a) => {
  if (!a) chrome.alarms.create('refresh', { periodInMinutes: 15 });
});

// Version 1.0.0 saved the spot where the counter was dragged. That is no longer used (the counter always
// starts at its chosen place), so remove the old value; normalizeSettings leaves it out.
async function dropLegacySettings() {
  const o = await store.get('settings');
  if (o.settings && typeof o.settings === 'object' && 'counterPos' in o.settings) {
    await store.set({ settings: C.normalizeSettings(o.settings) });
  }
}

refreshBadge();
dropLegacySettings().catch(() => {});
