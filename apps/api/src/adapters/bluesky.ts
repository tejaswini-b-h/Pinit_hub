import { createHash } from 'crypto';
import { PlatformAdapter, PublishInput, PlatformHttpError, commonValidate } from './types';

const PDS = process.env.BLUESKY_PDS ?? 'https://bsky.social';
// Credential is stored encrypted as "handle|app-password" (create an App Password in Bluesky settings).

async function session(token: string) {
  const [identifier, password] = token.split('|');
  const r = await fetch(`${PDS}/xrpc/com.atproto.server.createSession`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identifier, password }), signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new PlatformHttpError(r.status === 400 ? 401 : r.status, await r.text());
  return (await r.json()) as { accessJwt: string; did: string; handle: string };
}

/** Deterministic TID-shaped record key derived from the idempotency key: a retry can never create a second post. */
export function rkeyFor(idempotencyKey: string): string {
  const A = '234567abcdefghijklmnopqrstuvwxyz';
  const h = createHash('sha256').update(idempotencyKey).digest();
  let out = '';
  for (let i = 0; i < 13; i++) out += A[h[i] % (i === 0 ? 16 : 32)]; // first char must be in [234567a-j]
  return out;
}

const urlFor = (handle: string, rkey: string) => `https://bsky.app/profile/${handle}/post/${rkey}`;

export const blueskyAdapter: PlatformAdapter = {
  id: 'bluesky',
  rules: { maxChars: 300, maxImages: 4, mime: ['image/jpeg', 'image/png'], maxImageBytes: 1_000_000 },

  validate(input: PublishInput) { return commonValidate(this.rules, 'Bluesky', input); },

  async publish(input, token) {
    const s = await session(token);
    const rkey = rkeyFor(input.idempotencyKey);
    const r = await fetch(`${PDS}/xrpc/com.atproto.repo.createRecord`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${s.accessJwt}` },
      body: JSON.stringify({
        repo: s.did, collection: 'app.bsky.feed.post', rkey,
        record: { $type: 'app.bsky.feed.post', text: input.text, createdAt: new Date().toISOString() },
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) throw new PlatformHttpError(r.status, await r.text(), Number(r.headers.get('retry-after')) || undefined);
    return { externalId: rkey, url: urlFor(s.handle, rkey) };
  },

  async findExisting(input, token) {
    const s = await session(token);
    const rkey = rkeyFor(input.idempotencyKey);
    const q = new URLSearchParams({ repo: s.did, collection: 'app.bsky.feed.post', rkey });
    const r = await fetch(`${PDS}/xrpc/com.atproto.repo.getRecord?${q}`, { signal: AbortSignal.timeout(10000) });
    if (r.ok) return { externalId: rkey, url: urlFor(s.handle, rkey) };
    if (r.status === 400 || r.status === 404) return null; // RecordNotFound
    throw new PlatformHttpError(r.status, await r.text());
  },

  classify(error) {
    if (error instanceof PlatformHttpError) {
      if (error.status === 429) return { class: 'RETRYABLE', reason: 'Bluesky rate limit hit.', retryAfterSeconds: error.retryAfter };
      if (error.status === 401) return { class: 'AUTH', reason: 'Bluesky rejected the handle or app password. Reconnect.' };
      if (error.status === 400 || error.status === 413) return { class: 'VALIDATION', reason: error.message.slice(0, 200) };
      if (error.status >= 500) return { class: 'RETRYABLE', reason: 'Bluesky had a server error.' };
    }
    return { class: 'RETRYABLE', reason: 'Bluesky did not respond in time.' };
  },
};
