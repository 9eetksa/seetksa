import test from 'node:test';
import assert from 'node:assert/strict';
import { riyadhToday, teamPeriodRange } from '../src/admin/team-overview-periods.js';

const now = new Date('2026-09-14T21:00:00Z');

function assertRejected(range) {
  assert.equal(range.start, '');
  assert.equal(range.end, '');
  assert.match(range.error, /[\u0600-\u06ff]/);
  assert.doesNotMatch(range.error, /[.,،…·]/);
}

test('Riyadh starts a new calendar day at exactly 21 UTC', () => {
  assert.equal(riyadhToday(new Date('2026-09-14T20:59:59.999Z')), '2026-09-14');
  assert.equal(riyadhToday(now), '2026-09-15');
  assert.equal(riyadhToday(new Date('2026-09-15T20:59:59.999Z')), '2026-09-15');
});

test('today is a single inclusive Riyadh date', () => {
  assert.deepEqual(teamPeriodRange('today', { now }), {
    start: '2026-09-15', end: '2026-09-15', error: '',
  });
});

test('the default current month ends today rather than at month end', () => {
  const expected = { start: '2026-09-01', end: '2026-09-15', error: '' };
  assert.deepEqual(teamPeriodRange(undefined, { now }), expected);
  assert.deepEqual(teamPeriodRange('month', { now }), expected);
});

test('last seven days includes today and crosses the year boundary', () => {
  assert.deepEqual(teamPeriodRange('last7', { now }), {
    start: '2026-09-09', end: '2026-09-15', error: '',
  });
  assert.deepEqual(teamPeriodRange('last7', { now: new Date('2026-01-02T21:00:00Z') }), {
    start: '2025-12-28', end: '2026-01-03', error: '',
  });
});

test('the previous month covers every day including leap February', () => {
  const cases = [
    ['2024-03-15T00:00:00Z', '2024-02-01', '2024-02-29'],
    ['2023-03-15T00:00:00Z', '2023-02-01', '2023-02-28'],
    ['2026-05-15T00:00:00Z', '2026-04-01', '2026-04-30'],
    ['2025-12-31T21:00:00Z', '2025-12-01', '2025-12-31'],
  ];
  for (const [instant, start, end] of cases) {
    assert.deepEqual(teamPeriodRange('lastMonth', { now: new Date(instant) }), { start, end, error: '' });
  }
});

test('current month includes leap day until the next Riyadh midnight', () => {
  assert.deepEqual(teamPeriodRange('month', { now: new Date('2024-02-29T20:59:59Z') }), {
    start: '2024-02-01', end: '2024-02-29', error: '',
  });
  assert.deepEqual(teamPeriodRange('month', { now: new Date('2024-02-29T21:00:00Z') }), {
    start: '2024-03-01', end: '2024-03-01', error: '',
  });
});

test('year to date resets at the Riyadh year boundary', () => {
  assert.deepEqual(teamPeriodRange('year', { now }), {
    start: '2026-01-01', end: '2026-09-15', error: '',
  });
  assert.deepEqual(teamPeriodRange('year', { now: new Date('2025-12-31T21:00:00Z') }), {
    start: '2026-01-01', end: '2026-01-01', error: '',
  });
});

test('custom ranges accept leap days and a single day including today', () => {
  for (const [start, end] of [['2024-02-29', '2024-03-01'], ['2026-09-15', '2026-09-15']]) {
    assert.deepEqual(teamPeriodRange('custom', { now, start, end }), { start, end, error: '' });
  }
});

test('custom ranges require both dates', () => {
  for (const dates of [{}, { start: '2026-09-01' }, { end: '2026-09-15' }]) {
    assertRejected(teamPeriodRange('custom', { now, ...dates }));
  }
});

test('custom ranges accept the server limit of 3660 days between inclusive dates', () => {
  assert.deepEqual(teamPeriodRange('custom', { now, start: '2016-09-07', end: '2026-09-15' }), {
    start: '2016-09-07', end: '2026-09-15', error: '',
  });
});

test('custom ranges reject one day beyond the server limit with a clear maximum', () => {
  const range = teamPeriodRange('custom', { now, start: '2016-09-06', end: '2026-09-15' });
  assertRejected(range);
  assert.match(range.error, /3661 يوما/);
});

test('custom dates reject calendar overflow and malformed input', () => {
  const invalidDates = ['2023-02-29', '2024-02-30', '2026-04-31', '2026-13-01', '2026-00-01', '2026-09-00',
    '0000-01-01', '2026-9-01', '2026-09-01T00:00:00Z', ' 2026-09-01', 'invalid', 20260901];
  for (const date of invalidDates) {
    assertRejected(teamPeriodRange('custom', { now, start: date, end: '2026-09-15' }));
    assertRejected(teamPeriodRange('custom', { now, start: '2020-01-01', end: date }));
  }
});

test('custom ranges reject reversed dates', () => {
  assertRejected(teamPeriodRange('custom', { now, start: '2026-09-15', end: '2026-09-14' }));
});

test('custom ranges reject future dates according to Riyadh rather than UTC', () => {
  assertRejected(teamPeriodRange('custom', { now, start: '2026-09-01', end: '2026-09-16' }));
  assertRejected(teamPeriodRange('custom', { now, start: '2026-09-16', end: '2026-09-17' }));
  assertRejected(teamPeriodRange('custom', {
    now: new Date('2026-09-14T20:59:59Z'), start: '2026-09-15', end: '2026-09-15',
  }));
  assert.deepEqual(teamPeriodRange('custom', { now, start: '2026-09-15', end: '2026-09-15' }), {
    start: '2026-09-15', end: '2026-09-15', error: '',
  });
});

test('an invalid clock cannot produce a queryable date range', () => {
  const invalidNow = new Date('invalid');
  assert.equal(riyadhToday(invalidNow), '');
  assertRejected(teamPeriodRange('month', { now: invalidNow }));
});

test('unknown period identifiers do not silently select another period', () => {
  assertRejected(teamPeriodRange('unknown', { now }));
});

test('calculating a period preserves the caller date object', () => {
  const original = now.getTime();
  teamPeriodRange('last7', { now });
  teamPeriodRange('lastMonth', { now });
  assert.equal(now.getTime(), original);
});
