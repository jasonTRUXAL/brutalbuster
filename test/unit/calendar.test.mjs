// The time of day and the season (src/calendar.js), from the visitor's local clock.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { phaseFor, seasonFor } from '../../src/calendar.js';

const at = (month, day, hour = 12) => new Date(2026, month - 1, day, hour, 0, 0);

test('the sky follows the local hour', () => {
  assert.deepEqual([0, 5, 6, 7, 12, 16, 17, 19, 20, 23].map((h) => phaseFor(at(6, 1, h))), ['night', 'dawn', 'dawn', 'day', 'day', 'day', 'dusk', 'dusk', 'night', 'night']);
});

test('decorations by the calendar, including over New Year', () => {
  assert.equal(seasonFor(at(9, 30)), null);
  assert.equal(seasonFor(at(10, 1)), 'halloween');
  assert.equal(seasonFor(at(10, 31)), 'halloween');
  assert.equal(seasonFor(at(11, 1)), null);
  assert.equal(seasonFor(at(12, 1)), 'winter');
  assert.equal(seasonFor(at(12, 31)), 'winter');
  assert.equal(seasonFor(at(1, 6)), 'winter');
  assert.equal(seasonFor(at(1, 7)), null);
  assert.equal(seasonFor(at(2, 14)), 'valentine');
  assert.equal(seasonFor(at(2, 15)), null);
});
