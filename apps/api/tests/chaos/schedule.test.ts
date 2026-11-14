// Schedule accuracy: 30 posts across 10 time zones must START within 60 s of their time. Needs a local Postgres.
import { randomBytes } from 'crypto';
process.env.TOKEN_ENCRYPTION_KEY ||= randomBytes(32).toString('base64');
import { prisma } from '../../src/db';
import { encrypt } from '../../src/services/crypto';
import { start, killAll, sleep, post, assertLocalDb } from '../helpers';

const MOCK = 'http://localhost:4296';
const ZONES = ['Asia/Kolkata', 'UTC', 'America/New_York', 'Europe/London', 'Australia/Sydney', 'Asia/Tokyo', 'America/Los_Angeles', 'Europe/Berlin', 'Pacific/Auckland', 'America/Sao_Paulo'];
afterAll(async () => { killAll(); await prisma.$disconnect(); });

test('30 scheduled posts across time zones start within 60 seconds of their time', async () => {
  assertLocalDb();
  await prisma.postTarget.updateMany({ where: { status: { in: ['QUEUED', 'RETRYING', 'SCHEDULED', 'PUBLISHING'] } }, data: { status: 'CANCELLED' } });
  start('tools/mock-platform/server.ts', { MOCK_PORT: '4296' }); await sleep(2500); await post(MOCK, '/reset', {});
  const owner = 'sched-' + randomBytes(3).toString('hex');
  const acc = await prisma.socialAccount.create({ data: { ownerId: owner, platform: 'mock', externalId: 'm', displayName: 'Mock', accessTokenEnc: encrypt('t') } });
  // default worker pacing (1 s idle poll), exactly as in production
  start('src/worker/index.ts', { MOCK_PLATFORM_URL: MOCK, WORKER_ID: 'sched-w' });
  const base = Date.now() + 20_000; const ids: { target: string; at: Date }[] = [];
  for (let i = 0; i < 30; i++) {
    const at = new Date(base + Math.floor(Math.random() * 40_000));
    const p = await prisma.post.create({ data: { ownerId: owner, body: 'sched ' + i, scheduledAt: at, timezone: ZONES[i % ZONES.length] } });
    const t = await prisma.postTarget.create({ data: { postId: p.id, accountId: acc.id, idempotencyKey: `${p.id}:${acc.id}`, status: 'SCHEDULED', nextAttemptAt: at } });
    ids.push({ target: t.id, at });
  }
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if ((await prisma.postTarget.count({ where: { accountId: acc.id, status: 'PUBLISHED' } })) === 30) break;
    await sleep(1000);
  }
  const lateness: number[] = [];
  for (const { target, at } of ids) {
    const a = await prisma.publishAttempt.findFirstOrThrow({ where: { targetId: target }, orderBy: { startedAt: 'asc' } });
    lateness.push(a.startedAt.getTime() - at.getTime());
  }
  lateness.sort((x, y) => x - y);
  const result = { RESULT: 'schedule', posts: 30, zones: ZONES.length, earlyMs: lateness[0], medianMs: lateness[15], p95Ms: lateness[28], maxMs: lateness[29],
    published: await prisma.postTarget.count({ where: { accountId: acc.id, status: 'PUBLISHED' } }), platformPosts: (await (await fetch(MOCK + '/count')).json()).count };
  console.log(JSON.stringify(result));
  await prisma.post.deleteMany({ where: { ownerId: owner } }); await prisma.socialAccount.delete({ where: { id: acc.id } });
  expect(result.published).toBe(30); expect(result.platformPosts).toBe(30);
  expect(lateness[0]).toBeGreaterThanOrEqual(-50); // never before its time (small clock tolerance)
  expect(lateness[29]).toBeLessThan(60_000);
});
