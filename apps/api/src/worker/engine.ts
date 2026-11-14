import { prisma } from '../db';
import { decrypt, encrypt } from '../services/crypto';
import { getAdapter } from '../adapters/registry';
import { PlatformAdapter } from '../adapters/types';
import { resolveMediaUrl } from '../services/storage';
import { backoffSeconds, MAX_ATTEMPTS } from './backoff';
import { takeToken } from '../services/buckets';

export { MAX_ATTEMPTS, backoffSeconds };
export interface Claimed { id: string; attempt_count: number }

/** Atomic claim (plan section 7.1). Also recovers targets stuck in PUBLISHING after a crash. */
export async function claimNext(workerId: string, stuckSeconds: number): Promise<Claimed | null> {
  const rows = await prisma.$queryRaw<Claimed[]>`
    UPDATE post_targets
       SET status = 'PUBLISHING', locked_by = ${workerId}, locked_at = (now() AT TIME ZONE 'UTC'), updated_at = (now() AT TIME ZONE 'UTC'),
           attempt_count = attempt_count + 1
     WHERE id = (
       SELECT id FROM post_targets
        WHERE (status IN ('SCHEDULED', 'QUEUED', 'RETRYING') AND next_attempt_at <= (now() AT TIME ZONE 'UTC'))
           OR (status = 'PUBLISHING' AND locked_at < (now() AT TIME ZONE 'UTC') - make_interval(secs => ${stuckSeconds}::double precision))
        ORDER BY next_attempt_at
        FOR UPDATE SKIP LOCKED
        LIMIT 1)
    RETURNING id, attempt_count`;
  return rows[0] ?? null;
}

export async function processTarget(c: Claimed, workerId: string): Promise<void> {
  const target = await prisma.postTarget.findUniqueOrThrow({
    where: { id: c.id }, include: { post: { include: { media: true } }, account: true },
  });
  const adapter = getAdapter(target.account.platform);

  // Never call a platform for an account that is gone or needs the owner's attention.
  if (target.account.status === 'DISCONNECTED') return setState(target.id, workerId, { status: 'CANCELLED', lastError: 'Account was disconnected.' });
  if (target.account.status === 'NEEDS_RECONNECT')
    return setState(target.id, workerId, { status: 'NEEDS_RECONNECT', lastErrorClass: 'AUTH', lastError: 'Reconnect this account, then retry.' });

  // Per-account rate limit: wait, never drop. This was not a real attempt, so give the attempt back.
  const wait = await takeToken(target.account.id, target.account.platform);
  if (wait > 0)
    return setState(target.id, workerId, { status: 'RETRYING', attemptCount: { decrement: 1 }, nextAttemptAt: new Date(Date.now() + wait * 1000),
      lastErrorClass: 'RETRYABLE', lastError: `Waiting for the ${target.account.platform} rate limit (about ${wait}s).` });

  const attempt = await prisma.publishAttempt.create({ data: { targetId: target.id } });
  try {
    const media = await Promise.all(target.post.media.map(async (m: any) => ({
      url: await resolveMediaUrl(m.storagePath, target.post.ownerId), mime: m.mime, width: m.width, height: m.height, bytes: m.bytes })));
    const input = { idempotencyKey: target.idempotencyKey, text: target.bodyOverride ?? target.post.body, media,
                    accountExternalId: target.account.externalId };
    const token = decrypt(target.account.accessTokenEnc);
    // Reconcile before retry: any earlier attempt may have reached the platform even if we never heard back.
    // DISABLE_RECONCILE exists only so the chaos test can prove it would catch duplicates. Never set it in production.
    const reconcile = c.attempt_count > 1 && process.env.DISABLE_RECONCILE !== '1';
    let result = reconcile ? await adapter.findExisting(input, token) : null;
    if (!result) result = await adapter.publish(input, token);
    await markPublished(target, attempt.id, workerId, result);
  } catch (err) {
    await handleFailure(target, attempt.id, workerId, adapter, err, c.attempt_count);
  }
}

async function markPublished(target: any, attemptId: string, workerId: string, r: { externalId: string; url: string }) {
  await prisma.$transaction(async (tx: any) => {
    // Only the worker that still holds the lock may finish the target.
    const done = await tx.postTarget.updateMany({
      where: { id: target.id, lockedBy: workerId, status: 'PUBLISHING' },
      data: { status: 'PUBLISHED', externalId: r.externalId, externalUrl: r.url, lockedBy: null, lockedAt: null,
              lastError: null, lastErrorClass: null },
    });
    if (done.count === 0) return;
    await tx.publishAttempt.update({ where: { id: attemptId }, data: { finishedAt: new Date(), httpStatus: 200 } });
    if (target.post.assetId) {
      await tx.assetPublishEvent.upsert({
        where: { targetId: target.id }, update: {},
        create: { assetId: target.post.assetId, targetId: target.id, platform: target.account.platform,
                  url: r.url, publishedAt: new Date() },
      });
    }
    await tx.auditLog.create({ data: { ownerId: target.post.ownerId, action: 'publish', detail: `${target.account.platform} ${r.url}` } });
  });
}

async function setState(targetId: string, workerId: string, data: Record<string, unknown>) {
  await prisma.postTarget.updateMany({ where: { id: targetId, lockedBy: workerId }, data: { ...data, lockedBy: null, lockedAt: null } });
}

async function handleFailure(target: any, attemptId: string, workerId: string, adapter: PlatformAdapter, err: unknown, attemptNo: number) {
  const cls = adapter.classify(err);
  await prisma.publishAttempt.update({ where: { id: attemptId },
    data: { finishedAt: new Date(), errorClass: cls.class, reason: cls.reason.slice(0, 300) } });
  const base = { lastErrorClass: cls.class, lastError: cls.reason.slice(0, 300) };
  const exhausted = attemptNo >= MAX_ATTEMPTS;

  if (cls.class === 'VALIDATION') return setState(target.id, workerId, { ...base, status: 'FAILED' });

  if (cls.class === 'BLOCKED')
    return setState(target.id, workerId, { ...base, status: 'BLOCKED', nextAttemptAt: new Date(Date.now() + 3600_000) });

  if (cls.class === 'AUTH') {
    const acc = target.account;
    if (!exhausted && adapter.refresh && acc.refreshTokenEnc) {
      try {
        const t = await adapter.refresh(decrypt(acc.refreshTokenEnc));
        await prisma.socialAccount.update({ where: { id: acc.id }, data: {
          accessTokenEnc: encrypt(t.accessToken),
          refreshTokenEnc: t.refreshToken ? encrypt(t.refreshToken) : acc.refreshTokenEnc,
          expiresAt: t.expiresAt, status: 'CONNECTED' } });
        return setState(target.id, workerId, { ...base, status: 'RETRYING', nextAttemptAt: new Date() });
      } catch { /* refresh failed: fall through */ }
    }
    await prisma.socialAccount.update({ where: { id: acc.id }, data: { status: 'NEEDS_RECONNECT' } });
    return setState(target.id, workerId, { ...base, status: 'NEEDS_RECONNECT' });
  }

  // RETRYABLE. If we cannot look posts up on this platform and do not know whether it posted, stop instead of risking a duplicate.
  if (cls.ambiguous && adapter.canLookup === false)
    return setState(target.id, workerId, { ...base, status: 'FAILED',
      lastError: `${cls.reason} It may already have been posted, so it was not retried automatically. Check the platform, then press Retry if the post is missing.`.slice(0, 300) });
  if (exhausted) return setState(target.id, workerId, { ...base, status: 'FAILED' });
  return setState(target.id, workerId, { ...base, status: 'RETRYING',
    nextAttemptAt: new Date(Date.now() + backoffSeconds(attemptNo, cls.retryAfterSeconds) * 1000) });
}
