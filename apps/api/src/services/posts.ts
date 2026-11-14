import { randomUUID } from 'crypto';
import { prisma } from '../db';
import { validateDraft, ValidationError, Draft } from './validate';

export { ValidationError };
export interface CreatePostInput extends Draft {
  scheduledAt?: Date;   // UTC
  timezone?: string;    // IANA name, e.g. "Asia/Kolkata"
  idempotencyKey: string;
}

const include = { targets: true } as const;

export async function createPost(i: CreatePostInput) {
  const key = { ownerId_idempotencyKey: { ownerId: i.ownerId, idempotencyKey: i.idempotencyKey } };
  const existing = await prisma.post.findUnique({ where: key, include });
  if (existing) return { post: existing, created: false }; // double click => same post, never a second one

  const { problems, accounts, media } = await validateDraft(i);
  if (Object.keys(problems).length) throw new ValidationError(problems);

  const postId = randomUUID();
  const future = !!i.scheduledAt && i.scheduledAt.getTime() > Date.now() + 5000;
  try {
    // One nested write: Prisma runs the post, its media and its targets in a single transaction (fewer round trips = faster).
    const [post] = await prisma.$transaction([
      prisma.post.create({
        data: {
          id: postId, ownerId: i.ownerId, body: i.body, assetId: i.assetId, scheduledAt: i.scheduledAt, timezone: i.timezone, idempotencyKey: i.idempotencyKey,
          media: { create: media.map(m => ({ storagePath: m.storagePath, mime: m.mime, width: m.width, height: m.height, bytes: m.bytes })) },
          targets: { create: accounts.map((a: any) => ({
            accountId: a.id, bodyOverride: i.overrides?.[a.id], idempotencyKey: `${postId}:${a.id}`,
            status: future ? 'SCHEDULED' as const : 'QUEUED' as const, nextAttemptAt: future ? i.scheduledAt! : new Date(),
          })) },
        },
        include,
      }),
      prisma.auditLog.create({ data: { ownerId: i.ownerId, action: 'create_post', detail: i.idempotencyKey } }),
    ]);
    return { post, created: true };
  } catch (e: any) {
    if (e.code === 'P2002') return { post: await prisma.post.findUniqueOrThrow({ where: key, include }), created: false }; // lost a race
    throw e;
  }
}
