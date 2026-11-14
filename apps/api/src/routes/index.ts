import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { uid, currentUser } from '../auth';
import { encrypt } from '../services/crypto';
import { startOAuth, finishOAuth } from '../services/oauth';
import { verifyCredentials } from '../services/credentials';
import { createUpload, EXT, resolveMediaUrl } from '../services/storage';
import { listAssets } from '../services/assetBridge';
import { createPost, ValidationError } from '../services/posts';
import { validateDraft } from '../services/validate';
import { allAdapters, getAdapter } from '../adapters/registry';
import { MAX_ATTEMPTS } from '../worker/backoff';
import { pickBestHour } from '../services/bestTime';
import { syncPostEngagement, getPostSocialEngagement } from '../services/socialEngagement';

const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);

const validTz = (tz: string) => { try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; } };
const draftSchema = z.object({
  body: z.string().max(10000),
  accountIds: z.array(z.string().uuid()).min(1).max(10),
  overrides: z.record(z.string().uuid(), z.string().max(10000)).optional(),
  mediaPaths: z.array(z.string().max(300)).max(10).default([]),
  assetId: z.string().max(100).optional(),
});
const createSchema = draftSchema.extend({
  scheduledAt: z.string().datetime().optional(),
  timezone: z.string().refine(validTz, 'Unknown time zone').optional(),
});

/** Unauthenticated: the platform redirects the browser here. The owner comes from the stored state, never from the URL. */
export const callbackRouter = Router();
callbackRouter.get('/accounts/:platform/callback', async (req, res) => {
  const app = process.env.APP_URL ?? '';
  try {
    if (req.query.error) {
      const desc = req.query.error_description ? `${req.query.error}: ${req.query.error_description}` : String(req.query.error);
      throw new Error(desc);
    }
    await finishOAuth(String(req.params.platform), String(req.query.code ?? ''), String(req.query.state ?? ''));
    res.redirect(`${app}/#accounts?connected=1`);
  } catch (e) {
    const errorMsg = (e as Error).message || 'Could not connect. Please try again.';
    console.error(JSON.stringify({ msg: 'oauth callback failed', error: errorMsg }));
    res.redirect(`${app}/#accounts?error=${encodeURIComponent(errorMsg)}`);
  }
});

export const router = Router();

// ---- platforms & accounts
router.get('/platforms', (_req, res) => res.json(allAdapters().map(a => ({ id: a.id, rules: a.rules }))));

router.get('/accounts', wrap(async (_req, res) => {
  const rows = await prisma.socialAccount.findMany({
    where: { ownerId: uid(res), status: { not: 'DISCONNECTED' } },
    select: { id: true, platform: true, displayName: true, status: true, expiresAt: true }, // never token columns
    orderBy: { displayName: 'asc' },
  });
  res.json(rows);
}));

router.get('/accounts/:platform/connect', wrap(async (req, res) => res.json({ url: await startOAuth(uid(res), String(req.params.platform)) })));

router.post('/accounts/credentials', wrap(async (req, res) => {
  const b = z.object({ platform: z.enum(['bluesky', 'telegram']), a: z.string().min(3).max(300), b: z.string().min(3).max(300) }).parse(req.body);
  let v;
  try { v = await verifyCredentials(b.platform, b.a, b.b); } catch (e) { return res.status(422).json({ error: (e as Error).message }); }
  const data = { displayName: v.displayName, accessTokenEnc: encrypt(v.token), refreshTokenEnc: null, expiresAt: null, status: 'CONNECTED' };
  await prisma.socialAccount.upsert({
    where: { ownerId_platform_externalId: { ownerId: uid(res), platform: b.platform, externalId: v.externalId } },
    create: { ownerId: uid(res), platform: b.platform, externalId: v.externalId, ...data }, update: data });
  await prisma.auditLog.create({ data: { ownerId: uid(res), action: 'connect', detail: `${b.platform} ${v.displayName}` } });
  res.status(201).json({ ok: true });
}));

router.delete('/accounts/:id', wrap(async (req, res) => {
  const a = await prisma.socialAccount.findFirst({ where: { id: String(req.params.id), ownerId: uid(res) } });
  if (!a) return res.status(404).json({ error: 'Not found' });
  await prisma.$transaction([
    // tokens are deleted from the database; the row stays only so past posts keep their history
    prisma.socialAccount.update({ where: { id: a.id }, data: { status: 'DISCONNECTED', accessTokenEnc: '', refreshTokenEnc: null } }),
    prisma.postTarget.updateMany({ where: { accountId: a.id, status: { in: ['SCHEDULED', 'QUEUED', 'RETRYING', 'NEEDS_RECONNECT', 'BLOCKED'] } },
      data: { status: 'CANCELLED', lastError: 'Account was disconnected.' } }),
    prisma.auditLog.create({ data: { ownerId: uid(res), action: 'disconnect', detail: `${a.platform} ${a.displayName}` } }),
  ]);
  res.status(204).end();
}));

// ---- media & assets
router.post('/media/upload-url', wrap(async (req, res) => {
  const b = z.object({ mime: z.string().refine(m => m in EXT, 'Use JPEG, PNG, GIF, MP4 or WebM'), bytes: z.number().int().positive().max(100_000_000) }).parse(req.body);
  res.status(201).json(await createUpload(uid(res), b.mime));
}));
router.get('/assets', wrap(async (_req, res) => res.json(await listAssets(uid(res)))));

// ---- validate & posts
router.post('/validate', wrap(async (req, res) => {
  const d = draftSchema.parse(req.body);
  try { res.json({ problems: (await validateDraft({ ownerId: uid(res), ...d })).problems }); }
  catch (e) { if (e instanceof ValidationError) return res.json({ problems: e.problems }); throw e; }
}));

router.post('/posts', wrap(async (req, res) => {
  const key = req.header('idempotency-key');
  if (!key || key.length > 100) return res.status(400).json({ error: 'Idempotency-Key header is required' });
  const d = createSchema.parse(req.body);
  const out = await createPost({ ownerId: uid(res), ...d, scheduledAt: d.scheduledAt ? new Date(d.scheduledAt) : undefined, idempotencyKey: key });
  res.status(out.created ? 201 : 200).json({ postId: out.post.id, targets: out.post.targets });
}));

const targetSelect = { id: true, status: true, attemptCount: true, nextAttemptAt: true, externalUrl: true, lastErrorClass: true, lastError: true,
  account: { select: { id: true, platform: true, displayName: true } } } as const;

async function enrichPosts(posts: any[], currentUserId: string) {
  if (posts.length === 0) return [];
  const postIds = posts.map(p => p.id);

  // Fetch social media engagements gathered from platforms
  const socialMap = new Map<string, { likesCount: number; commentsCount: number; sharesCount: number; viewsCount: number; lastSyncedAt: Date | null; byPlatform: any[] }>();
  try {
    const engagements = await prisma.socialMediaEngagement.findMany({
      where: { postId: { in: postIds } },
      include: {
        target: {
          select: {
            id: true,
            externalId: true,
            externalUrl: true,
            account: { select: { platform: true, displayName: true } },
          },
        },
      },
    });

    for (const e of engagements) {
      const cur = socialMap.get(e.postId) || {
        likesCount: 0,
        commentsCount: 0,
        sharesCount: 0,
        viewsCount: 0,
        lastSyncedAt: null,
        byPlatform: [],
      };
      cur.likesCount += e.likesCount;
      cur.commentsCount += e.commentsCount;
      cur.sharesCount += e.sharesCount;
      cur.viewsCount += e.viewsCount;
      if (!cur.lastSyncedAt || e.lastSyncedAt > cur.lastSyncedAt) {
        cur.lastSyncedAt = e.lastSyncedAt;
      }
      cur.byPlatform.push({
        platform: e.platform,
        accountDisplayName: e.target?.account?.displayName || e.platform,
        externalUrl: e.target?.externalUrl,
        likesCount: e.likesCount,
        commentsCount: e.commentsCount,
        sharesCount: e.sharesCount,
        viewsCount: e.viewsCount,
      });
      socialMap.set(e.postId, cur);
    }
  } catch {}

  return await Promise.all(posts.map(async p => {
    const mediaWithUrls = await Promise.all((p.media ?? []).map(async (m: any) => {
      let url = '';
      if (m.storagePath) {
        try { url = await resolveMediaUrl(m.storagePath, p.ownerId); } catch {}
      }
      return { ...m, url };
    }));

    const social = socialMap.get(p.id) || {
      likesCount: 0,
      commentsCount: 0,
      sharesCount: 0,
      viewsCount: 0,
      lastSyncedAt: null,
      byPlatform: [],
    };

    return {
      id: p.id,
      ownerId: p.ownerId,
      body: p.body,
      assetId: p.assetId,
      scheduledAt: p.scheduledAt,
      timezone: p.timezone,
      createdAt: p.createdAt,
      author: p.author ?? { id: p.ownerId, email: '', displayName: 'User' },
      targets: p.targets ?? [],
      media: mediaWithUrls,
      likesCount: social.likesCount,
      commentsCount: social.commentsCount,
      sharesCount: social.sharesCount,
      viewsCount: social.viewsCount,
      lastSyncedAt: social.lastSyncedAt,
      byPlatform: social.byPlatform,
    };
  }));
}

// ---- Social Media Platform Engagement (Live Gathering & Display)
router.get('/posts/:id/social-engagement', wrap(async (req, res) => {
  const postId = String(req.params.id);
  const post = await prisma.post.findFirst({
    where: { id: postId, ownerId: uid(res) },
  });
  if (!post) return res.status(404).json({ error: 'Post not found' });

  const existingCount = await prisma.socialMediaEngagement.count({ where: { postId } });
  if (req.query.sync === 'true' || existingCount === 0) {
    await syncPostEngagement(postId);
  }

  const engagement = await getPostSocialEngagement(postId);
  res.json(engagement);
}));

router.post('/posts/:id/sync-social-engagement', wrap(async (req, res) => {
  const postId = String(req.params.id);
  const post = await prisma.post.findFirst({
    where: { id: postId, ownerId: uid(res) },
  });
  if (!post) return res.status(404).json({ error: 'Post not found' });

  await syncPostEngagement(postId);
  const engagement = await getPostSocialEngagement(postId);
  res.json(engagement);
}));

// ---- Registered Users Directory (for sharing)
router.get('/users', wrap(async (_req, res) => {
  const users = await prisma.userProfile.findMany({
    select: { id: true, email: true, displayName: true, avatarUrl: true },
    orderBy: { displayName: 'asc' },
    take: 100,
  });
  res.json(users);
}));

// ---- Community Feed (posts uploaded across registered accounts)
router.get('/posts/feed', wrap(async (req, res) => {
  const q = z.object({
    take: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.string().uuid().optional(),
  }).parse(req.query);

  const posts = await prisma.post.findMany({
    take: q.take,
    ...(q.cursor ? { skip: 1, cursor: { id: q.cursor } } : {}),
    include: {
      author: { select: { id: true, email: true, displayName: true, avatarUrl: true } },
      targets: { select: targetSelect },
      media: true,
      _count: { select: { likes: true, comments: true, shares: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  const enriched = await enrichPosts(posts, uid(res));
  res.json(enriched);
}));

router.get('/posts', wrap(async (req, res) => {
  const q = z.object({ from: z.string().datetime().optional(), to: z.string().datetime().optional(), status: z.string().optional(),
    scheduledFrom: z.string().datetime().optional(), scheduledTo: z.string().datetime().optional() }).parse(req.query);
  const posts = await prisma.post.findMany({
    where: { ownerId: uid(res),
      ...(q.from || q.to ? { createdAt: { gte: q.from ? new Date(q.from) : undefined, lte: q.to ? new Date(q.to) : undefined } } : {}),
      ...(q.scheduledFrom || q.scheduledTo ? { scheduledAt: { gte: q.scheduledFrom ? new Date(q.scheduledFrom) : undefined, lte: q.scheduledTo ? new Date(q.scheduledTo) : undefined } } : {}),
      ...(q.status ? { targets: { some: { status: q.status as any } } } : {}) },
    include: {
      author: { select: { id: true, email: true, displayName: true, avatarUrl: true } },
      targets: { select: targetSelect },
      media: true,
      _count: { select: { likes: true, comments: true, shares: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  const enriched = await enrichPosts(posts, uid(res));
  res.json(enriched);
}));

router.get('/posts/:id', wrap(async (req, res) => {
  const p = await prisma.post.findFirst({
    where: { id: String(req.params.id) },
    include: {
      author: { select: { id: true, email: true, displayName: true, avatarUrl: true } },
      targets: { select: { ...targetSelect, attempts: { orderBy: { startedAt: 'asc' } } } },
      media: true,
      _count: { select: { likes: true, comments: true, shares: true } },
    },
  });
  if (!p) return res.status(404).json({ error: 'Not found' });
  const [enriched] = await enrichPosts([p], uid(res));
  res.json({ ...enriched, attempts: p.targets.flatMap(t => (t as any).attempts ?? []) });
}));

// ---- Social Media Engagement Tracking: Likes
router.post('/posts/:id/like', wrap(async (req, res) => {
  const postId = String(req.params.id);
  const userId = uid(res);
  const post = await prisma.post.findUnique({ where: { id: postId } });
  if (!post) return res.status(404).json({ error: 'Post not found' });

  const existing = await prisma.postLike.findUnique({
    where: { postId_userId: { postId, userId } },
  });

  let liked = false;
  if (existing) {
    await prisma.postLike.delete({ where: { id: existing.id } });
    liked = false;
  } else {
    await prisma.postLike.create({
      data: { postId, userId },
    });
    liked = true;
  }

  const likesCount = await prisma.postLike.count({ where: { postId } });
  res.json({ liked, likesCount });
}));

router.get('/posts/:id/likes', wrap(async (req, res) => {
  const postId = String(req.params.id);
  const likes = await prisma.postLike.findMany({
    where: { postId },
    include: {
      user: { select: { id: true, email: true, displayName: true, avatarUrl: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
  res.json(likes);
}));

// ---- Social Media Engagement Tracking: Comments
router.post('/posts/:id/comments', wrap(async (req, res) => {
  const postId = String(req.params.id);
  const b = z.object({ content: z.string().min(1, 'Comment cannot be empty').max(2000, 'Comment is too long') }).parse(req.body);
  const post = await prisma.post.findUnique({ where: { id: postId } });
  if (!post) return res.status(404).json({ error: 'Post not found' });

  const comment = await prisma.postComment.create({
    data: {
      postId,
      userId: uid(res),
      content: b.content.trim(),
    },
    include: {
      user: { select: { id: true, email: true, displayName: true, avatarUrl: true } },
    },
  });

  const commentsCount = await prisma.postComment.count({ where: { postId } });
  res.status(201).json({ comment, commentsCount });
}));

router.get('/posts/:id/comments', wrap(async (req, res) => {
  const postId = String(req.params.id);
  const comments = await prisma.postComment.findMany({
    where: { postId },
    include: {
      user: { select: { id: true, email: true, displayName: true, avatarUrl: true } },
    },
    orderBy: { createdAt: 'asc' },
  });
  res.json(comments);
}));

// ---- Social Media Engagement Tracking: Shares
router.post('/posts/:id/shares', wrap(async (req, res) => {
  const postId = String(req.params.id);
  const b = z.object({
    sharedToUserId: z.string().min(1, 'Recipient user is required'),
    note: z.string().max(1000).optional(),
  }).parse(req.body);

  const post = await prisma.post.findUnique({ where: { id: postId } });
  if (!post) return res.status(404).json({ error: 'Post not found' });

  const recipient = await prisma.userProfile.findUnique({ where: { id: b.sharedToUserId } });
  if (!recipient) {
    return res.status(404).json({ error: 'Recipient account not found' });
  }

  const share = await prisma.postShare.create({
    data: {
      postId,
      sharedByUserId: uid(res),
      sharedToUserId: b.sharedToUserId,
      note: b.note?.trim() || null,
    },
    include: {
      sharedBy: { select: { id: true, email: true, displayName: true, avatarUrl: true } },
      sharedTo: { select: { id: true, email: true, displayName: true, avatarUrl: true } },
    },
  });

  const sharesCount = await prisma.postShare.count({ where: { postId } });
  res.status(201).json({ share, sharesCount });
}));

router.get('/posts/:id/shares', wrap(async (req, res) => {
  const postId = String(req.params.id);
  const shares = await prisma.postShare.findMany({
    where: { postId },
    include: {
      sharedBy: { select: { id: true, email: true, displayName: true, avatarUrl: true } },
      sharedTo: { select: { id: true, email: true, displayName: true, avatarUrl: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
  res.json(shares);
}));

router.patch('/posts/:id', wrap(async (req, res) => {
  const b = z.object({ body: z.string().max(10000).optional(), scheduledAt: z.string().datetime().optional(),
    timezone: z.string().refine(validTz).optional() }).parse(req.body);
  const p = await prisma.post.findFirst({ where: { id: String(req.params.id), ownerId: uid(res) }, include: { targets: true } });
  if (!p) return res.status(404).json({ error: 'Not found' });
  const active = p.targets.filter((t: any) => t.status !== 'CANCELLED');
  const when = b.scheduledAt ? new Date(b.scheduledAt) : undefined;
  if (when && when.getTime() < Date.now() + 5000) return res.status(422).json({ error: 'Pick a time in the future' });
  try {
    await prisma.$transaction(async (tx: any) => {
      // The guarded update is the lock: if any target was already picked up, the counts differ and we roll back.
      const r = await tx.postTarget.updateMany({ where: { postId: p.id, status: 'SCHEDULED' }, data: when ? { nextAttemptAt: when } : { updatedAt: new Date() } });
      if (r.count !== active.length) throw new Error('CONFLICT');
      await tx.post.update({ where: { id: p.id }, data: { body: b.body, scheduledAt: when, timezone: b.timezone } });
    });
  } catch (e) { if ((e as Error).message === 'CONFLICT') return res.status(409).json({ error: 'This post is already being published.' }); throw e; }
  res.json({ ok: true });
}));

router.delete('/posts/:id', wrap(async (req, res) => {
  const p = await prisma.post.findFirst({ where: { id: String(req.params.id), ownerId: uid(res) } });
  if (!p) return res.status(404).json({ error: 'Not found' });
  await prisma.postTarget.updateMany({ where: { postId: p.id, status: { in: ['SCHEDULED', 'QUEUED', 'RETRYING', 'NEEDS_RECONNECT', 'BLOCKED', 'FAILED'] } },
    data: { status: 'CANCELLED', lastError: 'Cancelled by you.' } });
  await prisma.auditLog.create({ data: { ownerId: uid(res), action: 'delete', detail: p.id } });
  res.status(204).end();
}));

router.post('/targets/:id/retry', wrap(async (req, res) => {
  const t = await prisma.postTarget.findFirst({ where: { id: String(req.params.id), post: { ownerId: uid(res) } }, include: { account: true, post: true } });
  if (!t) return res.status(404).json({ error: 'Not found' });
  if (!['FAILED', 'NEEDS_RECONNECT', 'BLOCKED'].includes(t.status)) return res.status(409).json({ error: 'Nothing to retry' });
  if (t.account.status !== 'CONNECTED') return res.status(409).json({ error: 'Reconnect this account first' });
  const text = z.object({ text: z.string().max(10000).optional() }).parse(req.body ?? {}).text;
  if (text !== undefined) {
    const p = getAdapter(t.account.platform).validate({ idempotencyKey: 'v', text, media: [] });
    if (p.length) return res.status(422).json({ problems: { [t.accountId]: p } });
  }
  const r = await prisma.postTarget.updateMany({ where: { id: t.id, status: t.status },
    data: { status: 'QUEUED', nextAttemptAt: new Date(), bodyOverride: text ?? undefined,
            attemptCount: Math.max(1, Math.min(t.attemptCount, MAX_ATTEMPTS - 2)) } }); // keep >0 so the worker reconciles first
  if (r.count !== 1) return res.status(409).json({ error: 'Already changed' });
  await prisma.auditLog.create({ data: { ownerId: uid(res), action: 'retry', detail: t.id } });
  res.status(202).json({ ok: true });
}));

router.get('/events', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
  const owner = uid(res); let since = new Date(Date.now() - 10_000);
  const t = setInterval(async () => {
    try {
      const rows = await prisma.postTarget.findMany({ where: { post: { ownerId: owner }, updatedAt: { gt: since } },
        select: { id: true, postId: true, status: true, attemptCount: true, nextAttemptAt: true, lastError: true, externalUrl: true, updatedAt: true } });
      if (rows.length) { since = rows.reduce((m: Date, r: any) => (r.updatedAt > m ? r.updatedAt : m), since); res.write(`event: target\ndata: ${JSON.stringify(rows)}\n\n`); }
      else res.write(': ping\n\n');
    } catch { /* keep the stream open; the next tick retries */ }
  }, 2000);
  req.on('close', () => clearInterval(t));
});

router.get('/stats', wrap(async (req, res) => {
  const days = z.coerce.number().int().min(1).max(365).default(7).parse(req.query.days);
  const since = new Date(Date.now() - days * 86400_000);
  const rows = await prisma.postTarget.groupBy({ by: ['status'], _count: { _all: true },
    where: { post: { ownerId: uid(res) }, OR: [{ updatedAt: { gte: since } }, { status: 'SCHEDULED' }] } });
  const out: Record<string, number> = { PUBLISHED: 0, SCHEDULED: 0, RETRYING: 0, FAILED: 0, NEEDS_RECONNECT: 0, BLOCKED: 0, QUEUED: 0, PUBLISHING: 0 };
  for (const r of rows as any[]) out[r.status] = r._count._all;
  res.json({ days, ...out });
}));

router.get('/assets/:id/history', wrap(async (req, res) => {
  const rows = await prisma.$queryRaw<unknown[]>`
    SELECT e.platform, e.url, e.published_at AS "publishedAt", e.delivered_at AS "deliveredAt"
      FROM asset_publish_events e JOIN post_targets t ON t.id = e.target_id JOIN posts p ON p.id = t.post_id
     WHERE e.asset_id = ${String(req.params.id)} AND p.owner_id = ${uid(res)} ORDER BY e.published_at DESC`;
  res.json(rows);
}));

router.get('/best-time', wrap(async (req, res) => {
  const platform = z.string().max(40).parse(req.query.platform);
  const rows = await prisma.$queryRaw<{ hour: number; n: number; ok: number }[]>`
    SELECT EXTRACT(HOUR FROM a.started_at)::int AS hour, COUNT(*)::int AS n,
           SUM(CASE WHEN a.error_class IS NULL AND a.finished_at IS NOT NULL THEN 1 ELSE 0 END)::int AS ok
      FROM publish_attempts a JOIN post_targets t ON t.id = a.target_id JOIN posts p ON p.id = t.post_id JOIN social_accounts s ON s.id = t.account_id
     WHERE p.owner_id = ${uid(res)} AND s.platform = ${platform} GROUP BY 1`;
  const best = pickBestHour(rows);
  res.json(best ? { suggestion: best, basis: 'your own past results (success rate by hour, UTC)' } : { suggestion: null, basis: 'not enough history yet' });
}));
