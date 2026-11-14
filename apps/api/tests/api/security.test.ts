// Security checks (plan section 10). Needs a local Postgres. Run: npm run test:api
process.env.NODE_ENV = 'test';
import request from 'supertest';
import { randomBytes } from 'crypto';
process.env.TOKEN_ENCRYPTION_KEY ||= randomBytes(32).toString('base64');
const MOCK = 'http://localhost:4297'; process.env.MOCK_PLATFORM_URL = MOCK;
import { createApp } from '../../src/app';
import { prisma } from '../../src/db';
import { encrypt } from '../../src/services/crypto';
import { claimNext, processTarget } from '../../src/worker/engine';
import { finishOAuth, startOAuth } from '../../src/services/oauth';
import { start, killAll, sleep, post, assertLocalDb } from '../helpers';

const SENTINEL = 'SENTINEL_TOKEN_' + randomBytes(6).toString('hex');
const OWNER = 'sec-' + randomBytes(3).toString('hex');
const as = { 'x-test-user': OWNER };
let acc: string;

beforeAll(async () => {
  assertLocalDb();
  await prisma.postTarget.updateMany({ where: { status: { in: ['QUEUED', 'RETRYING', 'SCHEDULED', 'PUBLISHING'] } }, data: { status: 'CANCELLED' } });
  start('tools/mock-platform/server.ts', { MOCK_PORT: '4297' }); await sleep(2500);
  acc = (await prisma.socialAccount.create({ data: { ownerId: OWNER, platform: 'mock', externalId: 's1', displayName: 'Sec', accessTokenEnc: encrypt(SENTINEL), refreshTokenEnc: encrypt(SENTINEL + '_R') } })).id;
});
afterAll(async () => {
  killAll();
  await prisma.oAuthState.deleteMany({ where: { ownerId: OWNER } });
  await prisma.post.deleteMany({ where: { ownerId: OWNER } });
  await prisma.socialAccount.deleteMany({ where: { ownerId: OWNER } });
  await prisma.$disconnect();
});

test('tokens never appear in logs, API responses or any database column (only encrypted at rest)', async () => {
  const logs: string[] = [];
  const spies = (['log', 'error', 'warn', 'info'] as const).map(k => jest.spyOn(console, k).mockImplementation((...a: unknown[]) => { logs.push(a.map(String).join(' ')); }));
  const app = createApp();
  // success path and a failing path, so error handling is exercised too
  for (const m of ['ok', '500', '400']) {
    await post(MOCK, '/mode', { mode: m });
    const r = await request(app).post('/v1/publish/posts').set(as).set('Idempotency-Key', 'leak-' + m + randomBytes(3).toString('hex')).send({ body: 'leak test ' + m, accountIds: [acc] });
    expect(r.status).toBe(201);
    const c = await claimNext('sec-worker', 600); if (c) await processTarget(c, 'sec-worker');
  }
  const bodies: string[] = [];
  for (const path of ['/accounts', '/posts', '/stats', '/platforms']) bodies.push(JSON.stringify((await request(app).get('/v1/publish' + path).set(as)).body));
  const posts = (await request(app).get('/v1/publish/posts').set(as)).body;
  bodies.push(JSON.stringify((await request(app).get(`/v1/publish/posts/${posts[0].id}`).set(as)).body));
  spies.forEach(s => s.mockRestore());

  for (const b of bodies) expect(b).not.toContain(SENTINEL);
  expect(logs.join('\n')).not.toContain(SENTINEL);

  // scan every text column of every table
  const cols = await prisma.$queryRaw<{ table_name: string; column_name: string }[]>`
    SELECT table_name::text AS table_name, column_name::text AS column_name FROM information_schema.columns WHERE table_schema = 'public' AND data_type = 'text' AND table_name <> '_prisma_migrations'`;
  for (const c of cols) {
    const n = await prisma.$queryRawUnsafe<{ n: number }[]>(`SELECT COUNT(*)::int AS n FROM "${c.table_name}" WHERE "${c.column_name}" LIKE $1`, `%${SENTINEL}%`);
    expect({ ...c, hits: n[0].n }).toEqual({ ...c, hits: 0 });
  }
  const row = await prisma.socialAccount.findUniqueOrThrow({ where: { id: acc } });
  expect(row.accessTokenEnc).not.toContain(SENTINEL); expect(row.accessTokenEnc.split('.')).toHaveLength(3);
});

describe('OAuth state', () => {
  beforeAll(() => { process.env.API_URL = 'http://localhost:4000'; process.env.LINKEDIN_CLIENT_ID = 'x'; process.env.LINKEDIN_CLIENT_SECRET = 'y'; });
  test('unknown state refused', async () => { await expect(finishOAuth('linkedin', 'code', 'made-up')).rejects.toThrow(/invalid|expired/i); });
  test('expired state refused', async () => {
    await prisma.oAuthState.create({ data: { state: 'old-' + OWNER, ownerId: OWNER, platform: 'linkedin', codeVerifier: 'v', expiresAt: new Date(Date.now() - 1000) } });
    await expect(finishOAuth('linkedin', 'code', 'old-' + OWNER)).rejects.toThrow(/invalid|expired/i);
  });
  test('state for another platform refused', async () => {
    await prisma.oAuthState.create({ data: { state: 'fb-' + OWNER, ownerId: OWNER, platform: 'facebook_page', codeVerifier: 'v', expiresAt: new Date(Date.now() + 60000) } });
    await expect(finishOAuth('linkedin', 'code', 'fb-' + OWNER)).rejects.toThrow(/invalid|expired/i);
  });
  test('state is single use: a replayed callback is refused', async () => {
    const url = new URL(await startOAuth(OWNER, 'linkedin')); const state = url.searchParams.get('state')!;
    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:4000/v1/publish/accounts/linkedin/callback');
    await expect(finishOAuth('linkedin', 'code', state)).rejects.toThrow(); // first use: consumed, then the token exchange fails (no network / fake keys)
    expect(await prisma.oAuthState.count({ where: { state } })).toBe(0);
    await expect(finishOAuth('linkedin', 'code', state)).rejects.toThrow(/invalid|expired/i); // replay
  });
});

test('the test-login header is ignored outside the test environment', async () => {
  const app = createApp(); process.env.NODE_ENV = 'production';
  const r = await request(app).get('/v1/publish/accounts').set(as);
  process.env.NODE_ENV = 'test';
  expect(r.status).toBe(401);
});

test('request rate limit returns 429 when exceeded', async () => {
  process.env.RATE_LIMIT_PER_MIN = '15'; const app = createApp(); delete process.env.RATE_LIMIT_PER_MIN;
  const codes: number[] = []; for (let i = 0; i < 25; i++) codes.push((await request(app).get('/health')).status);
  expect(codes.filter(c => c === 429).length).toBeGreaterThan(0); expect(codes[0]).toBe(200);
});

test('error responses do not leak internals', async () => {
  const app = createApp();
  const r = await request(app).post('/v1/publish/posts').set(as).set('Idempotency-Key', 'bad').send({ body: 5, accountIds: 'nope' });
  expect(r.status).toBe(400); expect(JSON.stringify(r.body)).not.toMatch(/prisma|stack|node_modules/i);
});
