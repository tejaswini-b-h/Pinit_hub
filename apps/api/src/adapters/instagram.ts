import { PlatformAdapter, PublishInput, PlatformHttpError, commonValidate } from './types';

const base = () => `https://graph.facebook.com/${process.env.GRAPH_VERSION ?? 'v26.0'}`;

async function gf(path: string, token: string, init: RequestInit & { form?: Record<string, string> } = {}) {
  const url = new URL(base() + path);
  url.searchParams.set('access_token', token);
  const { form, ...rest } = init;
  const r = await fetch(url, { ...rest, body: form ? new URLSearchParams(form) : rest.body, signal: AbortSignal.timeout(30000) });
  if (!r.ok) {
    const errorBody = await r.text();
    console.error(JSON.stringify({ msg: 'Instagram API error', path, status: r.status, error: errorBody }));
    throw new PlatformHttpError(r.status, errorBody.slice(0, 600));
  }
  return r.json() as Promise<any>;
}

async function waitForContainer(containerId: string, token: string, maxWaitMs = 60000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const status = await gf(`/${containerId}?fields=status_code,status`, token);
    if (status.status_code === 'FINISHED') return;
    if (status.status_code === 'ERROR' || status.status_code === 'EXPIRED') {
      throw new PlatformHttpError(400, `Instagram media processing failed: ${status.status || status.status_code}`);
    }
    // Wait 2 seconds before checking again
    await new Promise(r => setTimeout(r, 2000));
  }
}

export const instagramAdapter: PlatformAdapter = {
  id: 'instagram',
  rules: { maxChars: 2200, maxImages: 10, mime: ['image/jpeg', 'image/png'], maxImageBytes: 8_000_000 },

  validate(input) {
    const p = commonValidate(this.rules, 'Instagram', input);
    for (const m of input.media) {
      if (m.width > 0 && m.height > 0) {
        const ratio = m.width / m.height;
        if (ratio < 0.8) {
          p.push(`Instagram image is too tall (aspect ratio ${ratio.toFixed(2)}). Instagram requires an aspect ratio between 4:5 (0.80) and 1.91:1. Please crop the image.`);
        } else if (ratio > 1.91) {
          p.push(`Instagram image is too wide (aspect ratio ${ratio.toFixed(2)}). Instagram requires an aspect ratio between 4:5 (0.80) and 1.91:1. Please crop the image.`);
        }
      }
    }
    return p;
  },

  async publish(input, token) {
    const igUserId = input.accountExternalId;
    if (!igUserId) throw new PlatformHttpError(400, 'missing Instagram account id');
    if (input.media.length === 0) throw new PlatformHttpError(400, 'Instagram requires at least one image');

    console.log(JSON.stringify({ msg: 'Publishing to Instagram', igUserId, imageUrl: input.media[0]?.url }));
    let creationId: string;
    if (input.media.length === 1) {
      // Single photo post
      const container = await gf(`/${igUserId}/media`, token, {
        method: 'POST',
        form: { image_url: input.media[0].url, caption: input.text },
      });
      creationId = container.id;
      await waitForContainer(creationId, token);
    } else {
      // Carousel post (up to 10 photos)
      const itemIds: string[] = [];
      for (const m of input.media) {
        const item = await gf(`/${igUserId}/media`, token, {
          method: 'POST',
          form: { image_url: m.url, is_carousel_item: 'true' },
        });
        itemIds.push(item.id);
        await waitForContainer(item.id, token);
      }
      const carousel = await gf(`/${igUserId}/media`, token, {
        method: 'POST',
        form: {
          media_type: 'CAROUSEL',
          caption: input.text,
          children: itemIds.join(','),
        },
      });
      creationId = carousel.id;
      await waitForContainer(creationId, token);
    }

    // Publish the container
    const published = await gf(`/${igUserId}/media_publish`, token, {
      method: 'POST',
      form: { creation_id: creationId },
    });

    const mediaId = published.id;
    let url = `https://www.instagram.com/`;
    try {
      const details = await gf(`/${mediaId}?fields=permalink`, token);
      if (details.permalink) url = details.permalink;
    } catch {
      // permalink lookup failure is non-fatal
    }

    return { externalId: mediaId, url };
  },

  // Reconcile: look at recent media for the same caption within the last 24 hours.
  async findExisting(input, token) {
    const igUserId = input.accountExternalId;
    if (!igUserId) return null;
    try {
      const j = await gf(`/${igUserId}/media?fields=id,caption,permalink,timestamp&limit=25`, token);
      const since = Date.now() - 24 * 3600_000;
      const hit = (j.data ?? []).find((p: any) => p.caption === input.text && Date.parse(p.timestamp) > since);
      return hit ? { externalId: hit.id, url: hit.permalink ?? `https://www.instagram.com/` } : null;
    } catch {
      return null;
    }
  },

  classify(error) {
    if (error instanceof PlatformHttpError) {
      let code = 0;
      let msg = error.message;
      try {
        const e = JSON.parse(error.message).error;
        code = e?.code ?? 0;
        msg = e?.message ?? msg;
      } catch {
        /* not JSON */
      }
      if (code === 190 || error.status === 401) return { class: 'AUTH', reason: 'Instagram/Facebook rejected the login. Reconnect.' };
      if ([4, 17, 32, 613].includes(code) || error.status === 429) return { class: 'RETRYABLE', reason: 'Instagram rate limit hit.', retryAfterSeconds: 600 };
      if ([1, 2].includes(code)) return { class: 'RETRYABLE', reason: 'Instagram had a temporary error.', ambiguous: true };
      if (code === 368 || (code >= 200 && code < 300) || code === 10) return { class: 'BLOCKED', reason: 'Instagram did not allow this post: ' + msg.slice(0, 150) };
      if (code === 100 || error.status === 400) return { class: 'VALIDATION', reason: msg.slice(0, 200) };
      if (error.status >= 500) return { class: 'RETRYABLE', reason: 'Instagram had a server error.', ambiguous: true };
    }
    return { class: 'RETRYABLE', reason: 'Instagram did not respond in time.', ambiguous: true };
  },
};
