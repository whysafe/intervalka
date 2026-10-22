import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PRESETS, buildTimeline, countdownCue, decode, encode, formatTime, normalize, positionAt, totalDuration, workDuration,
} from '../js/timeline.js';

test('tabata is 10 s prepare and 8 × 20/10 without a trailing rest', () => {
  const segs = buildTimeline(PRESETS.tabata);
  assert.equal(segs.length, 1 + 8 + 7);
  assert.equal(segs[0].type, 'prepare');
  assert.equal(segs.at(-1).type, 'work');
  assert.equal(totalDuration(segs), 10 + 8 * 20 + 7 * 10);
  assert.equal(workDuration(segs), 160);
});

test('segments are contiguous', () => {
  const segs = buildTimeline(PRESETS.circuit);
  segs.reduce((t, s) => {
    assert.equal(s.start, t);
    return t + s.duration;
  }, 0);
});

test('sets get a rest between them, and cooldown comes last', () => {
  const segs = buildTimeline({ prepare: 0, work: 30, rest: 10, rounds: 2, sets: 3, setRest: 60, cooldown: 120 });
  assert.deepEqual(segs.map((s) => s.type), [
    'work', 'rest', 'work', 'setRest',
    'work', 'rest', 'work', 'setRest',
    'work', 'rest', 'work', 'cooldown',
  ]);
  assert.deepEqual(segs.filter((s) => s.type === 'work').map((s) => `${s.set}.${s.round}`), ['1.1', '1.2', '2.1', '2.2', '3.1', '3.2']);
});

test('zero-length segments are skipped (EMOM has no rest)', () => {
  const segs = buildTimeline(PRESETS.emom);
  assert.ok(segs.every((s) => s.duration > 0));
  assert.equal(segs.filter((s) => s.type === 'rest').length, 0);
});

test('normalize clamps values and fills gaps', () => {
  const c = normalize({ work: 2, rest: -5, rounds: 999, sets: 'abc', extra: 1 });
  assert.deepEqual(c, { prepare: 0, work: 5, rest: 0, rounds: 50, sets: 1, setRest: 0, cooldown: 0 });
});

test('positionAt finds the segment and remaining time', () => {
  const segs = buildTimeline(PRESETS.tabata);
  assert.deepEqual(positionAt(segs, 0), { index: 0, remaining: 10, progress: 0, done: false });
  const p = positionAt(segs, 25); // 10 подготовки + 15 секунд первой работы
  assert.equal(segs[p.index].type, 'work');
  assert.equal(p.remaining, 5);
  assert.equal(p.progress, 0.75);
  const r = positionAt(segs, 31);
  assert.equal(segs[r.index].type, 'rest');
  assert.equal(r.remaining, 9);
});

test('positionAt is exact at boundaries and after the end', () => {
  const segs = buildTimeline(PRESETS.tabata);
  assert.equal(positionAt(segs, 10).index, 1);
  assert.equal(positionAt(segs, 9.999).index, 0);
  assert.equal(positionAt(segs, totalDuration(segs)).done, true);
  assert.equal(positionAt(segs, -3).index, 0);
});

test('3-2-1 countdown cue', () => {
  assert.equal(countdownCue(3), 3);
  assert.equal(countdownCue(2.4), 3);
  assert.equal(countdownCue(1.01), 2);
  assert.equal(countdownCue(0.2), 1);
  assert.equal(countdownCue(3.2), null);
  assert.equal(countdownCue(0), null);
});

test('time formatting rounds up like a countdown', () => {
  assert.equal(formatTime(0), '0:00');
  assert.equal(formatTime(4.1), '0:05');
  assert.equal(formatTime(65), '1:05');
  assert.equal(formatTime(3725), '1:02:05');
});

test('share link round-trips and rejects junk', () => {
  for (const p of Object.values(PRESETS)) {
    assert.deepEqual(decode(encode(p)), normalize(p));
  }
  assert.equal(encode(PRESETS.tabata), '10-20-10-8-1-0-0');
  assert.equal(decode('1-2-3'), null);
  assert.equal(decode('a-b-c-d-e-f-g'), null);
  assert.equal(decode(''), null);
});
