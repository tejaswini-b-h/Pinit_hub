import { randomUUID } from 'crypto';
import { sniffImage } from './imageSniff';
import { getProtectedCopy } from './assetBridge';
import { supabaseUrl, supabaseServiceKey } from '../env';

const sb = () => supabaseUrl();
const key = () => supabaseServiceKey();
const auth = () => ({ apikey: key(), Authorization: `Bearer ${key()}` });
const BUCKET = 'media';

export const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'video/mp4': 'mp4', 'video/webm': 'webm' };

/** Signed upload slot. The web app uploads with supabase.storage.from('media').uploadToSignedUrl(path, token, file). */
export async function createUpload(ownerId: string, mime: string) {
  const path = `${ownerId}/${randomUUID()}.${EXT[mime]}`;
  const r = await fetch(`${sb()}/storage/v1/object/upload/sign/${BUCKET}/${path}`, { method: 'POST', headers: auth() });
  if (!r.ok) throw new Error(`storage ${r.status}`);
  const j: any = await r.json();
  const token = j.token ?? /token=([^&]+)/.exec(j.url ?? '')?.[1];
  if (!token) throw new Error('storage returned no upload token');
  return { path, token };
}

export interface MediaInfo { storagePath: string; mime: string; width: number; height: number; bytes: number }

/** Download the stored file and identify it from its bytes. */
export async function inspect(path: string): Promise<MediaInfo> {
  const r = await fetch(`${sb()}/storage/v1/object/authenticated/${BUCKET}/${path}`, { headers: auth(), signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error('File not found. Upload it again.');
  const buf = Buffer.from(await r.arrayBuffer());
  const s = sniffImage(buf);
  if (!s) throw new Error('This file is not a supported image or video (JPEG, PNG, GIF, MP4, WebM).');
  return { storagePath: path, mime: s.mime, width: s.width, height: s.height, bytes: buf.length };
}

export async function signedUrl(path: string, seconds = 600): Promise<string> {
  const r = await fetch(`${sb()}/storage/v1/object/sign/${BUCKET}/${path}`, {
    method: 'POST', headers: { ...auth(), 'content-type': 'application/json' }, body: JSON.stringify({ expiresIn: seconds }),
  });
  if (!r.ok) throw new Error(`storage ${r.status}`);
  const j: any = await r.json();
  return `${sb()}/storage/v1${j.signedURL.startsWith('/') ? '' : '/'}${j.signedURL}`;
}

/** Media rows are either files in our bucket or "asset:<id>" (a protected copy served by PinITHUB). */
export async function resolveMediaUrl(path: string, ownerId: string): Promise<string> {
  if (path.startsWith('asset:')) return (await getProtectedCopy(path.slice(6), ownerId)).url;
  // If the media bucket is public in Supabase, use the direct clean public URL (required for Instagram crawler)
  const pubUrl = `${sb()}/storage/v1/object/public/${BUCKET}/${path}`;
  try {
    const head = await fetch(pubUrl, { method: 'HEAD', signal: AbortSignal.timeout(5000) });
    const ct = head.headers.get('content-type') ?? '';
    if (head.ok && (ct.startsWith('image/') || ct.startsWith('video/'))) {
      return pubUrl;
    }
  } catch { /* fallback to signedUrl */ }
  return signedUrl(path);
}

export async function mediaInfoFor(path: string, ownerId: string): Promise<MediaInfo> {
  if (path.startsWith('asset:')) {
    const a = await getProtectedCopy(path.slice(6), ownerId);
    return { storagePath: path, mime: a.mime, width: a.width, height: a.height, bytes: a.bytes };
  }
  if (!path.startsWith(ownerId + '/')) throw new Error('File not found. Upload it again.'); // not this user's file
  return inspect(path);
}