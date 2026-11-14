import dotenv from 'dotenv';
import { PlatformAdapter, PublishInput, PlatformHttpError, commonValidate } from './types';

const cleanVal = (v: string | undefined) => (v ?? '').trim().replace(/^["']+|["']+$/g, '');
const getEnv = (key: string) => {
  let v = process.env[key];
  if (!v || !v.trim()) {
    try {
      dotenv.config({ override: true });
      v = process.env[key];
    } catch { /* ignore */ }
  }
  return cleanVal(v);
};

export const youtubeAdapter: PlatformAdapter = {
  id: 'youtube',
  rules: { maxChars: 5000, maxImages: 1, mime: ['video/mp4', 'video/webm'], maxImageBytes: 100_000_000 },

  validate(input) {
    return commonValidate(this.rules, 'YouTube', input);
  },

  async publish(input, token) {
    if (input.media.length === 0) {
      throw new PlatformHttpError(400, 'YouTube requires a video file to upload.');
    }
    const media = input.media[0];
    if (media.mime && !media.mime.startsWith('video/')) {
      throw new PlatformHttpError(400, `YouTube requires a video file (.mp4 or .webm), but received ${media.mime}.`);
    }

    // Download the video bytes
    const mediaResp = await fetch(media.url, { signal: AbortSignal.timeout(120_000) });
    if (!mediaResp.ok) {
      throw new PlatformHttpError(400, `Failed to download media file from storage (${mediaResp.status}).`);
    }
    const videoBytes = await mediaResp.arrayBuffer();

    const lines = input.text.trim().split('\n');
    const title = (lines[0] || 'New Video').slice(0, 100);
    const description = input.text;

    const metadata = {
      snippet: {
        title,
        description,
        categoryId: '22', // People & Blogs
      },
      status: {
        privacyStatus: 'public',
        selfDeclaredMadeForKids: false,
      },
    };

    const boundary = 'youtube_boundary_' + Date.now().toString(16);
    const metaHeader = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`;
    const mediaHeader = `--${boundary}\r\nContent-Type: ${media.mime || 'video/mp4'}\r\n\r\n`;
    const footer = `\r\n--${boundary}--\r\n`;

    const metaBuf = Buffer.from(metaHeader, 'utf-8');
    const mediaHeaderBuf = Buffer.from(mediaHeader, 'utf-8');
    const footerBuf = Buffer.from(footer, 'utf-8');
    const bodyBuf = Buffer.concat([metaBuf, mediaHeaderBuf, Buffer.from(videoBytes), footerBuf]);

    const url = 'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=multipart&part=snippet,status';
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body: bodyBuf,
      signal: AbortSignal.timeout(180_000),
    });

    if (!r.ok) {
      const errText = await r.text();
      // If public upload is rejected due to Google's unverified app policy, retry as unlisted
      if (errText.includes('upload public videos') || errText.includes('uploadForbidden')) {
        metadata.status.privacyStatus = 'unlisted';
        const fallbackMetaHeader = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`;
        const fallbackBuf = Buffer.concat([Buffer.from(fallbackMetaHeader, 'utf-8'), mediaHeaderBuf, Buffer.from(videoBytes), footerBuf]);
        const retryResp = await fetch(url, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
          body: fallbackBuf,
          signal: AbortSignal.timeout(180_000),
        });
        if (retryResp.ok) {
          const j: any = await retryResp.json();
          return { externalId: j.id, url: `https://www.youtube.com/watch?v=${j.id}` };
        }
      }
      console.error(JSON.stringify({ msg: 'YouTube upload failed', status: r.status, errText }));
      throw new PlatformHttpError(r.status, errText.slice(0, 600));
    }

    const j: any = await r.json();
    const id = j.id;
    return { externalId: id, url: `https://www.youtube.com/watch?v=${id}` };
  },

  async findExisting(input, token) {
    try {
      const lines = input.text.trim().split('\n');
      const title = (lines[0] || 'New Video').slice(0, 100);
      const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&forMine=true&type=video&maxResults=10`;
      const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) });
      if (!r.ok) return null;
      const j: any = await r.json();
      const since = Date.now() - 24 * 3600_000;
      const hit = (j.items ?? []).find((item: any) => item.snippet?.title === title && Date.parse(item.snippet?.publishedAt) > since);
      return hit?.id?.videoId ? { externalId: hit.id.videoId, url: `https://www.youtube.com/watch?v=${hit.id.videoId}` } : null;
    } catch {
      return null;
    }
  },

  classify(error) {
    if (error instanceof PlatformHttpError) {
      let msg = error.message;
      let reason = '';
      try {
        const e = JSON.parse(error.message).error;
        reason = e?.errors?.[0]?.reason ?? '';
        msg = e?.message ?? msg;
      } catch {
        /* not JSON */
      }
      if (error.status === 401 || reason === 'authError') return { class: 'AUTH', reason: 'YouTube rejected the login. Reconnect YouTube.' };
      if (error.status === 403 && (reason === 'quotaExceeded' || reason === 'rateLimitExceeded')) {
        return { class: 'RETRYABLE', reason: 'YouTube daily API quota exceeded.', retryAfterSeconds: 3600 };
      }
      if (error.status === 403) return { class: 'BLOCKED', reason: `YouTube permission or policy block: ${msg.slice(0, 150)}` };
      if (error.status === 400) return { class: 'VALIDATION', reason: msg.slice(0, 200) };
      if (error.status >= 500) return { class: 'RETRYABLE', reason: 'YouTube had a temporary server error.', ambiguous: true };
    }
    return { class: 'RETRYABLE', reason: 'YouTube did not respond in time.', ambiguous: true };
  },

  async refresh(refreshToken: string) {
    const clientId = getEnv('YOUTUBE_CLIENT_ID') || getEnv('GOOGLE_CLIENT_ID');
    const clientSecret = getEnv('YOUTUBE_CLIENT_SECRET') || getEnv('GOOGLE_CLIENT_SECRET');
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) throw new Error(`YouTube token refresh failed (${r.status})`);
    const j: any = await r.json();
    return {
      accessToken: j.access_token,
      refreshToken: j.refresh_token, // Google sometimes returns a new one
      expiresAt: new Date(Date.now() + (j.expires_in ?? 3600) * 1000),
    };
  },
};
