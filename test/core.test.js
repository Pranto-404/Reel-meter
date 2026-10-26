'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../src/core.js');

// ------------------------------------------------------------- classify

test('classify: YouTube Shorts has an id, regular videos are ignored', () => {
  assert.deepEqual(C.classify('www.youtube.com', '/shorts/abc123XYZ'), { platform: 'youtube', id: 'abc123XYZ', feed: false });
  assert.deepEqual(C.classify('m.youtube.com', '/shorts/abc-123_x'), { platform: 'youtube', id: 'abc-123_x', feed: false });
  assert.equal(C.classify('www.youtube.com', '/watch'), null);
  assert.equal(C.classify('www.youtube.com', '/'), null);
  assert.equal(C.classify('music.youtube.com', '/shorts/abc123'), null);
});

test('classify: Instagram reel pages and the reels feed', () => {
  assert.deepEqual(C.classify('www.instagram.com', '/reels/Cx12_ab/'), { platform: 'instagram', id: 'Cx12_ab', feed: false });
  assert.deepEqual(C.classify('www.instagram.com', '/reel/Cx12_ab/'), { platform: 'instagram', id: 'Cx12_ab', feed: false });
  assert.deepEqual(C.classify('www.instagram.com', '/reels/'), { platform: 'instagram', id: null, feed: true });
  assert.equal(C.classify('www.instagram.com', '/reels/audio/12345/'), null);
  assert.equal(C.classify('www.instagram.com', '/'), null);
  assert.equal(C.classify('www.instagram.com', '/someone/'), null);
});

test('classify: TikTok feed has no id, video pages do, other pages are ignored', () => {
  assert.deepEqual(C.classify('www.tiktok.com', '/'), { platform: 'tiktok', id: null, feed: true });
  assert.deepEqual(C.classify('www.tiktok.com', '/foryou'), { platform: 'tiktok', id: null, feed: true });
  assert.deepEqual(C.classify('www.tiktok.com', '/en/'), { platform: 'tiktok', id: null, feed: true });
  assert.deepEqual(C.classify('www.tiktok.com', '/@some.user/video/7301234567890'), { platform: 'tiktok', id: '7301234567890', feed: false });
  assert.equal(C.classify('www.tiktok.com', '/@some.user'), null);
  assert.equal(C.classify('www.tiktok.com', '/explore'), null);
  assert.equal(C.classify('www.tiktok.com', '/search'), null);
});

test('classify: Facebook reels', () => {
  assert.deepEqual(C.classify('www.facebook.com', '/reel/1234567890'), { platform: 'facebook', id: '1234567890', feed: false });
  assert.deepEqual(C.classify('web.facebook.com', '/reel/1234567890'), { platform: 'facebook', id: '1234567890', feed: false });
  assert.deepEqual(C.classify('www.facebook.com', '/reel/'), { platform: 'facebook', id: null, feed: true });
  assert.equal(C.classify('www.facebook.com', '/groups/abc'), null);
});

test('classify: more address forms and host variants', () => {
  assert.equal(C.classify('de-de.facebook.com', '/reel/123456').platform, 'facebook');
  assert.equal(C.classify('mbasic.facebook.com', '/reel/123456').platform, 'facebook');
  assert.equal(C.classify('www.youtube.com.', '/shorts/abc123').platform, 'youtube'); // trailing dot
  assert.equal(C.classify('m.tiktok.com', '/@a/video/777').id, '777');
  assert.equal(C.classify('www.tiktok.com', '/video/777').id, '777');
  assert.equal(C.classify('www.instagram.com', '/someone/reel/Cabc_12/').id, 'Cabc_12');
  assert.equal(C.classify('www.facebook.com', '/share/r/AbC123/').id, 'AbC123');
  assert.equal(C.classify('www.facebook.com', '/share/p/AbC123/'), null);
});

test('classify: look-alike hosts and junk input are rejected', () => {
  assert.equal(C.classify('youtube.com.evil.example', '/shorts/abc123'), null);
  assert.equal(C.classify('evilyoutube.com', '/shorts/abc123'), null);
  assert.equal(C.classify('', ''), null);
  assert.equal(C.classify(undefined, undefined), null);
});

// -------------------------------------------------------------- tracker

function snap(over) {
  return Object.assign({ platform: 'youtube', key: 'youtube:a', playing: true, visible: true, lastInputAt: 0 }, over);
}

function run(tracker, seconds, make) {
  let t = 1000;
  const out = { addMs: 0, reels: 0 };
  for (let i = 0; i <= seconds; i++) {
    const r = tracker.tick(t, make(t, i));
    out.addMs += r.addMs;
    out.reels += r.newReel ? 1 : 0;
    t += 1000;
  }
  return out;
}

test('tracker: counts a reel after the dwell time, once, and times it', () => {
  const tr = new C.ReelTracker({ minDwellSec: 2, idleCutoffSec: 120 });
  const r = run(tr, 10, (t) => snap({ lastInputAt: t }));
  assert.equal(r.reels, 1);
  assert.equal(r.addMs, 10000);
});

test('tracker: a reel shorter than the dwell time is timed but not counted', () => {
  const tr = new C.ReelTracker({ minDwellSec: 3 });
  const r = run(tr, 10, (t, i) => snap({ key: 'youtube:r' + Math.floor(i / 2), lastInputAt: t }));
  assert.equal(r.reels, 0);
  assert.equal(r.addMs, 10000);
});

test('tracker: each new reel is counted once; a looping reel is not recounted', () => {
  const tr = new C.ReelTracker({ minDwellSec: 2 });
  const r = run(tr, 20, (t, i) => snap({ key: 'youtube:r' + Math.floor(i / 5), lastInputAt: t }));
  assert.equal(r.reels, 4); // reels 0..3 each lasted at least 3 ticks of dt; reel 4 has only one tick
});

test('tracker: paused, hidden or off-platform time is not counted', () => {
  const tr = new C.ReelTracker({ minDwellSec: 1 });
  assert.equal(run(tr, 5, (t) => snap({ playing: false, lastInputAt: t })).addMs, 0);
  assert.equal(run(new C.ReelTracker(), 5, (t) => snap({ visible: false, lastInputAt: t })).addMs, 0);
  assert.equal(run(new C.ReelTracker(), 5, () => null).addMs, 0);
  assert.equal(run(new C.ReelTracker(), 5, (t) => snap({ key: null, lastInputAt: t })).addMs, 0);
});

test('tracker: stops timing after the idle cutoff', () => {
  const tr = new C.ReelTracker({ idleCutoffSec: 30 });
  const r = run(tr, 100, () => snap({ lastInputAt: 1000 })); // user never touches the page again
  assert.ok(r.addMs <= 31000 && r.addMs >= 29000, 'timed ' + r.addMs);
});

test('tracker: a long gap between ticks (sleep, throttling) is capped, not counted', () => {
  const tr = new C.ReelTracker();
  tr.tick(1000, snap({ lastInputAt: 1000 }));
  const r = tr.tick(1000 + 3600000, snap({ lastInputAt: 1000 + 3600000 }));
  assert.equal(r.addMs, 2500);
});

test('tracker: pausing mid-reel then resuming does not recount it', () => {
  const tr = new C.ReelTracker({ minDwellSec: 2 });
  let reels = 0;
  let t = 1000;
  const step = (playing) => { reels += tr.tick(t, snap({ playing, lastInputAt: t })).newReel ? 1 : 0; t += 1000; };
  [true, true, true, false, false, true, true, true].forEach(step);
  assert.equal(reels, 1);
});

test('tracker: leaving the reel page and coming back counts the reel again', () => {
  const tr = new C.ReelTracker({ minDwellSec: 2 });
  let reels = 0;
  let t = 1000;
  const step = (s) => { reels += tr.tick(t, s).newReel ? 1 : 0; t += 1000; };
  for (let i = 0; i < 4; i++) step(snap({ lastInputAt: t }));
  step(null);
  for (let i = 0; i < 4; i++) step(snap({ lastInputAt: t }));
  assert.equal(reels, 2);
});

// ---------------------------------------------------------------- dates

test('dayKey uses the local calendar day and addDays crosses month and year ends', () => {
  assert.equal(C.dayKey(new Date(2026, 9, 24, 23, 59)), '2026-10-24');
  assert.equal(C.dayKey(new Date(2026, 0, 1, 0, 1)), '2026-01-01');
  assert.equal(C.addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(C.addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(C.addDays('2026-10-24', -365), '2025-10-24');
});

test('addDays is stable across daylight saving changes', () => {
  // Dates around common DST transitions must still step by exactly one calendar day.
  for (const start of ['2026-03-07', '2026-03-28', '2026-10-24', '2026-11-01']) {
    let k = start;
    for (let i = 0; i < 10; i++) {
      const next = C.addDays(k, 1);
      assert.ok(next > k, k + ' -> ' + next);
      assert.equal(C.addDays(next, -1), k);
      k = next;
    }
  }
});

test('weekdayIndex: Monday is 0, Sunday is 6', () => {
  assert.equal(C.weekdayIndex('2026-10-26'), 0); // Monday
  assert.equal(C.weekdayIndex('2026-10-25'), 6); // Sunday
});

// ---------------------------------------------------------------- stats

test('recordActivity accumulates totals per day, platform and hour', () => {
  const stats = {};
  const at = new Date(2026, 9, 24, 22, 30);
  C.recordActivity(stats, at, { platform: 'youtube', reels: 2, seconds: 40 });
  C.recordActivity(stats, at, { platform: 'tiktok', reels: 1, seconds: 15 });
  C.recordActivity(stats, new Date(2026, 9, 24, 23, 5), { platform: 'youtube', reels: 1, seconds: 10 });
  const d = stats['2026-10-24'];
  assert.equal(d.r, 4);
  assert.equal(d.s, 65);
  assert.deepEqual(d.p.youtube, { r: 3, s: 50 });
  assert.deepEqual(d.p.tiktok, { r: 1, s: 15 });
  assert.equal(d.h[22], 55);
  assert.equal(d.h[23], 10);
});

test('stats hold only totals: no ids, urls or timestamps leak into storage', () => {
  const stats = {};
  C.recordActivity(stats, new Date(2026, 9, 24, 12), { platform: 'youtube', reels: 1, seconds: 5 });
  assert.deepEqual(Object.keys(stats['2026-10-24']).sort(), ['h', 'p', 'r', 's']);
});

test('pruneStats drops days older than the retention window', () => {
  const stats = { '2024-01-01': C.emptyDay(), '2026-10-01': C.emptyDay(), '2026-10-24': C.emptyDay() };
  C.pruneStats(stats, '2026-10-24', 400);
  assert.deepEqual(Object.keys(stats).sort(), ['2026-10-01', '2026-10-24']);
});

test('rangeDays returns n days oldest first, filling missing days with zeros', () => {
  const stats = { '2026-10-23': { r: 5, s: 60, p: {}, h: new Array(24).fill(0) } };
  const days = C.rangeDays(stats, '2026-10-24', 3);
  assert.deepEqual(days.map((d) => d.key), ['2026-10-22', '2026-10-23', '2026-10-24']);
  assert.deepEqual(days.map((d) => d.r), [0, 5, 0]);
});

test('sumDays totals reels, seconds and per-platform numbers', () => {
  const stats = {};
  C.recordActivity(stats, new Date(2026, 9, 23, 9), { platform: 'youtube', reels: 3, seconds: 30 });
  C.recordActivity(stats, new Date(2026, 9, 24, 9), { platform: 'youtube', reels: 2, seconds: 20 });
  C.recordActivity(stats, new Date(2026, 9, 24, 9), { platform: 'instagram', reels: 1, seconds: 9 });
  const t = C.sumDays(C.rangeDays(stats, '2026-10-24', 7));
  assert.equal(t.r, 6);
  assert.equal(t.s, 59);
  assert.deepEqual(t.p.youtube, { r: 5, s: 50 });
});

test('weekdayHourHeat sums seconds into weekday x hour cells', () => {
  const stats = {};
  C.recordActivity(stats, new Date(2026, 9, 26, 21, 0), { platform: 'youtube', reels: 1, seconds: 100 }); // Monday 21h
  C.recordActivity(stats, new Date(2026, 9, 19, 21, 0), { platform: 'youtube', reels: 1, seconds: 50 }); // previous Monday
  const grid = C.weekdayHourHeat(stats, '2026-10-26', 30);
  assert.equal(grid[0][21], 150);
  assert.equal(grid.flat().reduce((a, b) => a + b, 0), 150);
});

test('getDay tolerates old or damaged records', () => {
  const d = C.getDay({ '2026-10-24': { r: 2 } }, '2026-10-24');
  assert.equal(d.r, 2);
  assert.equal(d.s, 0);
  assert.equal(d.h.length, 24);
});

// ------------------------------------------------------------- settings

test('normalizeSettings fills defaults and clamps nonsense', () => {
  const d = C.normalizeSettings();
  assert.equal(d.minDwellSec, 2);
  assert.equal(d.dailyReelLimit, 0);
  assert.equal(d.platforms.tiktok, true);

  const s = C.normalizeSettings({
    minDwellSec: 99, idleCutoffSec: -5, dailyReelLimit: 'abc', dailyMinuteLimit: 99999, streakNudge: 12.6,
    counterCorner: 'middle', platforms: { youtube: false, bogus: true }, counterPos: { x: 5, y: -1 }, snoozeUntil: 'x',
  });
  assert.equal(s.minDwellSec, 10);
  assert.equal(s.idleCutoffSec, 30);
  assert.equal(s.dailyReelLimit, 0);
  assert.equal(s.dailyMinuteLimit, 1440);
  assert.equal(s.streakNudge, 13);
  assert.equal(s.counterCorner, 'video-top');
  assert.equal(C.normalizeSettings({ counterCorner: 'middle-right' }).counterCorner, 'middle-right');
  assert.equal(s.platforms.youtube, false);
  assert.equal(s.platforms.instagram, true);
  assert.equal('bogus' in s.platforms, false);
  assert.equal('counterPos' in s, false, 'a saved dragged position is ignored and dropped');
  assert.equal(s.snoozeUntil, 0);
});

test('normalizeSettings drops a counterPos saved by 1.0.0 and keeps everything else', () => {
  const old = { counterCorner: 'top-right', counterPos: { x: 0.3, y: 0.4 }, dailyReelLimit: 40, snoozeUntil: 12345 };
  const s = C.normalizeSettings(old);
  assert.equal('counterPos' in s, false);
  assert.equal(s.counterCorner, 'top-right');
  assert.equal(s.dailyReelLimit, 40);
  assert.equal(s.snoozeUntil, 12345);
  assert.equal(C.DEFAULTS.counterCorner, 'video-top');
  assert.equal('counterPos' in C.DEFAULTS, false);
  assert.equal('counterPos' in C.normalizeSettings(C.normalizeSettings(old)), false, 'stays gone after a second pass');
  for (const corner of C.CORNERS) assert.equal(C.normalizeSettings({ counterCorner: corner }).counterCorner, corner);
});

// ---------------------------------------------------------------- pause text

const at = (h, m, sec) => new Date(2026, 9, 24, h, m, sec || 0, 0).getTime();

test('formatLeft: seconds under a minute, minutes under an hour, then hours', () => {
  assert.equal(C.formatLeft(0), '0s left');
  assert.equal(C.formatLeft(-5), '0s left');
  assert.equal(C.formatLeft(45000), '45s left');
  assert.equal(C.formatLeft(59001), '1m left');
  assert.equal(C.formatLeft(59000), '59s left');
  assert.equal(C.formatLeft(60000), '1m left');
  assert.equal(C.formatLeft(15 * 60000), '15m left');
  assert.equal(C.formatLeft(14 * 60000 + 1000), '15m left', 'rounds up like the popup');
  assert.equal(C.formatLeft(14 * 60000 - 1000), '14m left');
  assert.equal(C.formatLeft(59 * 60000 + 1), '1h left');
  assert.equal(C.formatLeft(60 * 60000), '1h left');
  assert.equal(C.formatLeft(65 * 60000), '1h 05m left');
  assert.equal(C.formatLeft(3 * 3600000 + 30 * 60000), '3h 30m left');
});

test('formatClock is 24 hour HH:MM in local time', () => {
  assert.equal(C.formatClock(at(9, 5)), '09:05');
  assert.equal(C.formatClock(at(23, 59)), '23:59');
  assert.equal(C.formatClock(at(0, 0)), '00:00');
});

test('isRestOfDay: only an end exactly at local midnight', () => {
  const d = new Date(at(21, 0)); d.setHours(24, 0, 0, 0);
  assert.equal(C.isRestOfDay(d.getTime()), true);
  assert.equal(C.isRestOfDay(d.getTime() + 60000), false);
  assert.equal(C.isRestOfDay(at(14, 30)), false);
  assert.equal(C.isRestOfDay(0), false);
});

test('describeSnooze: a 15 minute pause, a long pause, rest of today, and nothing', () => {
  const now = at(14, 17, 30);
  const p = C.describeSnooze(now + 15 * 60000, now);
  assert.equal(p.active, true);
  assert.equal(p.short, '15m left');
  assert.equal(p.long, 'Tracking paused until 14:32');
  assert.equal(p.rest, false);

  const hour = C.describeSnooze(now + 3600000, now);
  assert.equal(hour.short, '1h left');
  assert.equal(hour.long, 'Tracking paused until 15:17');

  const midnight = new Date(now); midnight.setHours(24, 0, 0, 0);
  const rest = C.describeSnooze(midnight.getTime(), now);
  assert.equal(rest.rest, true);
  assert.equal(rest.short, 'till midnight');
  assert.equal(rest.long, 'Tracking paused until midnight');
  assert.ok(!/d{3,}m/.test(rest.short + rest.long), 'never something like 1023m left');

  for (const until of [0, now, now - 1000]) {
    const none = C.describeSnooze(until, now);
    assert.equal(none.active, false);
    assert.equal(none.short, '');
  }
});

test('extendSnooze adds to what is left, or starts from now', () => {
  const now = at(10, 0);
  assert.equal(C.extendSnooze(now + 5 * 60000, now, 15), now + 20 * 60000);
  assert.equal(C.extendSnooze(0, now, 15), now + 15 * 60000);
  assert.equal(C.extendSnooze(now - 60000, now, 15), now + 15 * 60000);
});

// ---------------------------------------------------------------- limits

test('evaluateLimits: off, near (80%), over', () => {
  const settings = C.normalizeSettings({ dailyReelLimit: 100 });
  const day = (r, s) => ({ r, s, p: {}, h: [] });
  assert.equal(C.evaluateLimits(C.normalizeSettings(), day(500, 99999)).hasLimit, false);
  assert.equal(C.evaluateLimits(settings, day(50, 0)).near, false);
  assert.equal(C.evaluateLimits(settings, day(80, 0)).near, true);
  assert.equal(C.evaluateLimits(settings, day(100, 0)).over, true);
  const mins = C.normalizeSettings({ dailyMinuteLimit: 30 });
  assert.equal(C.evaluateLimits(mins, day(0, 29 * 60)).over, false);
  assert.equal(C.evaluateLimits(mins, day(0, 30 * 60)).over, true);
});

test('goalStreak counts days under the limit since install and stops at the first miss', () => {
  const settings = C.normalizeSettings({ dailyReelLimit: 50 });
  const stats = {
    '2026-10-20': { r: 90, s: 0, p: {}, h: [] }, // over
    '2026-10-22': { r: 10, s: 0, p: {}, h: [] },
    '2026-10-24': { r: 49, s: 0, p: {}, h: [] },
  };
  assert.equal(C.goalStreak(stats, '2026-10-24', settings, '2026-10-01'), 4); // 24, 23, 22, 21
  assert.equal(C.goalStreak(stats, '2026-10-24', settings, '2026-10-23'), 2); // install day caps it
  assert.equal(C.goalStreak(stats, '2026-10-24', C.normalizeSettings(), '2026-10-01'), 0); // no goal set
});

// ---------------------------------------------------------------- nudges

test('streak nudge fires every N reels within one session', () => {
  const settings = C.normalizeSettings({ streakNudge: 5 });
  let session = null;
  const fired = [];
  let reels = 0;
  for (let i = 0; i < 12; i++) {
    reels += 1;
    session = C.advanceSession(session, 1000 + i * 1000, 1, 8);
    const d = C.decideNudge(settings, { r: reels, s: reels * 8, p: {}, h: [] }, '2026-10-24', session);
    session = d.session;
    if (d.nudge) fired.push([reels, d.nudge.kind]);
  }
  assert.deepEqual(fired, [[5, 'streak'], [10, 'streak']]);
});

test('a break longer than the session gap resets the streak', () => {
  let s = C.advanceSession(null, 0, 20, 100);
  assert.equal(s.streak, 20);
  s = C.advanceSession(s, C.SESSION_GAP_MS - 1, 1, 5);
  assert.equal(s.streak, 21);
  s = C.advanceSession(s, C.SESSION_GAP_MS * 3, 1, 5);
  assert.equal(s.streak, 1);
});

test('limit nudge: pause on first crossing, then a reminder every 10 reels, never spam', () => {
  const settings = C.normalizeSettings({ dailyReelLimit: 20, streakNudge: 0 });
  let session = null;
  const events = [];
  for (let r = 1; r <= 45; r++) {
    session = C.advanceSession(session, r * 1000, 1, 5);
    const d = C.decideNudge(settings, { r, s: r * 5, p: {}, h: [] }, '2026-10-24', session);
    session = d.session;
    if (d.nudge) events.push([r, d.nudge.kind, !!d.nudge.pause]);
  }
  assert.deepEqual(events, [[16, 'near', false], [20, 'limit', true], [30, 'limit-more', false], [40, 'limit-more', false]]);
});

test('limit nudge starts fresh on a new day, even inside the same session', () => {
  const settings = C.normalizeSettings({ dailyReelLimit: 5, streakNudge: 0, nearLimitNudge: false });
  let session = C.advanceSession(null, 1000, 5, 30);
  let d = C.decideNudge(settings, { r: 5, s: 30, p: {}, h: [] }, '2026-10-24', session);
  assert.equal(d.nudge.kind, 'limit');
  session = C.advanceSession(d.session, 2000, 1, 5);
  d = C.decideNudge(settings, { r: 5, s: 35, p: {}, h: [] }, '2026-10-25', session);
  assert.equal(d.nudge.kind, 'limit');
});

test('mindfulPause off turns the first limit nudge into a plain toast', () => {
  const settings = C.normalizeSettings({ dailyReelLimit: 5, mindfulPause: false, streakNudge: 0 });
  const session = C.advanceSession(null, 1000, 5, 30);
  const d = C.decideNudge(settings, { r: 5, s: 30, p: {}, h: [] }, '2026-10-24', session);
  assert.equal(d.nudge.kind, 'limit');
  assert.equal(d.nudge.pause, false);
});

// ---------------------------------------------------------- presentation

test('formatDuration and formatCompact', () => {
  assert.equal(C.formatDuration(0), '0s');
  assert.equal(C.formatDuration(59), '59s');
  assert.equal(C.formatDuration(60), '1m');
  assert.equal(C.formatDuration(3599), '59m');
  assert.equal(C.formatDuration(3600), '1h 00m');
  assert.equal(C.formatDuration(3600 + 5 * 60), '1h 05m');
  assert.equal(C.formatCompact(999), '999');
  assert.equal(C.formatCompact(1000), '1k');
  assert.equal(C.formatCompact(1250), '1.3k');
  assert.equal(C.formatCompact(15400), '15k');
});

test('niceScale gives clean axis maxima', () => {
  assert.deepEqual(C.niceScale(0), { max: 1, ticks: [0, 1] });
  assert.deepEqual(C.niceScale(87), { max: 100, ticks: [0, 20, 40, 60, 80, 100] });
  const s = C.niceScale(7);
  assert.ok(s.max >= 7);
  assert.equal(s.ticks[0], 0);
  assert.equal(s.ticks[s.ticks.length - 1], s.max);
});

test('pctChange', () => {
  assert.equal(C.pctChange(150, 100), 50);
  assert.equal(C.pctChange(50, 100), -50);
  assert.equal(C.pctChange(5, 0), null);
});

test('buildInsights: empty state, then real observations', () => {
  const empty = C.buildInsights({}, '2026-10-24', C.normalizeSettings(), '2026-10-01');
  assert.equal(empty.length, 1);
  assert.match(empty[0].text, /No reels tracked yet/);
  assert.equal(empty[0].kind, 'empty');

  const stats = {};
  for (let i = 0; i < 7; i++) {
    C.recordActivity(stats, new Date(2026, 9, 18 + i, 22, 10), { platform: 'youtube', reels: 30, seconds: 1800 });
  }
  for (let i = 0; i < 7; i++) {
    C.recordActivity(stats, new Date(2026, 9, 11 + i, 22, 10), { platform: 'youtube', reels: 10, seconds: 600 });
  }
  const out = C.buildInsights(stats, '2026-10-24', C.normalizeSettings(), '2026-10-01');
  assert.match(out[0].text, /Last 7 days: 210 reels, 3h 30m/);
  assert.equal(out[0].kind, 'summary');
  assert.ok(out.some((i) => i.kind === 'up' && /Up 200%/.test(i.text)), JSON.stringify(out));
  assert.ok(out.some((i) => i.kind === 'peak' && /between 22:00 and 23:00/.test(i.text)), JSON.stringify(out));
});

test('buildInsights does not compare with a week that began before the install', () => {
  const stats = {};
  for (let i = 0; i < 7; i++) {
    C.recordActivity(stats, new Date(2026, 9, 18 + i, 20), { platform: 'youtube', reels: 30, seconds: 1800 });
  }
  const out = C.buildInsights(stats, '2026-10-24', C.normalizeSettings(), '2026-10-18');
  assert.ok(!out.some((i) => i.kind === 'up' || i.kind === 'down'), JSON.stringify(out));
});

test('toCsv has a header, one row per day in date order, and zeros for unused apps', () => {
  const stats = {};
  C.recordActivity(stats, new Date(2026, 9, 24, 9), { platform: 'tiktok', reels: 4, seconds: 70 });
  C.recordActivity(stats, new Date(2026, 9, 23, 9), { platform: 'youtube', reels: 1, seconds: 10 });
  const lines = C.toCsv(stats).trim().split('\n');
  assert.equal(lines[0], 'date,reels,seconds,youtube_reels,youtube_seconds,instagram_reels,instagram_seconds,tiktok_reels,tiktok_seconds,facebook_reels,facebook_seconds');
  assert.equal(lines[1], '2026-10-23,1,10,1,10,0,0,0,0,0,0');
  assert.equal(lines[2], '2026-10-24,4,70,0,0,0,0,4,70,0,0');
});
