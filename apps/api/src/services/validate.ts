import { prisma } from '../db';
import { getAdapter } from '../adapters/registry';
import { mediaInfoFor, MediaInfo } from './storage';

export interface Draft {
  ownerId: string; body: string; accountIds: string[];
  overrides?: Record<string, string>; mediaPaths: string[]; assetId?: string;
}
export class ValidationError extends Error {
  constructor(public problems: Record<string, string[]>) { super('Draft has problems'); }
}

/** Problems are keyed by account id; "_draft" holds problems not tied to one platform. */
export async function validateDraft(d: Draft) {
  const problems: Record<string, string[]> = {};
  const accounts = await prisma.socialAccount.findMany({
    where: { id: { in: d.accountIds }, ownerId: d.ownerId, status: { not: 'DISCONNECTED' } },
  });
  if (accounts.length !== new Set(d.accountIds).size) throw new ValidationError({ _draft: ['One of the selected accounts was not found.'] });

  const paths = [...d.mediaPaths, ...(d.assetId ? [`asset:${d.assetId}`] : [])];
  const media: MediaInfo[] = [];
  for (const p of paths) {
    try { media.push(await mediaInfoFor(p, d.ownerId)); }
    catch (e) { (problems._draft ??= []).push((e as Error).message); }
  }
  for (const a of accounts) {
    const text = d.overrides?.[a.id] ?? d.body;
    const p = getAdapter(a.platform).validate({
      idempotencyKey: 'validate', text, media: media.map(m => ({ url: '', mime: m.mime, width: m.width, height: m.height, bytes: m.bytes })),
    });
    if (a.status === 'NEEDS_RECONNECT') p.unshift('This account needs to be reconnected before you can post.');
    if (p.length) problems[a.id] = p;
  }
  return { problems, accounts, media };
}
