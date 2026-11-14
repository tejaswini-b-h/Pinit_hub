// API speed: create-post latency with 20 concurrent users. Run the API with NODE_ENV=test RATE_LIMIT_PER_MIN=1000000 first.
// Usage: node --import tsx scripts/load-test.ts [users=20] [requestsPerUser=50]
import 'dotenv/config';
import { randomBytes } from 'crypto';
import { prisma } from '../src/db';
import { encrypt } from '../src/services/crypto';

const API = process.env.API_URL ?? 'http://localhost:4000';
const users = Number(process.argv[2] ?? 20), per = Number(process.argv[3] ?? 50);

async function main() {
  const owners = Array.from({ length: users }, () => 'load-' + randomBytes(3).toString('hex'));
  const accs = await Promise.all(owners.map(o => prisma.socialAccount.create({ data: { ownerId: o, platform: 'mock', externalId: 'l', displayName: 'Load', accessTokenEnc: encrypt('t') } })));
  const times: number[] = []; let errors = 0;
  const t0 = Date.now();
  await Promise.all(owners.map(async (o, u) => {
    for (let i = 0; i < per; i++) {
      const s = performance.now();
      const r = await fetch(`${API}/v1/publish/posts`, { method: 'POST',
        headers: { 'content-type': 'application/json', 'x-test-user': o, 'Idempotency-Key': randomBytes(8).toString('hex') },
        body: JSON.stringify({ body: `load ${u}-${i}`, accountIds: [accs[u].id] }) });
      times.push(performance.now() - s); if (r.status !== 201) errors++;
    }
  }));
  const secs = (Date.now() - t0) / 1000; times.sort((a, b) => a - b);
  const q = (p: number) => Math.round(times[Math.min(times.length - 1, Math.floor(times.length * p))]);
  console.log(JSON.stringify({ RESULT: 'api-speed', users, requests: times.length, errors, seconds: +secs.toFixed(1), reqPerSec: Math.round(times.length / secs), p50Ms: q(0.5), p95Ms: q(0.95), p99Ms: q(0.99), maxMs: Math.round(times[times.length - 1]) }));
  await prisma.post.deleteMany({ where: { ownerId: { in: owners } } });
  await prisma.socialAccount.deleteMany({ where: { ownerId: { in: owners } } });
  await prisma.$disconnect();
}
main();
