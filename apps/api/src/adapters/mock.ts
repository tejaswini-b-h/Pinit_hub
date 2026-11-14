import { PlatformAdapter, PublishInput, PlatformHttpError, commonValidate } from './types';

const BASE_URL = () => process.env.MOCK_PLATFORM_URL ?? 'http://localhost:4200';

async function call(path: string, token: string, body?: unknown, timeoutMs = 3000) {
  const res = await fetch(BASE_URL() + path, {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const ra = res.headers.get('retry-after');
    throw new PlatformHttpError(res.status, await res.text(), ra ? Number(ra) : undefined);
  }
  return res.json();
}

export const mockAdapter: PlatformAdapter = {
  id: 'mock',
  rules: { maxChars: 280, maxImages: 4, mime: ['image/jpeg', 'image/png'], maxImageBytes: 5_000_000 },

  validate(input: PublishInput) { return commonValidate(this.rules, 'Mock platform', input); },

  async publish(input, token) {
    return call('/posts', token, { key: input.idempotencyKey, text: input.text });
  },

  async findExisting(input, token) {
    try { return await call(`/posts/by-key/${encodeURIComponent(input.idempotencyKey)}`, token); }
    catch (e) { if (e instanceof PlatformHttpError && e.status === 404) return null; throw e; }
  },

  classify(error) {
    if (error instanceof PlatformHttpError) {
      if (error.status === 429) return { class: 'RETRYABLE', reason: 'Rate limited by the platform.', retryAfterSeconds: error.retryAfter };
      if (error.status === 401) return { class: 'AUTH', reason: 'The platform rejected the login. Reconnect the account.' };
      if (error.status === 403) return { class: 'BLOCKED', reason: 'Daily limit reached or not allowed. Will retry after reset.' };
      if (error.status === 400) return { class: 'VALIDATION', reason: error.message };
      if (error.status >= 500) return { class: 'RETRYABLE', reason: 'The platform had a server error.', ambiguous: true };
    }
    // timeouts / network errors
    return { class: 'RETRYABLE', reason: 'The platform did not respond in time.', ambiguous: true };
  },

  async refresh(refreshToken) {
    const r = await call('/refresh', refreshToken, {});
    return { accessToken: r.accessToken, refreshToken, expiresAt: new Date(Date.now() + r.expiresIn * 1000) };
  },
};
