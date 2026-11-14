export type ErrorClass = 'RETRYABLE' | 'AUTH' | 'VALIDATION' | 'BLOCKED';

export interface PublishInput {
  idempotencyKey: string; // post id + account id
  text: string;
  media: { url: string; mime: string; width: number; height: number; bytes: number }[];
  accountExternalId?: string; // LinkedIn member id, Facebook Page id, ...
}

export interface Classified {
  class: ErrorClass;
  reason: string;
  retryAfterSeconds?: number;
  /** true when we do not know whether the platform accepted the post (timeout, 5xx) */
  ambiguous?: boolean;
}

export interface PlatformAdapter {
  id: 'linkedin' | 'facebook_page' | 'instagram' | 'threads' | 'bluesky' | 'telegram' | 'x' | 'mock' | 'youtube';
  rules: { maxChars: number; maxImages: number; mime: string[]; maxImageBytes: number };
  /** false when the platform cannot tell us whether a post exists (no reconcile possible). Default true. */
  canLookup?: boolean;
  validate(input: PublishInput): string[];
  publish(input: PublishInput, token: string): Promise<{ externalId: string; url: string }>;
  findExisting(input: PublishInput, token: string): Promise<{ externalId: string; url: string } | null>;
  classify(error: unknown): Classified;
  refresh?(refreshToken: string): Promise<{ accessToken: string; refreshToken?: string; expiresAt: Date }>;
}

/** Thrown by adapters so classify() can read the HTTP status. */
export class PlatformHttpError extends Error {
  constructor(public status: number, message: string, public retryAfter?: number) { super(message); }
}

/** Shared draft checks used by every adapter's validate(). */
export function commonValidate(a: PlatformAdapter['rules'], name: string, input: PublishInput): string[] {
  const p: string[] = [];
  const n = Array.from(input.text).length;
  if (n === 0 && input.media.length === 0) p.push(`${name} needs some text or an image.`);
  if (n > a.maxChars) p.push(`${name} allows ${a.maxChars} characters; your text has ${n}. Shorten it by ${n - a.maxChars}.`);
  if (input.media.length > a.maxImages) p.push(`${name} allows ${a.maxImages} image(s); you attached ${input.media.length}. Remove ${input.media.length - a.maxImages}.`);
  for (const m of input.media) {
    if (!a.mime.includes(m.mime)) p.push(`${name} does not accept ${m.mime}. Use ${a.mime.map(x => x.split('/')[1].toUpperCase()).join(' or ')}.`);
    if (m.bytes > a.maxImageBytes) p.push(`An image is ${(m.bytes / 1e6).toFixed(1)} MB; ${name} allows ${(a.maxImageBytes / 1e6).toFixed(0)} MB. Compress it.`);
  }
  return p;
}
