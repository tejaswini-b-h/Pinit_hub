import { mockAdapter } from '../../src/adapters/mock';
import { PlatformHttpError } from '../../src/adapters/types';

const ok = { idempotencyKey: 'k', text: 'hi', media: [] };

test('valid draft has no problems', () => expect(mockAdapter.validate(ok)).toEqual([]));
test('too-long text is flagged', () => expect(mockAdapter.validate({ ...ok, text: 'x'.repeat(281) })).toHaveLength(1));
test('too many images flagged', () => {
  const m = { url: 'u', mime: 'image/png', width: 1, height: 1, bytes: 1 };
  expect(mockAdapter.validate({ ...ok, media: [m, m, m, m, m] })).toHaveLength(1);
});
test('wrong mime flagged', () =>
  expect(mockAdapter.validate({ ...ok, media: [{ url: 'u', mime: 'image/gif', width: 1, height: 1, bytes: 1 }] })).toHaveLength(1));

test.each([
  [429, 'RETRYABLE'], [401, 'AUTH'], [400, 'VALIDATION'], [403, 'BLOCKED'], [500, 'RETRYABLE'],
])('HTTP %i classified as %s', (status, cls) =>
  expect(mockAdapter.classify(new PlatformHttpError(status as number, 'x')).class).toBe(cls));
test('timeout classified as RETRYABLE', () => expect(mockAdapter.classify(new Error('timeout')).class).toBe('RETRYABLE'));
