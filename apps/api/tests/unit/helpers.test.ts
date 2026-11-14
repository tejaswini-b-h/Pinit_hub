import { sniffImage } from '../../src/services/imageSniff';
import { challengeFor, makeVerifier, randomState } from '../../src/services/pkce';
import { backoffSeconds } from '../../src/worker/backoff';
import { escapeCommentary, linkedinAdapter } from '../../src/adapters/linkedin';
import { facebookPageAdapter } from '../../src/adapters/facebookPage';
import { telegramAdapter } from '../../src/adapters/telegram';
import { blueskyAdapter, rkeyFor } from '../../src/adapters/bluesky';
import { PlatformHttpError } from '../../src/adapters/types';
import { deflateSync } from 'zlib';

const pngHeader = (w: number, h: number) => { const b = Buffer.alloc(33); b.writeUInt32BE(0x89504e47, 0); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); return b; };

describe('image sniffing (type comes from bytes, not name)', () => {
  test('png', () => expect(sniffImage(pngHeader(800, 500))).toEqual({ mime: 'image/png', width: 800, height: 500 }));
  test('jpeg', () => {
    const b = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, 0x01, 0xf4, 0x03, 0x20, 3, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(sniffImage(b)).toEqual({ mime: 'image/jpeg', width: 800, height: 500 });
  });
  test('an .exe renamed to .png is rejected', () => expect(sniffImage(Buffer.from('MZ\x90\x00 not an image at all, really'))).toBeNull());
});

describe('oauth helpers', () => {
  test('state is random and long', () => { expect(randomState()).not.toBe(randomState()); expect(randomState().length).toBeGreaterThan(30); });
  test('PKCE S256 matches the RFC 7636 example', () =>
    expect(challengeFor('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'));
  test('verifier is long enough (43+ chars)', () => expect(makeVerifier().length).toBeGreaterThanOrEqual(43));
});

describe('backoff', () => {
  test('grows 1, 5, 15, 60 minutes (+-10%)', () => {
    [60, 300, 900, 3600].forEach((base, i) => { const s = backoffSeconds(i + 1); expect(s).toBeGreaterThanOrEqual(base * 0.9 - 1); expect(s).toBeLessThanOrEqual(base * 1.1 + 1); });
  });
  test('honours Retry-After', () => expect(Math.abs(backoffSeconds(1, 120) - 120)).toBeLessThanOrEqual(13));
});

describe('LinkedIn adapter', () => {
  test('escapes markup characters', () => expect(escapeCommentary('a (b) #c @d')).toBe('a \\(b\\) \\#c \\@d'));
  test('over 3000 characters is flagged', () => expect(linkedinAdapter.validate({ idempotencyKey: 'k', text: 'x'.repeat(3001), media: [] })).toHaveLength(1));
  test('empty post is flagged', () => expect(linkedinAdapter.validate({ idempotencyKey: 'k', text: '', media: [] })).toHaveLength(1));
  test.each([[401, 'AUTH'], [403, 'BLOCKED'], [422, 'VALIDATION'], [429, 'RETRYABLE'], [503, 'RETRYABLE']])('HTTP %i -> %s', (s, c) =>
    expect(linkedinAdapter.classify(new PlatformHttpError(s as number, 'x')).class).toBe(c));
  test('timeouts are ambiguous and the platform has no lookup', () => {
    expect(linkedinAdapter.classify(new Error('timeout')).ambiguous).toBe(true);
    expect(linkedinAdapter.canLookup).toBe(false);
  });
});

describe('Facebook adapter', () => {
  const err = (status: number, code: number) => new PlatformHttpError(status, JSON.stringify({ error: { code, message: 'm' } }));
  test('code 190 -> AUTH', () => expect(facebookPageAdapter.classify(err(400, 190)).class).toBe('AUTH'));
  test('code 4 -> RETRYABLE', () => expect(facebookPageAdapter.classify(err(400, 4)).class).toBe('RETRYABLE'));
  test('code 100 -> VALIDATION', () => expect(facebookPageAdapter.classify(err(400, 100)).class).toBe('VALIDATION'));
  test('code 368 -> BLOCKED', () => expect(facebookPageAdapter.classify(err(403, 368)).class).toBe('BLOCKED'));
  test('11 images flagged', () => {
    const m = { url: '', mime: 'image/png', width: 1, height: 1, bytes: 1 };
    expect(facebookPageAdapter.validate({ idempotencyKey: 'k', text: 'hi', media: Array(11).fill(m) })).toHaveLength(1);
  });
});

describe('Bluesky / Telegram', () => {
  test('bluesky rkey is deterministic and valid-looking', () => { expect(rkeyFor('p:a')).toBe(rkeyFor('p:a')); expect(rkeyFor('p:a')).toMatch(/^[2-7a-j][2-7a-z]{12}$/); });
  test('bluesky 301 chars flagged', () => expect(blueskyAdapter.validate({ idempotencyKey: 'k', text: 'x'.repeat(301), media: [] })).toHaveLength(1));
  test('telegram caption limit is 1024 with a photo', () => {
    const m = { url: '', mime: 'image/png', width: 1, height: 1, bytes: 1 };
    expect(telegramAdapter.validate({ idempotencyKey: 'k', text: 'x'.repeat(1025), media: [m] })).toHaveLength(1);
  });
  test('telegram 403 -> BLOCKED', () => expect(telegramAdapter.classify(new PlatformHttpError(403, 'x')).class).toBe('BLOCKED'));
});

import { pickBestHour } from '../../src/services/bestTime';
describe('best-time hint', () => {
  test('no history -> no suggestion', () => expect(pickBestHour([])).toBeNull());
  test('ignores hours with fewer than 2 samples', () => expect(pickBestHour([{ hour: 9, n: 1, ok: 1 }])).toBeNull());
  test('highest success rate wins, then most samples', () => {
    expect(pickBestHour([{ hour: 9, n: 10, ok: 9 }, { hour: 14, n: 4, ok: 4 }, { hour: 20, n: 20, ok: 18 }])).toEqual({ hourUtc: 14, successRate: 1, samples: 4 });
    expect(pickBestHour([{ hour: 9, n: 10, ok: 10 }, { hour: 14, n: 4, ok: 4 }])?.hourUtc).toBe(9);
  });
});
