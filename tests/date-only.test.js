import test from 'node:test';
import assert from 'node:assert/strict';
import { changeDatePart, dateLabel, endOfRiyadhDay, isDateOnly, riyadhDate } from '../src/shared/date-only.js';

test('date-only deadlines include the whole selected day in Riyadh regardless of device timezone', () => {
  assert.equal(endOfRiyadhDay('2026-09-17'), '2026-09-17T20:59:59.999Z');
  assert.equal(riyadhDate('2026-09-17T21:00:00Z'), '2026-09-18');
  assert.equal(riyadhDate('2026-09-17T20:59:59.999Z'), '2026-09-17');
  assert.equal(riyadhDate(endOfRiyadhDay('2026-01-01')), '2026-01-01');
});

test('invalid and impossible dates are rejected before timestamp conversion', () => {
  for (const value of ['', '2026-02-29', '2026-04-31', '2026-13-01', '2026-2-01', '0000-01-01', '2026-09-17T15:00']) {
    assert.equal(isDateOnly(value), false);
    assert.throws(() => endOfRiyadhDay(value), RangeError);
  }
  assert.equal(isDateOnly('2028-02-29'), true);
});

test('changing wheels preserves valid days at leap year and month boundaries', () => {
  assert.equal(changeDatePart('2028-02-29', 0, 2027), '2027-02-28');
  assert.equal(changeDatePart('2026-01-31', 1, 2), '2026-02-28');
  assert.equal(changeDatePart('2028-01-31', 1, 2), '2028-02-29');
  assert.equal(changeDatePart('2026-03-31', 1, 4), '2026-04-30');
});

test('wheel selections respect date range boundaries', () => {
  assert.equal(changeDatePart('2026-09-20', 2, 1, '2026-09-17'), '2026-09-17');
  assert.equal(changeDatePart('2026-09-17', 1, 12, undefined, '2026-09-21'), '2026-09-21');
  assert.equal(changeDatePart('2026-09-17', 0, 2025, '2026-01-05'), '2026-01-05');
});

test('date labels use Gregorian Arabic dates without time or forbidden punctuation', () => {
  const label = dateLabel('2026-09-17T20:59:59.999Z');
  assert.match(label, /سبتمبر/);
  assert.doesNotMatch(label, /[.,،…·:]|الساعة/);
  assert.equal(dateLabel('2026-09-17'), label);
});
