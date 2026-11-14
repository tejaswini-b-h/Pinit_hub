// Success-rate measurement: publish N test posts to ONE connected account and report how many succeed.
// Use only accounts you own for testing. Real platforms: keep N small first and respect their limits.
// Usage: node --import tsx scripts/publish-n.ts <accountId> <n=50> [gapSeconds=30] --yes
import 'dotenv/config';
import { randomBytes } from 'crypto';
import { prisma } from '../src/db';
import { createPost } from '../src/services/posts';

const [accountId, nArg, gapArg] = process.argv.slice(2);
async function main() {
  if (!accountId || !process.argv.includes('--yes')) throw new Error('Usage: publish-n.ts <accountId> <n> [gapSeconds] --yes   (this really posts to the platform)');
  const n = Number(nArg ?? 50), gap = Number(gapArg ?? 30);
  const acc = await prisma.socialAccount.findUniqueOrThrow({ where: { id: accountId } });
  console.log(`Publishing ${n} test posts to ${acc.platform} (${acc.displayName}), one every ${gap}s. Keep the worker running.`);
  const ids: string[] = [];
  for (let i = 1; i <= n; i++) {
    const { post } = await createPost({ ownerId: acc.ownerId, body: `Test post ${i}/${n} (${randomBytes(3).toString('hex')})`, accountIds: [acc.id], mediaPaths: [], idempotencyKey: `pubn-${randomBytes(6).toString('hex')}` });
    ids.push(post.id);
    await new Promise(r => setTimeout(r, gap * 1000));
  }
  const deadline = Date.now() + 10 * 60_000;
  while (Date.now() < deadline) {
    const open = await prisma.postTarget.count({ where: { postId: { in: ids }, status: { in: ['QUEUED', 'PUBLISHING', 'RETRYING', 'SCHEDULED'] } } });
    if (!open) break; await new Promise(r => setTimeout(r, 3000));
  }
  const rows = await prisma.postTarget.groupBy({ by: ['status'], where: { postId: { in: ids } }, _count: { _all: true } });
  const ok = (rows.find((r: any) => r.status === 'PUBLISHED') as any)?._count._all ?? 0;
  console.log(JSON.stringify({ RESULT: 'publish-success', platform: acc.platform, attempted: n, published: ok, successRate: +(ok / n * 100).toFixed(1), byStatus: Object.fromEntries(rows.map((r: any) => [r.status, r._count._all])) }));
  await prisma.$disconnect();
}
main();
