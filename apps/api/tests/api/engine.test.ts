// Engine behaviour end to end against the mock platform. Needs a local Postgres. Run: npm run test:api
process.env.NODE_ENV = 'test';
import request from 'supertest';
import { randomBytes } from 'crypto';
process.env.TOKEN_ENCRYPTION_KEY ||= randomBytes(32).toString('base64');
const MOCK = 'http://localhost:4298'; const BRIDGE = 'http://localhost:4198';
process.env.MOCK_PLATFORM_URL = MOCK;
import { createApp } from '../../src/app';
import { prisma } from '../../src/db';
import { encrypt, decrypt } from '../../src/services/crypto';
import { claimNext, processTarget } from '../../src/worker/engine';
import { deliverEvents } from '../../src/worker/bridge';
import { start, killAll, sleep, post, assertLocalDb } from '../helpers';

const app = createApp();
const OWNER = 'eng-' + randomBytes(3).toString('hex');
const as = { 'x-test-user': OWNER };
let acc: string;
const mode = (m: string) => post(MOCK, '/mode', { mode: m });
const count = async () => (await (await fetch(MOCK + '/count')).json()).count as number;

async function mkAccount(extra: Record<string, unknown> = {}) {
  return (await prisma.socialAccount.create({ data: { ownerId: OWNER, platform: 'mock', externalId: randomBytes(4).toString('hex'),
    displayName: 'Mock', accessTokenEnc: encrypt('mock-token'), ...extra } })).id;
}
async function mkTarget(accountId = acc, extra: Record<string, unknown> = {}) {
  const p = await prisma.post.create({ data: { ownerId: OWNER, body: 'hello ' + randomBytes(2).toString('hex'), ...extra } });
  const t = await prisma.postTarget.create({ data: { postId: p.id, accountId, idempotencyKey: `${p.id}:${accountId}` } });
  return { post: p, target: t };
}
async function runOnce() { const c = await claimNext('test-worker', 600); if (c) await processTarget(c, 'test-worker'); return c; }
const get = (id: string) => prisma.postTarget.findUniqueOrThrow({ where: { id } });

beforeAll(async () => {
  assertLocalDb();
  await prisma.postTarget.updateMany({ where: { status: { in: ['QUEUED', 'RETRYING', 'SCHEDULED', 'PUBLISHING'] } }, data: { status: 'CANCELLED' } });
  start('tools/mock-platform/server.ts', { MOCK_PORT: '4298' });
  start('tools/mock-pinithub/server.ts', { BRIDGE_PORT: '4198' });
  await sleep(2500);
  acc = await mkAccount();
});
beforeEach(async () => { await post(MOCK, '/reset', {}); });
// A Retrying target from one test must never be claimed by the next test.
afterEach(async () => {
  await prisma.postTarget.updateMany({ where: { post: { ownerId: OWNER }, status: { in: ['QUEUED', 'RETRYING', 'SCHEDULED', 'PUBLISHING'] } }, data: { status: 'CANCELLED' } });
});
afterAll(async () => {
  killAll();
  await prisma.post.deleteMany({ where: { ownerId: OWNER } });
  await prisma.socialAccount.deleteMany({ where: { ownerId: OWNER } });
  await prisma.$disconnect();
});

describe('every error class shows the right status, reason and action', () => {
  test('success -> PUBLISHED with link, one platform post', async () => {
    const { target } = await mkTarget(); await runOnce();
    const t = await get(target.id);
    expect(t.status).toBe('PUBLISHED'); expect(t.externalUrl).toMatch(/^http/); expect(await count()).toBe(1);
  });
  test('429 -> RETRYING with a future time', async () => {
    await mode('429'); const { target } = await mkTarget(); await runOnce();
    const t = await get(target.id);
    expect(t.status).toBe('RETRYING'); expect(t.lastErrorClass).toBe('RETRYABLE'); expect(t.lastError).toMatch(/rate/i);
    expect(t.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
  });
  test('401 with no refresh available -> NEEDS_RECONNECT and the account is flagged', async () => {
    await mode('401'); const a = await mkAccount(); const { target } = await mkTarget(a); await runOnce();
    expect((await get(target.id)).status).toBe('NEEDS_RECONNECT');
    expect((await prisma.socialAccount.findUniqueOrThrow({ where: { id: a } })).status).toBe('NEEDS_RECONNECT');
  });
  test('401 then refresh succeeds -> token replaced, retried, PUBLISHED', async () => {
    const a = await mkAccount({ refreshTokenEnc: encrypt('refresh-1') });
    const before = (await prisma.socialAccount.findUniqueOrThrow({ where: { id: a } })).accessTokenEnc;
    await mode('expired_once'); const { target } = await mkTarget(a); await runOnce();
    expect((await get(target.id)).status).toBe('RETRYING');
    const acct = await prisma.socialAccount.findUniqueOrThrow({ where: { id: a } });
    expect(acct.accessTokenEnc).not.toBe(before); expect(decrypt(acct.accessTokenEnc)).toBe('mock-token-2'); expect(acct.status).toBe('CONNECTED');
    await runOnce(); expect((await get(target.id)).status).toBe('PUBLISHED');
  });
  test('401 and refresh also fails -> NEEDS_RECONNECT', async () => {
    const a = await mkAccount({ refreshTokenEnc: encrypt('refresh-1') });
    await mode('401'); const { target } = await mkTarget(a); await runOnce();
    expect((await get(target.id)).status).toBe('NEEDS_RECONNECT');
  });
  test('400 -> FAILED with the platform message, no automatic retry', async () => {
    await mode('400'); const { target } = await mkTarget(); await runOnce();
    const t = await get(target.id);
    expect(t.status).toBe('FAILED'); expect(t.lastErrorClass).toBe('VALIDATION'); expect(t.lastError).toMatch(/rejected/i);
  });
  test('403 -> BLOCKED', async () => {
    await mode('403'); const { target } = await mkTarget(); await runOnce();
    expect((await get(target.id)).status).toBe('BLOCKED');
  });
  test('500 -> RETRYING', async () => {
    await mode('500'); const { target } = await mkTarget(); await runOnce();
    expect((await get(target.id)).status).toBe('RETRYING');
  });
  test('timeout -> RETRYING', async () => {
    await mode('timeout'); const { target } = await mkTarget(); await runOnce();
    const t = await get(target.id); expect(t.status).toBe('RETRYING'); expect(t.lastError).toMatch(/respond/i);
  });
  test('5 failed tries -> FAILED, not retried forever', async () => {
    await mode('500'); const { target } = await mkTarget();
    for (let i = 0; i < 5; i++) { await prisma.postTarget.update({ where: { id: target.id }, data: { nextAttemptAt: new Date(Date.now() - 1000) } }); await runOnce(); }
    const t = await get(target.id); expect(t.status).toBe('FAILED'); expect(t.attemptCount).toBe(5);
  });
  test('one platform failing never changes another', async () => {
    await mode('400'); const a = await mkTarget(); await runOnce();
    await mode('ok'); const b = await mkTarget(); await runOnce();
    expect((await get(a.target.id)).status).toBe('FAILED'); expect((await get(b.target.id)).status).toBe('PUBLISHED');
  });
  test('every attempt is recorded and contains no token', async () => {
    await mode('429'); const { target } = await mkTarget(); await runOnce();
    const at = await prisma.publishAttempt.findMany({ where: { targetId: target.id } });
    expect(at).toHaveLength(1); expect(at[0].errorClass).toBe('RETRYABLE'); expect(JSON.stringify(at)).not.toContain('mock-token');
  });
});

describe('zero duplicates', () => {
  test('timeout AFTER the platform saved the post: the retry reconciles instead of posting again', async () => {
    await mode('timeout_after_send'); const { target } = await mkTarget(); await runOnce();
    expect((await get(target.id)).status).toBe('RETRYING'); expect(await count()).toBe(1);
    await mode('ok'); await prisma.postTarget.update({ where: { id: target.id }, data: { nextAttemptAt: new Date(Date.now() - 1000) } });
    await runOnce();
    expect((await get(target.id)).status).toBe('PUBLISHED'); expect(await count()).toBe(1);
  });
  test('manual Retry after FAILED publishes exactly once', async () => {
    await mode('400'); const { target } = await mkTarget(); await runOnce();
    await mode('ok');
    expect((await request(app).post(`/v1/publish/targets/${target.id}/retry`).set(as).send({})).status).toBe(202);
    await runOnce(); expect((await get(target.id)).status).toBe('PUBLISHED'); expect(await count()).toBe(1);
  });
  test('Retry with edited text is validated first', async () => {
    await mode('400'); const { target } = await mkTarget(); await runOnce();
    const r = await request(app).post(`/v1/publish/targets/${target.id}/retry`).set(as).send({ text: 'x'.repeat(500) });
    expect(r.status).toBe(422);
  });
  test('retry is refused unless the target is Failed / Blocked / Needs reconnect', async () => {
    const { target } = await mkTarget();
    expect((await request(app).post(`/v1/publish/targets/${target.id}/retry`).set(as).send({})).status).toBe(409);
  });
});

describe('rate limit per account', () => {
  test('when the bucket is empty the target waits (Retrying) and is not dropped or counted as an attempt', async () => {
    process.env.RATE_CAPACITY = '2'; process.env.RATE_PER_MINUTE = '60';
    const a = await mkAccount(); const ts = [];
    for (let i = 0; i < 3; i++) ts.push((await mkTarget(a)).target.id);
    for (let i = 0; i < 3; i++) await runOnce();
    delete process.env.RATE_CAPACITY; delete process.env.RATE_PER_MINUTE;
    const st = await Promise.all(ts.map(get));
    expect(st.filter(t => t.status === 'PUBLISHED')).toHaveLength(2);
    const waiting = st.find(t => t.status === 'RETRYING')!;
    expect(waiting).toBeTruthy(); expect(waiting.attemptCount).toBe(0); expect(waiting.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
  });
});

describe('asset history', () => {
  test('a publish creates exactly one asset event; failed delivery is retried later; delivery is not repeated', async () => {
    process.env.ASSET_BRIDGE_URL = 'http://localhost:4999'; // nothing listens here
    const assetId = 'asset-1'; const { target } = await mkTarget(acc, { assetId }); await runOnce();
    expect(await prisma.assetPublishEvent.count({ where: { targetId: target.id } })).toBe(1);
    expect((await deliverEvents()).failed).toBeGreaterThanOrEqual(1);
    expect((await prisma.assetPublishEvent.findUniqueOrThrow({ where: { targetId: target.id } })).deliveredAt).toBeNull();
    process.env.ASSET_BRIDGE_URL = BRIDGE;
    await deliverEvents(); await deliverEvents();
    expect((await prisma.assetPublishEvent.findUniqueOrThrow({ where: { targetId: target.id } })).deliveredAt).not.toBeNull();
    const seen = await (await fetch(`${BRIDGE}/assets/${assetId}/events`)).json();
    expect(seen.filter((e: any) => e.targetId === target.id)).toHaveLength(1);
    const h = await request(app).get(`/v1/publish/assets/${assetId}/history`).set(as);
    expect(h.body.length).toBeGreaterThanOrEqual(1); expect(h.body[0].platform).toBe('mock');
    expect((await request(app).get(`/v1/publish/assets/${assetId}/history`).set({ 'x-test-user': 'someone-else' })).body).toEqual([]);
  });
});

describe('scheduling, edit, cancel, disconnect', () => {
  const future = (ms: number) => new Date(Date.now() + ms).toISOString();
  test('edit before it goes out works; after publishing it is refused (409)', async () => {
    const c = await request(app).post('/v1/publish/posts').set(as).set('Idempotency-Key', 'sch-' + randomBytes(4).toString('hex'))
      .send({ body: 'later', accountIds: [acc], scheduledAt: future(3600_000), timezone: 'Asia/Kolkata' });
    expect(c.status).toBe(201); expect(c.body.targets[0].status).toBe('SCHEDULED');
    const id = c.body.postId;
    expect((await request(app).patch(`/v1/publish/posts/${id}`).set(as).send({ body: 'edited', scheduledAt: future(7200_000) })).status).toBe(200);
    await prisma.postTarget.updateMany({ where: { postId: id }, data: { status: 'PUBLISHED' } });
    expect((await request(app).patch(`/v1/publish/posts/${id}`).set(as).send({ body: 'too late' })).status).toBe(409);
  });
  test('a scheduled post is not picked up before its time', async () => {
    const { target } = await mkTarget(); await prisma.postTarget.update({ where: { id: target.id }, data: { status: 'SCHEDULED', nextAttemptAt: new Date(Date.now() + 3600_000) } });
    const c = await claimNext('test-worker', 600); expect(c?.id).not.toBe(target.id);
    if (c) await prisma.postTarget.update({ where: { id: c.id }, data: { status: 'CANCELLED' } });
  });
  test('cancel stops a scheduled post', async () => {
    const c = await request(app).post('/v1/publish/posts').set(as).set('Idempotency-Key', 'can-' + randomBytes(4).toString('hex'))
      .send({ body: 'cancel me', accountIds: [acc], scheduledAt: future(3600_000) });
    expect((await request(app).delete(`/v1/publish/posts/${c.body.postId}`).set(as)).status).toBe(204);
    expect((await prisma.postTarget.findFirstOrThrow({ where: { postId: c.body.postId } })).status).toBe('CANCELLED');
  });
  test('disconnect deletes the stored login and cancels queued posts; the worker never calls the platform', async () => {
    const a = await mkAccount(); const { target } = await mkTarget(a);
    expect((await request(app).delete(`/v1/publish/accounts/${a}`).set(as)).status).toBe(204);
    const row = await prisma.socialAccount.findUniqueOrThrow({ where: { id: a } });
    expect(row.status).toBe('DISCONNECTED'); expect(row.accessTokenEnc).toBe('');
    expect((await get(target.id)).status).toBe('CANCELLED'); expect(await count()).toBe(0);
    expect((await request(app).get('/v1/publish/accounts').set(as)).body.find((x: any) => x.id === a)).toBeUndefined();
  });
  test('stats and calendar queries only return this user\'s data', async () => {
    const s = await request(app).get('/v1/publish/stats?days=7').set(as);
    expect(s.status).toBe(200); expect(s.body.PUBLISHED).toBeGreaterThan(0);
    const other = await request(app).get('/v1/publish/stats?days=7').set({ 'x-test-user': 'nobody-' + randomBytes(2).toString('hex') });
    expect(other.body.PUBLISHED).toBe(0);
    const cal = await request(app).get(`/v1/publish/posts?scheduledFrom=${encodeURIComponent(future(-86400_000))}&scheduledTo=${encodeURIComponent(future(30 * 86400_000))}`).set(as);
    expect(cal.status).toBe(200); expect(cal.body.every((p: any) => p.scheduledAt)).toBe(true);
  });
});

describe('live status', () => {
  async function readEvents(headers: Record<string, string>, ms: number, trigger: () => Promise<unknown>) {
    const server = app.listen(0); const port = (server.address() as any).port; const ctrl = new AbortController();
    const r = await fetch(`http://localhost:${port}/v1/publish/events`, { headers, signal: ctrl.signal });
    const reader = r.body!.getReader(); const dec = new TextDecoder(); let buf = '';
    await trigger();
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const got = await Promise.race([reader.read(), sleep(end - Date.now()).then(() => null)]);
      if (!got || got.done) break; buf += dec.decode(got.value); if (buf.includes('event: target')) break;
    }
    ctrl.abort(); server.close(); return { status: r.status, buf };
  }
  test('the stream pushes a status change to its owner within seconds', async () => {
    let id = ''; const r = await readEvents(as, 8000, async () => { const t = await mkTarget(); id = t.target.id; await prisma.postTarget.update({ where: { id }, data: { status: 'CANCELLED' } }); });
    expect(r.status).toBe(200); expect(r.buf).toContain('event: target'); expect(r.buf).toContain(id);
  });
  test('another user never receives it', async () => {
    let id = ''; const r = await readEvents({ 'x-test-user': 'stranger-' + randomBytes(2).toString('hex') }, 4500, async () => { const t = await mkTarget(); id = t.target.id; });
    expect(r.buf).not.toContain(id);
  });
});
