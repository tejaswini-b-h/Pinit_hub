import { PlatformAdapter, PublishInput, PlatformHttpError, commonValidate } from './types';

const API = 'https://api.linkedin.com';
const VERSION = () => process.env.LINKEDIN_VERSION ?? '202609';
const headers = (t: string) => ({
  Authorization: `Bearer ${t}`, 'LinkedIn-Version': VERSION(),
  'X-Restli-Protocol-Version': '2.0.0', 'content-type': 'application/json',
});

/** LinkedIn "little text" treats these characters as markup; escape them so the post shows exactly what the user typed. */
export function escapeCommentary(s: string): string {
  return s.replace(/[\\|{}@\[\]()<>#*_~]/g, c => '\\' + c);
}

async function li(path: string, token: string, init: RequestInit = {}) {
  const r = await fetch(API + path, { ...init, headers: { ...headers(token), ...(init.headers as object) }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new PlatformHttpError(r.status, (await r.text()).slice(0, 500), Number(r.headers.get('retry-after')) || undefined);
  return r;
}

async function uploadImage(owner: string, token: string, m: PublishInput['media'][number]): Promise<string> {
  const init = await (await li('/rest/images?action=initializeUpload', token, {
    method: 'POST', body: JSON.stringify({ initializeUploadRequest: { owner } }),
  })).json() as { value: { uploadUrl: string; image: string } };
  const bytes = await (await fetch(m.url, { signal: AbortSignal.timeout(30000) })).arrayBuffer();
  const put = await fetch(init.value.uploadUrl, {
    method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/octet-stream' },
    body: bytes, signal: AbortSignal.timeout(60000),
  });
  if (!put.ok) throw new PlatformHttpError(put.status, 'image upload failed');
  return init.value.image;
}

export const linkedinAdapter: PlatformAdapter = {
  id: 'linkedin',
  canLookup: false, // reading back member posts needs a restricted scope, so we cannot reconcile
  rules: { maxChars: 3000, maxImages: 9, mime: ['image/jpeg', 'image/png', 'image/gif'], maxImageBytes: 36_000_000 },

  validate(input) { return commonValidate(this.rules, 'LinkedIn', input); },

  async publish(input, token) {
    if (!input.accountExternalId) throw new PlatformHttpError(400, 'missing LinkedIn member id');
    const author = `urn:li:person:${input.accountExternalId}`;
    const ids: string[] = [];
    for (const m of input.media) ids.push(await uploadImage(author, token, m));
    const body: Record<string, unknown> = {
      author, commentary: escapeCommentary(input.text), visibility: 'PUBLIC',
      distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
      lifecycleState: 'PUBLISHED', isReshareDisabledByAuthor: false,
    };
    if (ids.length === 1) body.content = { media: { id: ids[0] } };
    if (ids.length > 1) body.content = { multiImage: { images: ids.map(id => ({ id, altText: '' })) } };
    const r = await li('/rest/posts', token, { method: 'POST', body: JSON.stringify(body) });
    const urn = r.headers.get('x-restli-id');
    if (!urn) throw new PlatformHttpError(502, 'LinkedIn did not return a post id');
    return { externalId: urn, url: `https://www.linkedin.com/feed/update/${urn}/` };
  },

  async findExisting() { return null; },

  classify(error) {
    if (error instanceof PlatformHttpError) {
      if (error.status === 429) return { class: 'RETRYABLE', reason: 'LinkedIn rate limit hit.', retryAfterSeconds: error.retryAfter };
      if (error.status === 401) return { class: 'AUTH', reason: 'LinkedIn rejected the login. Reconnect LinkedIn.' };
      if (error.status === 403) return { class: 'BLOCKED', reason: 'LinkedIn did not allow this (permission or daily limit).' };
      if (error.status === 426) return { class: 'BLOCKED', reason: 'The LinkedIn API version in LINKEDIN_VERSION is no longer supported. Update it.' };
      if (error.status === 422 || error.status === 400) return { class: 'VALIDATION', reason: error.message.slice(0, 200) };
      if (error.status >= 500) return { class: 'RETRYABLE', reason: 'LinkedIn had a server error.', ambiguous: true };
    }
    return { class: 'RETRYABLE', reason: 'LinkedIn did not respond in time.', ambiguous: true };
  },

  // Only works if LinkedIn issued a refresh token (not every app gets one). Otherwise the account becomes "Needs reconnect".
  async refresh(refreshToken) {
    const r = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken,
        client_id: process.env.LINKEDIN_CLIENT_ID ?? '', client_secret: process.env.LINKEDIN_CLIENT_SECRET ?? '' }),
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) throw new PlatformHttpError(r.status, 'refresh failed');
    const j: any = await r.json();
    return { accessToken: j.access_token, refreshToken: j.refresh_token ?? refreshToken, expiresAt: new Date(Date.now() + j.expires_in * 1000) };
  },
};
