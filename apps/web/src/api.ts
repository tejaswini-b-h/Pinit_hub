import { useEffect, useRef } from 'react';
import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(import.meta.env.VITE_SUPABASE_URL ?? '', import.meta.env.VITE_SUPABASE_ANON_KEY ?? '');
export const API = (import.meta.env.VITE_API_URL ?? 'http://localhost:4000') + '/v1/publish';

export class ApiError extends Error { constructor(public status: number, public body: any) { super(body?.error ?? 'Request failed'); } }

export async function api<T = any>(path: string, init: RequestInit & { json?: unknown; key?: string } = {}): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const headers: Record<string, string> = { Authorization: `Bearer ${data.session?.access_token ?? ''}` };
  if (init.json !== undefined) headers['content-type'] = 'application/json';
  if (init.key) headers['Idempotency-Key'] = init.key;
  const r = await fetch(API + path, { ...init, headers: { ...headers, ...(init.headers as object) }, body: init.json !== undefined ? JSON.stringify(init.json) : init.body });
  if (r.status === 204) return undefined as T;
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(r.status, body);
  return body as T;
}

export interface Account { id: string; platform: string; displayName: string; status: string; expiresAt: string | null }
export interface Rules { maxChars: number; maxImages: number; mime: string[]; maxImageBytes: number }
export interface Asset { id: string; name: string; url: string; mime: string; width: number; height: number; bytes: number }
export interface Target { id: string; status: string; attemptCount: number; nextAttemptAt: string; externalUrl: string | null;
  lastErrorClass: string | null; lastError: string | null; account: { id: string; platform: string; displayName: string } }

export interface UserProfile {
  id: string;
  email: string;
  displayName: string;
  avatarUrl?: string | null;
}

export interface PostMediaItem {
  id: string;
  storagePath?: string;
  mime?: string;
  width?: number;
  height?: number;
  url?: string;
}

export interface PlatformEngagementStat {
  platform: string;
  targetId?: string;
  accountDisplayName: string;
  externalUrl?: string;
  likesCount: number;
  commentsCount: number;
  sharesCount: number;
  viewsCount: number;
  lastSyncedAt?: string;
}

export interface SocialMediaComment {
  id: string;
  externalId?: string;
  platform: string;
  targetAccount?: string;
  externalUrl?: string;
  authorName: string;
  authorHandle?: string;
  authorAvatarUrl?: string;
  authorProfileUrl?: string;
  content: string;
  likeCount?: number;
  publishedAt: string;
}

export interface SocialMediaLike {
  id: string;
  externalId?: string;
  platform: string;
  targetAccount?: string;
  externalUrl?: string;
  authorName: string;
  authorHandle?: string;
  authorAvatarUrl?: string;
  authorProfileUrl?: string;
  likedAt: string;
}

export interface SocialMediaShare {
  id: string;
  externalId?: string;
  platform: string;
  targetAccount?: string;
  externalUrl?: string;
  authorName: string;
  authorHandle?: string;
  authorAvatarUrl?: string;
  authorProfileUrl?: string;
  note?: string;
  sharedAt: string;
}

export interface PostSocialEngagementData {
  totals: {
    likesCount: number;
    commentsCount: number;
    sharesCount: number;
    viewsCount: number;
  };
  lastSyncedAt: string | null;
  byPlatform: PlatformEngagementStat[];
  comments: SocialMediaComment[];
  likes: SocialMediaLike[];
  shares: SocialMediaShare[];
}

export interface PostRow {
  id: string;
  ownerId?: string;
  body: string;
  assetId?: string | null;
  createdAt: string;
  scheduledAt: string | null;
  timezone: string | null;
  author?: UserProfile;
  targets: Target[];
  media?: PostMediaItem[];
  likesCount?: number;
  commentsCount?: number;
  sharesCount?: number;
  viewsCount?: number;
  lastSyncedAt?: string | null;
  byPlatform?: PlatformEngagementStat[];
}

export interface LikeDetail {
  id: string;
  postId?: string;
  userId?: string;
  createdAt: string;
  user: UserProfile;
}

export interface CommentDetail {
  id: string;
  postId?: string;
  userId?: string;
  content: string;
  createdAt: string;
  user: UserProfile;
}

export interface ShareDetail {
  id: string;
  postId?: string;
  sharedByUserId?: string;
  sharedToUserId?: string;
  note?: string | null;
  createdAt: string;
  sharedBy: UserProfile;
  sharedTo: UserProfile;
}

export interface HistoryRow { platform: string; url: string; publishedAt: string; deliveredAt: string | null }

export const PLATFORM_LABEL: Record<string, string> = { linkedin: 'LinkedIn', facebook_page: 'Facebook Page', instagram: 'Instagram', youtube: 'YouTube', bluesky: 'Bluesky', telegram: 'Telegram', mock: 'Mock platform', x: 'X' };

/** Live updates: server-sent events from /events; if the stream cannot be opened or drops, poll every 5 seconds. */
export function useLive(onChange: () => void) {
  const cb = useRef(onChange); cb.current = onChange;
  useEffect(() => {
    let stop = false; let poll: ReturnType<typeof setInterval> | undefined; const ctrl = new AbortController();
    const fallback = () => { if (!poll && !stop) poll = setInterval(() => cb.current(), 5000); };
    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const r = await fetch(API + '/events', { headers: { Authorization: `Bearer ${data.session?.access_token ?? ''}` }, signal: ctrl.signal });
        if (!r.ok || !r.body) throw new Error('no stream');
        const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = '';
        while (!stop) {
          const { done, value } = await reader.read(); if (done) break;
          buf += dec.decode(value, { stream: true });
          const parts = buf.split('\n\n'); buf = parts.pop() ?? '';
          if (parts.some(p => p.startsWith('event: target'))) cb.current();
        }
      } catch { /* fall through to polling */ }
      fallback();
    })();
    return () => { stop = true; ctrl.abort(); if (poll) clearInterval(poll); };
  }, []);
}
