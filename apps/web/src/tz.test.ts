import test from 'node:test';
import assert from 'node:assert/strict';
import { zonedToUtc, utcToZonedLocal } from './tz.ts';

test('Asia/Kolkata is UTC+5:30', () => assert.equal(zonedToUtc('2026-11-01T09:30', 'Asia/Kolkata').toISOString(), '2026-11-01T04:00:00.000Z'));
test('UTC stays put', () => assert.equal(zonedToUtc('2026-11-01T09:30', 'UTC').toISOString(), '2026-11-01T09:30:00.000Z'));
test('New York before DST ends (EDT, UTC-4)', () => assert.equal(zonedToUtc('2026-10-31T12:00', 'America/New_York').toISOString(), '2026-10-31T16:00:00.000Z'));
test('New York after DST ends on 1 Nov 2026 (EST, UTC-5)', () => assert.equal(zonedToUtc('2026-11-02T12:00', 'America/New_York').toISOString(), '2026-11-02T17:00:00.000Z'));
test('London after clocks go back (GMT)', () => assert.equal(zonedToUtc('2026-10-26T12:00', 'Europe/London').toISOString(), '2026-10-26T12:00:00.000Z'));
test('Sydney in summer time (UTC+11)', () => assert.equal(zonedToUtc('2026-11-01T12:00', 'Australia/Sydney').toISOString(), '2026-11-01T01:00:00.000Z'));
test('New York 1 Nov 2026 00:30 is still summer time (UTC-4)', () => assert.equal(zonedToUtc('2026-11-01T00:30', 'America/New_York').toISOString(), '2026-11-01T04:30:00.000Z'));
test('New York 1 Nov 2026 12:00 is winter time (UTC-5)', () => assert.equal(zonedToUtc('2026-11-01T12:00', 'America/New_York').toISOString(), '2026-11-01T17:00:00.000Z'));
test('Auckland in summer time (UTC+13)', () => assert.equal(zonedToUtc('2026-12-01T12:00', 'Pacific/Auckland').toISOString(), '2026-11-30T23:00:00.000Z'));
test('utcToZonedLocal shows Kolkata wall clock', () => assert.equal(utcToZonedLocal(new Date('2026-11-01T04:00:00Z'), 'Asia/Kolkata'), '2026-11-01T09:30'));
test('round trip across the New York clock change', () => {
  for (const iso of ['2026-11-01T04:30:00Z', '2026-11-01T07:00:00Z', '2026-11-02T17:00:00Z', '2026-03-08T12:00:00Z'])
    assert.equal(zonedToUtc(utcToZonedLocal(new Date(iso), 'America/New_York'), 'America/New_York').toISOString(), new Date(iso).toISOString().replace('.000Z', '.000Z'));
});
