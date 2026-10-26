'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../src/core.js');

// 2026-10-26 is a Monday
const at = (day, h, m) => new Date(2026, 9, 26 + day, h, m || 0, 0, 0); // day 0 = Monday, 1 = Tuesday ...
const MIN = 60000;
const NOW = at(0, 12).getTime();
const HOUR = 3600000;
/** settings with the running state merged in, the shape the decision functions take */
const eff = (block, state, extra, at = NOW) => C.withBlockState(C.normalizeSettings(Object.assign({ block }, extra)), state || {}, at); // `at` is the moment the state is read (end times are cut back relative to it)
const yt = { platform: 'youtube', id: 'abc123', feed: false };
const fb = { platform: 'facebook', id: '123456', feed: false };
const tiktokFeed = { platform: 'tiktok', id: null, feed: true };

// ------------------------------------------------------------------ levels

test('three restriction levels with the agreed rules', () => {
  assert.deepEqual(C.BLOCK_LEVELS, ['gentle', 'balanced', 'strict']);
  const g = C.levelRules('gentle');
  const b = C.levelRules('balanced');
  const s = C.levelRules('strict');
  assert.deepEqual([g.label, b.label, s.label], ['Less restriction', 'Restricted', 'Full restriction']);
  assert.deepEqual([g.waitSec, b.waitSec, s.waitSec], [10, 30, 60]);
  assert.deepEqual([g.breakMin, b.breakMin, s.breakMin], [5, 5, 5]); // a break is 5 minutes at every level
  assert.deepEqual([b.strikes, b.strikeWindowMin, b.lockHours], [3, 180, 6]); // three unblocks, then 6 hours
  assert.ok(s.strikes < b.strikes && b.strikes < g.strikes);
  assert.ok(g.waitSec < b.waitSec && b.waitSec < s.waitSec);
  assert.equal(s.timedUnlock, false);
  assert.equal(b.timedUnlock, true);
  assert.equal(s.settingsChange, 'never');
  assert.equal(C.levelRules('nonsense'), C.levelRules('balanced'));
});

// ------------------------------------------------------------- normalizing

test('normalizeBlock: defaults, clamping, schedule clean-up and no running state', () => {
  const d = C.normalizeBlock();
  assert.equal(d.level, 'balanced');
  assert.deepEqual(d.apps, { youtube: 'count', instagram: 'count', tiktok: 'count', facebook: 'count' });
  assert.equal(d.hardLimit, false);
  assert.deepEqual(d.schedules, []);

  const b = C.normalizeBlock({
    level: 'banana',
    apps: { youtube: 'block', tiktok: 'banana', bogus: 'block' },
    hardLimit: 'yes',
    focusUntil: NOW + HOUR, unlockedUntil: NOW + HOUR, // old 1.1.x fields are dropped: state lives elsewhere
    schedules: [{ id: 'a', days: [1, 1, 9, 'x', 3], start: '25:00', end: '7:00' }, { id: 'a', days: [0] }, 'junk', {}, {}, {}, {}, {}],
  });
  assert.equal(b.level, 'balanced');
  assert.equal(b.apps.youtube, 'block');
  assert.equal(b.apps.tiktok, 'count');
  assert.equal('bogus' in b.apps, false);
  assert.equal(b.hardLimit, false);
  assert.equal('focusUntil' in b || 'unlockedUntil' in b, false);
  assert.deepEqual(b.schedules[0], { id: 'a', on: true, days: [1, 3], start: '22:00', end: '07:00' });
  assert.ok(b.schedules.length <= C.MAX_SCHEDULES);
  assert.equal(new Set(b.schedules.map((s) => s.id)).size, b.schedules.length);
  assert.equal(C.normalizeBlock({ level: 'strict' }).level, 'strict');
});

test('normalizeBlockState: four apps, bounded numbers, sorted and capped unlock lists', () => {
  const e = C.emptyBlockState();
  assert.deepEqual(Object.keys(e.focus), C.PLATFORM_ORDER);
  const st = C.normalizeBlockState({
    focus: { youtube: 'x', tiktok: NOW }, breaks: { facebook: -5 }, lockUntil: { instagram: 1e30 },
    unlocks: { youtube: [30, 10, 'a', 20, null, ...Array.from({ length: 40 }, (_, i) => 1000 + i)] },
  });
  assert.equal(st.focus.youtube, 0);
  assert.equal(st.focus.tiktok, NOW);
  assert.equal(st.breaks.facebook, 0);
  assert.ok(st.lockUntil.instagram <= 8.64e15);
  assert.equal(st.unlocks.youtube.length, 20);
  assert.deepEqual(st.unlocks.youtube, [...st.unlocks.youtube].sort((a, b) => a - b));
  assert.deepEqual(st.unlocks.facebook, []);
  assert.deepEqual(C.normalizeBlockState(null), e);
});

test('settings carry the block section; the block state is a separate thing', () => {
  const s = C.normalizeSettings({ block: { apps: { instagram: 'block' } } });
  assert.equal(s.block.apps.instagram, 'block');
  assert.equal(s.block.focus, undefined);
  const e = C.withBlockState(s, { focus: { youtube: NOW + 1 } });
  assert.equal(e.block.focus.youtube, NOW + 1);
  assert.equal(e.block.apps.instagram, 'block');
  assert.equal(s.block.focus, undefined); // the original is untouched
});

// --------------------------------------------------------------- schedules

test('scheduleActive: daytime window', () => {
  const s = C.normalizeBlock({ schedules: [{ id: 'w', days: [0, 1, 2, 3, 4], start: '09:00', end: '17:00' }] }).schedules[0];
  assert.equal(C.scheduleActive(s, at(0, 10)), true);
  assert.equal(C.scheduleActive(s, at(0, 9, 0)), true);
  assert.equal(C.scheduleActive(s, at(0, 17, 0)), false);
  assert.equal(C.scheduleActive(s, at(0, 8, 59)), false);
  assert.equal(C.scheduleActive(s, at(5, 10)), false);
  assert.equal(C.scheduleActive(Object.assign({}, s, { on: false }), at(0, 10)), false);
});

test('scheduleActive: overnight window belongs to the day it starts on', () => {
  const daily = C.normalizeBlock({ schedules: [{ id: 'n', start: '22:00', end: '07:00' }] }).schedules[0];
  assert.equal(C.scheduleActive(daily, at(0, 23)), true);
  assert.equal(C.scheduleActive(daily, at(1, 6, 59)), true);
  assert.equal(C.scheduleActive(daily, at(1, 7, 0)), false);
  const monOnly = C.normalizeBlock({ schedules: [{ id: 'm', days: [0], start: '22:00', end: '07:00' }] }).schedules[0];
  assert.equal(C.scheduleActive(monOnly, at(0, 23)), true);
  assert.equal(C.scheduleActive(monOnly, at(1, 3)), true);
  assert.equal(C.scheduleActive(monOnly, at(1, 23)), false);
  assert.equal(C.scheduleActive(monOnly, at(0, 3)), false);
  assert.equal(C.scheduleActive({ on: true, days: [0], start: '10:00', end: '10:00' }, at(0, 10)), false);
  assert.equal(C.scheduleActive(null, at(0, 10)), false);
});

test('scheduleEnd for daytime and overnight windows', () => {
  assert.equal(C.scheduleEnd({ on: true, days: [0], start: '09:00', end: '17:00' }, at(0, 10)), at(0, 17).getTime());
  const night = { on: true, days: [0, 1], start: '22:00', end: '07:00' };
  assert.equal(C.scheduleEnd(night, at(0, 23)), at(1, 7).getTime());
  assert.equal(C.scheduleEnd(night, at(1, 3)), at(1, 7).getTime());
});

// ------------------------------------------------------------ block status

test('only reel pages are ever blocked, and only the app that is set to block', () => {
  const e = eff({ apps: { youtube: 'block' } });
  assert.equal(C.blockStatus(e, { now: NOW, cls: null }).action, 'allow');
  const r = C.blockStatus(e, { now: NOW, cls: yt });
  assert.equal(r.action, 'block');
  assert.equal(r.reason, 'app');
  assert.equal(r.until, null);
  assert.equal(C.blockStatus(e, { now: NOW, cls: tiktokFeed }).action, 'allow');
  assert.equal(C.blockStatus(e, { now: NOW, cls: fb }).action, 'allow');
});

test('a focus timer blocks only the apps it was started for', () => {
  const e = eff({}, { focus: { youtube: NOW + 30 * MIN } });
  assert.equal(C.blockStatus(e, { now: NOW, cls: yt }).reason, 'focus');
  assert.equal(C.blockStatus(e, { now: NOW, cls: fb }).action, 'allow');
  assert.equal(C.blockStatus(e, { now: NOW + 31 * MIN, cls: yt }).action, 'allow');
});

test('reason priority is lockout, focus, schedule, hard limit, app', () => {
  const now = at(0, 23).getTime(); // Monday 23:00
  const cfg = { apps: { youtube: 'block' }, hardLimit: true, schedules: [{ id: 'n', start: '22:00', end: '07:00' }] };
  const st = (state) => C.blockStatus(eff(cfg, state), { now, cls: yt, limitOver: true });
  assert.equal(st({ lockUntil: { youtube: now + HOUR }, focus: { youtube: now + HOUR } }).reason, 'lockout');
  assert.equal(st({ focus: { youtube: now + HOUR } }).reason, 'focus');
  const sch = st({});
  assert.equal(sch.reason, 'schedule');
  assert.equal(sch.until, at(1, 7).getTime());
  const noSch = C.blockStatus(eff({ apps: { youtube: 'block' }, hardLimit: true }), { now, cls: yt, limitOver: true });
  assert.equal(noSch.reason, 'limit');
  assert.equal(noSch.until, at(1, 0).getTime());
  assert.equal(C.blockStatus(eff({ apps: { youtube: 'block' }, hardLimit: true }), { now, cls: yt, limitOver: false }).reason, 'app');
});

test('hard limit only blocks when it is switched on and the limit is reached', () => {
  assert.equal(C.blockStatus(eff({ hardLimit: false }), { now: NOW, cls: yt, limitOver: true }).action, 'allow');
  assert.equal(C.blockStatus(eff({ hardLimit: true }), { now: NOW, cls: yt, limitOver: false }).action, 'allow');
  assert.equal(C.blockStatus(eff({ hardLimit: true }), { now: NOW, cls: yt, limitOver: true }).action, 'block');
});

test('a break is per app: it opens one app and leaves the others blocked', () => {
  const e = eff({ apps: { youtube: 'block', facebook: 'block' } }, { breaks: { facebook: NOW + 3 * MIN } });
  const f = C.blockStatus(e, { now: NOW, cls: fb });
  assert.equal(f.action, 'allow');
  assert.equal(f.onBreak, true);
  assert.equal(f.until, NOW + 3 * MIN);
  assert.equal(C.blockStatus(e, { now: NOW, cls: yt }).action, 'block'); // YouTube is still blocked
  assert.equal(C.blockStatus(e, { now: NOW + 4 * MIN, cls: fb }).action, 'block'); // the break is over
});

test('a lockout that starts after the break only bites once the break is over', () => {
  const e = eff({ apps: { youtube: 'block' } }, { breaks: { youtube: NOW + 5 * MIN }, lockUntil: { youtube: NOW + 5 * MIN + 6 * HOUR } });
  assert.equal(C.blockStatus(e, { now: NOW, cls: yt }).action, 'allow');
  const after = C.blockStatus(e, { now: NOW + 6 * MIN, cls: yt });
  assert.equal(after.action, 'block');
  assert.equal(after.reason, 'lockout');
  assert.equal(after.canUnlock, false);
  assert.equal(after.until, NOW + 5 * MIN + 6 * HOUR);
  assert.equal(C.blockStatus(e, { now: NOW + 7 * HOUR, cls: yt }).action, 'block'); // the app block itself is still on
});

test('canUnlock: Full restriction cannot unblock timed blocks, nothing unblocks a lockout', () => {
  const timed = { focus: { youtube: NOW + HOUR } };
  assert.equal(C.blockStatus(eff({ level: 'balanced' }, timed), { now: NOW, cls: yt }).canUnlock, true);
  assert.equal(C.blockStatus(eff({ level: 'gentle' }, timed), { now: NOW, cls: yt }).canUnlock, true);
  assert.equal(C.blockStatus(eff({ level: 'strict' }, timed), { now: NOW, cls: yt }).canUnlock, false);
  assert.equal(C.blockStatus(eff({ level: 'strict', apps: { youtube: 'block' } }), { now: NOW, cls: yt }).canUnlock, true); // an app block can be unblocked
  assert.equal(C.blockStatus(eff({}, { lockUntil: { youtube: NOW + HOUR } }), { now: NOW, cls: yt }).canUnlock, false);
});

test('Shorts as normal videos: YouTube only, only with an id, never when blocked', () => {
  const e = eff({ shortsAsVideos: true });
  const r = C.blockStatus(e, { now: NOW, cls: yt });
  assert.equal(r.action, 'redirect');
  assert.equal(r.url, '/watch?v=abc123');
  assert.equal(C.blockStatus(e, { now: NOW, cls: { platform: 'youtube', id: null, feed: true } }).action, 'allow');
  assert.equal(C.blockStatus(e, { now: NOW, cls: { platform: 'instagram', id: 'x1y2z3', feed: false } }).action, 'allow');
  assert.equal(C.blockStatus(eff({ shortsAsVideos: true, apps: { youtube: 'block' } }), { now: NOW, cls: yt }).action, 'block');
  assert.equal(C.blockStatus(e, { now: NOW, cls: { platform: 'youtube', id: 'a b&c', feed: false } }).url, '/watch?v=a%20b%26c');
});

test('blockedPlatforms and blockActiveNow follow breaks per app', () => {
  const cfg = { apps: { youtube: 'block', facebook: 'block' } };
  assert.deepEqual(C.blockedPlatforms(eff(cfg), NOW, false), ['youtube', 'facebook']);
  assert.deepEqual(C.blockedPlatforms(eff(cfg, { breaks: { youtube: NOW + MIN } }), NOW, false), ['facebook']);
  assert.equal(C.blockActiveNow(eff(cfg, { breaks: { youtube: NOW + MIN, facebook: NOW + MIN } }), NOW, false), false);
  assert.equal(C.blockActiveNow(eff({}), NOW, true), false);
  assert.equal(C.blockActiveNow(eff({ hardLimit: true }), NOW, true), true);
  assert.equal(C.blockActiveNow(eff({}, { focus: { tiktok: NOW + MIN } }), NOW, false), true);
});

// -------------------------------------------------------------- unblocking

test('unblocking opens a 5 minute break for ONE app and counts it', () => {
  const e = eff({ apps: { youtube: 'block', facebook: 'block' } });
  const r = C.applyUnlock(e, 'facebook', NOW);
  assert.equal(r.breakUntil, NOW + 5 * MIN);
  assert.equal(r.state.breaks.facebook, NOW + 5 * MIN);
  assert.equal(r.state.breaks.youtube, 0); // YouTube stays blocked
  assert.deepEqual(r.state.unlocks.facebook, [NOW]);
  assert.deepEqual(r.state.unlocks.youtube, []);
  assert.equal(r.used, 1);
  assert.equal(r.locked, false);
  const after = C.withBlockState(C.normalizeSettings({ block: e.block }), r.state);
  assert.equal(C.blockStatus(after, { now: NOW + MIN, cls: fb }).action, 'allow');
  assert.equal(C.blockStatus(after, { now: NOW + MIN, cls: yt }).action, 'block');
});

test('three unblocks within three hours start a 6 hour lockout (Restricted)', () => {
  let state = {};
  const cfg = { apps: { youtube: 'block' } };
  let r = C.applyUnlock(eff(cfg, state), 'youtube', NOW);
  assert.equal(r.locked, false);
  assert.equal(r.used, 1);
  r = C.applyUnlock(eff(cfg, r.state), 'youtube', NOW + 20 * MIN);
  assert.equal(r.locked, false);
  assert.equal(r.used, 2);
  r = C.applyUnlock(eff(cfg, r.state), 'youtube', NOW + 40 * MIN);
  assert.equal(r.locked, true);
  assert.equal(r.max, 3);
  const breakEnd = NOW + 45 * MIN;
  assert.equal(r.breakUntil, breakEnd);
  assert.equal(r.lockUntil, breakEnd + 6 * HOUR); // the lock starts when the third break ends
  assert.deepEqual(r.state.unlocks.youtube, []); // the strikes are used up
  assert.equal(C.blockStatus(eff(cfg, r.state, undefined, NOW + 41 * MIN), { now: NOW + 41 * MIN, cls: yt }).action, 'allow'); // still on the third break
  const e = eff(cfg, r.state, undefined, breakEnd + MIN);
  const locked = C.blockStatus(e, { now: breakEnd + MIN, cls: yt });
  assert.equal(locked.reason, 'lockout');
  assert.equal(locked.canUnlock, false);
  assert.equal(C.unlockCheck(e, 'youtube', breakEnd + MIN).why, 'lockout');
  const after = eff(cfg, r.state, undefined, breakEnd + 6 * HOUR + MIN);
  assert.equal(C.blockStatus(after, { now: breakEnd + 6 * HOUR + MIN, cls: yt }).reason, 'app'); // lock over, plain app block again
  assert.equal(C.applyUnlock(after, 'youtube', breakEnd + 6 * HOUR + MIN).used, 1); // clean slate
});

test('unblocks older than the window do not count, other apps are counted separately', () => {
  const cfg = { apps: { youtube: 'block', facebook: 'block' } };
  const old = { unlocks: { youtube: [NOW - 5 * HOUR, NOW - 4 * HOUR] } };
  const r = C.applyUnlock(eff(cfg, old), 'youtube', NOW);
  assert.equal(r.used, 1);
  assert.equal(r.locked, false);
  const mixed = { unlocks: { youtube: [NOW - 10 * MIN, NOW - 5 * MIN] } };
  assert.equal(C.applyUnlock(eff(cfg, mixed), 'facebook', NOW).used, 1); // Facebook has its own count
  assert.equal(C.applyUnlock(eff(cfg, mixed), 'youtube', NOW).locked, true);
});

test('levels change the count and the lock time', () => {
  const run = (level, n) => {
    let state = {};
    let r;
    for (let i = 0; i < n; i++) r = C.applyUnlock(eff({ level, apps: { youtube: 'block' } }, state), 'youtube', NOW + i * 6 * MIN), state = r.state;
    return r;
  };
  assert.equal(run('gentle', 4).locked, false);
  const g = run('gentle', 5);
  assert.equal(g.locked, true);
  assert.equal(g.lockUntil - g.breakUntil, 1 * HOUR);
  assert.equal(run('strict', 1).locked, false);
  const s = run('strict', 2);
  assert.equal(s.locked, true);
  assert.equal(s.lockUntil - s.breakUntil, 12 * HOUR);
});

test('unlockCheck refuses what must be refused', () => {
  assert.equal(C.unlockCheck(eff({}), 'youtube', NOW).why, 'not-blocked');
  assert.equal(C.unlockCheck(eff({ apps: { youtube: 'block' } }), 'youtube', NOW).ok, true);
  assert.equal(C.unlockCheck(eff({ level: 'strict' }, { focus: { youtube: NOW + HOUR } }), 'youtube', NOW).why, 'strict');
  assert.equal(C.unlockCheck(eff({ level: 'strict', apps: { youtube: 'block' } }), 'youtube', NOW).ok, true);
  assert.equal(C.unlockCheck(eff({ apps: { youtube: 'block' } }, { breaks: { youtube: NOW + MIN } }), 'youtube', NOW).why, 'not-blocked');
});

test('"Block now" ends a break at once; a focus timer is per app, capped and ends the break', () => {
  const s = C.applyEndBreak({ breaks: { youtube: NOW + 3 * MIN, facebook: NOW + 3 * MIN } }, 'youtube');
  assert.equal(s.breaks.youtube, 0);
  assert.equal(s.breaks.facebook, NOW + 3 * MIN);

  const f = C.applyFocus({ breaks: { youtube: NOW + 3 * MIN } }, ['youtube'], 30, NOW);
  assert.equal(f.focus.youtube, NOW + 30 * MIN);
  assert.equal(f.focus.facebook, 0);
  assert.equal(f.breaks.youtube, 0);
  const more = C.applyFocus(f, ['youtube', 'tiktok'], 60, NOW);
  assert.equal(more.focus.youtube, NOW + 90 * MIN);
  assert.equal(more.focus.tiktok, NOW + 60 * MIN);
  let long = f;
  for (let i = 0; i < 10; i++) long = C.applyFocus(long, ['youtube'], 240, NOW);
  assert.equal(long.focus.youtube, NOW + C.FOCUS_MAX_MS); // never stacked past 12 hours
  assert.deepEqual(C.applyFocus({}, ['bogus'], 30, NOW).focus, C.emptyBlockState().focus);
});

test('the unlock sentence depends on the level and forgives case and punctuation', () => {
  assert.equal(C.sentenceMatches('I choose to keep scrolling', 'balanced'), true);
  assert.equal(C.sentenceMatches('  i CHOOSE   to keep scrolling. ', 'gentle'), true);
  assert.equal(C.sentenceMatches('I choose to keep', 'balanced'), false);
  assert.equal(C.sentenceMatches('I choose to keep scrolling', 'strict'), false); // Full restriction asks for the longer sentence
  assert.equal(C.sentenceMatches('I know this is against my plan, and I choose to scroll anyway!', 'strict'), true);
  assert.equal(C.sentenceMatches('', 'balanced'), false);
  assert.equal(C.sentenceMatches(null, 'balanced'), false);
});

// ------------------------------------------------------ changing settings

test('weakens: lowering the level or turning a block off weakens, strengthening does not', () => {
  const base = C.normalizeSettings({ block: { level: 'balanced', apps: { youtube: 'block' }, hardLimit: true, shortsAsVideos: true }, dailyReelLimit: 50 });
  const next = (patch, top) => C.normalizeSettings(Object.assign({}, base, top || {}, { block: Object.assign({}, base.block, patch) }));
  assert.equal(C.weakens(base, next({})), false);
  assert.equal(C.weakens(base, next({ level: 'gentle' })), true);
  assert.equal(C.weakens(base, next({ level: 'strict' })), false);
  assert.equal(C.weakens(base, next({ apps: { youtube: 'count' } })), true);
  assert.equal(C.weakens(base, next({ apps: { youtube: 'block', tiktok: 'block' } })), false);
  assert.equal(C.weakens(base, next({ hardLimit: false })), true);
  assert.equal(C.weakens(base, next({ shortsAsVideos: false })), true);
  assert.equal(C.weakens(base, next({}, { dailyReelLimit: 200 })), true);
  assert.equal(C.weakens(base, next({}, { dailyReelLimit: 0 })), true);
  assert.equal(C.weakens(base, next({}, { dailyReelLimit: 20 })), false);
});

test('weakens: schedules', () => {
  const sch = C.normalizeSettings({ block: { schedules: [{ id: 'n', days: [0, 1, 2, 3, 4], start: '22:00', end: '07:00' }] } });
  const withSch = (list) => C.normalizeSettings({ block: Object.assign({}, sch.block, { schedules: list }) });
  const s0 = sch.block.schedules[0];
  assert.equal(C.weakens(sch, withSch([s0])), false);
  assert.equal(C.weakens(sch, withSch([])), true);
  assert.equal(C.weakens(sch, withSch([Object.assign({}, s0, { on: false })])), true);
  assert.equal(C.weakens(sch, withSch([Object.assign({}, s0, { end: '06:00' })])), true);
  assert.equal(C.weakens(sch, withSch([Object.assign({}, s0, { days: [0, 1, 2] })])), true);
  assert.equal(C.weakens(sch, withSch([Object.assign({}, s0, { end: '08:00' })])), false);
  assert.equal(C.weakens(sch, withSch([s0, { id: 'x', start: '12:00', end: '13:00' }])), false);
});

test('changePolicy: free, challenge, lockout and Full restriction (never "only while a block is running")', () => {
  const cfg = { apps: { youtube: 'block' } };
  const off = (level) => C.normalizeSettings({ block: { level, apps: { youtube: 'count' } } });
  const on = (level, state) => eff(Object.assign({ level }, cfg), state);
  // strengthening is always free
  assert.equal(C.changePolicy(on('balanced'), C.normalizeSettings({ block: { apps: { youtube: 'block', tiktok: 'block' } } }), NOW), 'free');
  // loosening needs the challenge (Restricted and Less restriction), whether or not it is blocking this second
  assert.equal(C.changePolicy(on('balanced'), off('balanced'), NOW), 'challenge');
  assert.equal(C.changePolicy(on('gentle'), off('gentle'), NOW), 'challenge');
  // Full restriction: not at all
  assert.equal(C.changePolicy(on('strict'), off('strict'), NOW), 'denied-strict');
  // a break is not a way to loosen things (this was a hole)
  assert.equal(C.changePolicy(on('strict', { breaks: { youtube: NOW + MIN } }), off('strict'), NOW), 'denied-strict');
  assert.equal(C.changePolicy(on('balanced', { breaks: { youtube: NOW + MIN } }), off('balanced'), NOW), 'challenge');
  // a schedule is protected at 21:59 as much as at 22:00 (this was a hole)
  const sched = eff({ level: 'strict', schedules: [{ id: 'n', start: '22:00', end: '07:00' }] });
  const noSched = C.normalizeSettings({ block: { level: 'strict', schedules: [] } });
  assert.equal(C.changePolicy(sched, noSched, at(0, 21, 59).getTime()), 'denied-strict');
  assert.equal(C.changePolicy(sched, noSched, at(0, 12).getTime()), 'denied-strict');
  // during a lockout nothing loosens, not even with the challenge
  assert.equal(C.changePolicy(on('balanced', { lockUntil: { youtube: NOW + HOUR } }), off('balanced'), NOW), 'denied-lock');
  // too many recent loosenings: no more for a while
  assert.equal(C.changePolicy(on('balanced', { loosenLock: NOW + HOUR }), off('balanced'), NOW), 'denied-lock');
  // nothing configured and nothing running: choosing a lower level protects nothing, so it is free
  assert.equal(C.changePolicy(eff({ level: 'strict' }), C.normalizeSettings({ block: { level: 'gentle' } }), NOW), 'free');
  // ...but not while a focus timer runs (a lower level would make it unblockable)
  assert.equal(C.changePolicy(eff({ level: 'strict' }, { focus: { youtube: NOW + HOUR } }), C.normalizeSettings({ block: { level: 'gentle' } }), NOW), 'denied-strict');
});

test('schedules are compared minute by minute: trimming a few minutes is a loosening', () => {
  const sch = C.normalizeSettings({ block: { schedules: [{ id: 'n', days: [0, 1, 2, 3, 4, 5, 6], start: '22:00', end: '07:00' }] } });
  const withEnd = (end) => C.normalizeSettings({ block: { schedules: [Object.assign({}, sch.block.schedules[0], { end })] } });
  assert.equal(C.weakens(sch, withEnd('06:46'), NOW), true);
  assert.equal(C.weakens(sch, withEnd('07:00'), NOW), false);
  const tiny = C.normalizeSettings({ block: { schedules: [{ id: 't', start: '12:00', end: '12:10' }] } });
  assert.equal(C.weakens(tiny, C.normalizeSettings({ block: { schedules: [] } }), NOW), true); // shorter than a quarter hour still counts
});

test('while a hard daily limit is on, making reels count less is a loosening', () => {
  const base = C.normalizeSettings({ block: { hardLimit: true }, dailyReelLimit: 50 });
  const change = (patch) => C.normalizeSettings(Object.assign({}, base, patch));
  assert.equal(C.weakens(base, change({ platforms: { youtube: false, instagram: true, tiktok: true, facebook: true } }), NOW), true);
  assert.equal(C.weakens(base, change({ minDwellSec: 10 }), NOW), true);
  assert.equal(C.weakens(base, change({ idleCutoffSec: 30 }), NOW), true);
  assert.equal(C.weakens(base, change({ minDwellSec: 1, idleCutoffSec: 300 }), NOW), false);
  const noHard = C.normalizeSettings({ dailyReelLimit: 50 });
  assert.equal(C.weakens(noHard, C.normalizeSettings({ dailyReelLimit: 50, minDwellSec: 10 }), NOW), false); // without a hard limit these are the user's own business
});

test('a wrong or moved clock cannot make a break or a lock run for years', () => {
  const far = NOW + 99 * 365 * 24 * HOUR;
  const raw = { breaks: { youtube: far }, lockUntil: { youtube: far }, focus: { youtube: far }, loosenLock: far, unlocks: { youtube: [far, NOW - HOUR] } };
  const st = C.normalizeBlockState(raw, NOW);
  assert.equal(st.breaks.youtube, NOW + C.MAX_BREAK_MS); // 5 minutes, not 99 years
  assert.equal(st.lockUntil.youtube, NOW + C.MAX_LOCK_MS);
  assert.equal(st.focus.youtube, NOW + C.FOCUS_MAX_MS);
  assert.equal(st.loosenLock, NOW + C.MAX_LOCK_MS);
  assert.deepEqual(st.unlocks.youtube, [NOW - HOUR, NOW]); // a time from the "future" counts as now
  assert.equal(C.blockStatus(C.withBlockState(C.normalizeSettings({ block: { apps: { youtube: 'block' } } }), raw, NOW), { now: NOW + 6 * MIN, cls: yt }).action, 'block');
  assert.equal(C.normalizeBlockState(raw).breaks.youtube, far); // without `now` nothing is cut (pure normalising)
});

test('older unblock times are kept when saving, so a clock moved forward cannot wipe the history', () => {
  const cfg = { apps: { youtube: 'block' } };
  const first = C.applyUnlock(eff(cfg), 'youtube', NOW);
  const later = C.applyUnlock(eff(cfg, first.state), 'youtube', NOW + 5 * HOUR); // the clock jumped 5 hours: the first one is outside the window
  assert.equal(later.used, 1); // counting uses the window
  assert.deepEqual(later.state.unlocks.youtube, [NOW, NOW + 5 * HOUR]); // but the history is still there
});

test('loosening through the dashboard is counted, and too much of it is stopped', () => {
  const e = eff({ apps: { youtube: 'block' } });
  const one = C.applyLoosen(e, NOW);
  assert.equal(one.used, 1);
  assert.equal(one.locked, false);
  let state = one.state;
  let r;
  for (let i = 1; i < 3; i++) { r = C.applyLoosen(eff({ apps: { youtube: 'block' } }, state), NOW + i * 10 * MIN); state = r.state; }
  assert.equal(r.locked, true); // the third in three hours
  assert.equal(r.lockUntil, NOW + 20 * MIN + 6 * HOUR);
  assert.equal(C.changePolicy(eff({ apps: { youtube: 'block' } }, state), C.normalizeSettings({}), NOW + 30 * MIN), 'denied-lock');
});

test('focus ignores nonsense minutes and unknown apps; platform checks reject prototype names', () => {
  assert.deepEqual(C.applyFocus({}, ['youtube'], NaN, NOW).focus, C.emptyBlockState().focus);
  assert.deepEqual(C.applyFocus({}, ['youtube'], -5, NOW).focus, C.emptyBlockState().focus);
  assert.deepEqual(C.applyFocus({}, ['__proto__', 'constructor'], 30, NOW).focus, C.emptyBlockState().focus);
  assert.equal(C.isPlatform('youtube'), true);
  for (const bad of ['__proto__', 'constructor', 'toString', '', null, 3, ['youtube']]) assert.equal(C.isPlatform(bad), false);
  assert.equal(C.platformOfHost('__proto__'), null);
});

test('describeBlock gives plain words and time left', () => {
  const now = at(0, 23).getTime();
  const focus = C.describeBlock({ reason: 'focus', until: now + 42 * MIN }, now, 'TikTok');
  assert.equal(focus.title, 'Focus time');
  assert.equal(focus.left, '42m left');
  assert.match(focus.text, /TikTok/);
  assert.match(C.describeBlock({ reason: 'schedule', until: at(1, 7).getTime() }, now).text, /until 07:00/);
  assert.match(C.describeBlock({ reason: 'limit', until: at(1, 0).getTime() }, now).text, /until midnight/);
  assert.match(C.describeBlock({ reason: 'app', until: null }, now, 'TikTok').text, /TikTok is set to block reels/);
  const lock = C.describeBlock({ reason: 'lockout', until: now + 6 * HOUR }, now, 'YouTube Shorts');
  assert.equal(lock.title, 'Locked for a while');
  assert.match(lock.text, /YouTube Shorts/);
  assert.equal(lock.left, '6h left');
});
