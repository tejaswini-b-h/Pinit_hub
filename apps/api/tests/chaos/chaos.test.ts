import { randomBytes } from 'crypto';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
process.env.TOKEN_ENCRYPTION_KEY ||= randomBytes(32).toString('base64');
import { prisma } from '../../src/db';
import { encrypt } from '../../src/services/crypto';

const N = 100;
const MOCK = 'http://localhost:4299';
const API_DIR = path.resolve(__dirname, '../..');
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const procs = new Set<ChildProcess>();

function start(script: string, env: Record<string, string>) {
  const p = spawn(process.execPath, ['--import', 'tsx', script], {
    cwd: API_DIR, stdio: 'ignore', env: { ...process.env, ...env },
  });
  procs.add(p); p.on('exit', () => procs.delete(p));
  return p;
}
const post = (p: string, body: unknown) => fetch(MOCK + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

afterAll(async () => { procs.forEach(p => p.kill('SIGKILL')); await prisma.$disconnect(); });

test(`killing workers at random during ${N} publishes creates exactly ${N} posts`, async () => {
  const workerEnv = { MOCK_PLATFORM_URL: MOCK, STUCK_SECONDS: '3', IDLE_MS: '100', DISABLE_RECONCILE: process.env.CHAOS_CONTROL === '1' ? '1' : '0' };
  const control = process.env.CHAOS_CONTROL === '1'; // control run: reconcile off, duplicates are EXPECTED
  start('tools/mock-platform/server.ts', { MOCK_PORT: '4299' });
  await sleep(2000);
  await post('/reset', {}); await post('/latency', { ms: 400 });

  const owner = 'chaos-' + randomBytes(4).toString('hex');
  const acc = await prisma.socialAccount.create({ data: {
    ownerId: owner, platform: 'mock', externalId: 'm1', displayName: 'Mock', accessTokenEnc: encrypt('mock-token') } });
  const posts = [];
  for (let i = 0; i < N; i++) {
    const p = await prisma.post.create({ data: { ownerId: owner, body: `chaos ${i}` } });
    await prisma.postTarget.create({ data: { postId: p.id, accountId: acc.id, idempotencyKey: `${p.id}:${acc.id}` } });
    posts.push(p.id);
  }

  let workers: ChildProcess[] = [0, 1, 2].map(i => start('src/worker/index.ts', { ...workerEnv, WORKER_ID: `w${i}` }));
  let kills = 0, id = 3;
  const deadline = Date.now() + 150_000;
  for (;;) {
    await sleep(700 + Math.random() * 800);
    const open = await prisma.postTarget.count({ where: { accountId: acc.id, status: { notIn: ['PUBLISHED', 'FAILED'] } } });
    if (open === 0 || Date.now() > deadline) break;
    const victim = workers[Math.floor(Math.random() * workers.length)];
    victim.kill('SIGKILL'); kills++;
    workers = workers.filter(w => w !== victim);
    workers.push(start('src/worker/index.ts', { ...workerEnv, WORKER_ID: `w${id++}` }));
  }

  const count = (await (await fetch(MOCK + '/count')).json()).count;
  const published = await prisma.postTarget.count({ where: { accountId: acc.id, status: 'PUBLISHED' } });
  const recovered = await prisma.postTarget.count({ where: { accountId: acc.id, attemptCount: { gt: 1 } } });
  console.log(JSON.stringify({ RESULT: control ? 'chaos-control (reconcile OFF)' : 'chaos', targets: N, platformPosts: count, publishedInDb: published, workerKills: kills, targetsRecoveredAfterKill: recovered }));

  await prisma.post.deleteMany({ where: { ownerId: owner } });
  await prisma.socialAccount.delete({ where: { id: acc.id } });
  expect(published).toBe(N);
  if (control) expect(count).toBeGreaterThan(N); // proves the test can see duplicates
  else expect(count).toBe(N); // zero duplicates, zero losses
});
