import { PlatformAdapter, PublishInput, PlatformHttpError, commonValidate } from './types';

const base = () => `https://graph.facebook.com/${process.env.GRAPH_VERSION ?? 'v26.0'}`;

async function gf(path: string, token: string, init: RequestInit & { form?: Record<string, string> } = {}) {
  const url = new URL(base() + path);
  url.searchParams.set('access_token', token);
  const { form, ...rest } = init;
  const r = await fetch(url, { ...rest, body: form ? new URLSearchParams(form) : rest.body, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new PlatformHttpError(r.status, (await r.text()).slice(0, 600));
  return r.json() as Promise<any>;
}

async function uploadPhoto(pageId: string, token: string, m: PublishInput['media'][number], opts: { published: boolean; caption?: string }) {
  const bytes = await (await fetch(m.url, { signal: AbortSignal.timeout(30000) })).arrayBuffer();
  const fd = new FormData();
  fd.set('source', new Blob([bytes], { type: m.mime }), 'image');
  fd.set('published', String(opts.published));
  if (opts.caption) fd.set('caption', opts.caption);
  const url = new URL(`${base()}/${pageId}/photos`);
  url.searchParams.set('access_token', token);
  const r = await fetch(url, { method: 'POST', body: fd, signal: AbortSignal.timeout(60000) });
  if (!r.ok) throw new PlatformHttpError(r.status, (await r.text()).slice(0, 600));
  return (await r.json()) as { id: string; post_id?: string };
}

export const facebookPageAdapter: PlatformAdapter = {
  id: 'facebook_page',
  rules: { maxChars: 60000, maxImages: 10, mime: ['image/jpeg', 'image/png', 'image/gif'], maxImageBytes: 8_000_000 },

  validate(input) { return commonValidate(this.rules, 'Facebook', input); },

  async publish(input, token) {
    const page = input.accountExternalId;
    if (!page) throw new PlatformHttpError(400, 'missing Facebook Page id');
    let id: string;
    if (input.media.length === 0) {
      id = (await gf(`/${page}/feed`, token, { method: 'POST', form: { message: input.text } })).id;
    } else if (input.media.length === 1) {
      const r = await uploadPhoto(page, token, input.media[0], { published: true, caption: input.text });
      id = r.post_id ?? r.id;
    } else {
      const ids: string[] = [];
      for (const m of input.media) ids.push((await uploadPhoto(page, token, m, { published: false })).id);
      id = (await gf(`/${page}/feed`, token, { method: 'POST', form: {
        message: input.text, attached_media: JSON.stringify(ids.map(media_fbid => ({ media_fbid }))) } })).id;
    }
    return { externalId: id, url: `https://www.facebook.com/${id}` };
  },

  // Reconcile: look at the Page's recent posts for the same text published in the last 24 hours.
  async findExisting(input, token) {
    const page = input.accountExternalId;
    if (!page) return null;
    const j = await gf(`/${page}/feed?fields=id,message,permalink_url,created_time&limit=25`, token);
    const since = Date.now() - 24 * 3600_000;
    const hit = (j.data ?? []).find((p: any) => p.message === input.text && Date.parse(p.created_time) > since);
    return hit ? { externalId: hit.id, url: hit.permalink_url ?? `https://www.facebook.com/${hit.id}` } : null;
  },

  classify(error) {
    if (error instanceof PlatformHttpError) {
      let code = 0; let msg = error.message;
      try { const e = JSON.parse(error.message).error; code = e?.code ?? 0; msg = e?.message ?? msg; } catch { /* not JSON */ }
      if (code === 190 || error.status === 401) return { class: 'AUTH', reason: 'Facebook rejected the Page login. Reconnect Facebook.' };
      if ([4, 17, 32, 613].includes(code) || error.status === 429) return { class: 'RETRYABLE', reason: 'Facebook rate limit hit.', retryAfterSeconds: 600 };
      if ([1, 2].includes(code)) return { class: 'RETRYABLE', reason: 'Facebook had a temporary error.', ambiguous: true };
      if (code === 368 || (code >= 200 && code < 300) || code === 10) return { class: 'BLOCKED', reason: 'Facebook did not allow this post (permission or policy): ' + msg.slice(0, 150) };
      if (code === 100 || error.status === 400) return { class: 'VALIDATION', reason: msg.slice(0, 200) };
      if (error.status >= 500) return { class: 'RETRYABLE', reason: 'Facebook had a server error.', ambiguous: true };
    }
    return { class: 'RETRYABLE', reason: 'Facebook did not respond in time.', ambiguous: true };
  },
  // Page tokens derived from a long-lived user token do not expire, so there is no refresh.
};
