// Needs a real database (DATABASE_URL). Run: npm run test:api
process.env.NODE_ENV = 'test';
import request from 'supertest';
import { randomBytes } from 'crypto';
process.env.TOKEN_ENCRYPTION_KEY ||= randomBytes(32).toString('base64');
import { createApp } from '../../src/app';
import { prisma } from '../../src/db';
import { encrypt } from '../../src/services/crypto';

const app = createApp();
const A = 'user-a-' + randomBytes(3).toString('hex');
const B = 'user-b-' + randomBytes(3).toString('hex');
let accA: string, accB: string;
const as = (u: string) => ({ 'x-test-user': u });

beforeAll(async () => {
  accA = (await prisma.socialAccount.create({ data: { ownerId: A, platform: 'mock', externalId: 'a', displayName: 'A mock', accessTokenEnc: encrypt('tok-a') } })).id;
  accB = (await prisma.socialAccount.create({ data: { ownerId: B, platform: 'mock', externalId: 'b', displayName: 'B mock', accessTokenEnc: encrypt('tok-b') } })).id;
});
afterAll(async () => {
  await prisma.post.deleteMany({ where: { ownerId: { in: [A, B] } } });
  await prisma.socialAccount.deleteMany({ where: { ownerId: { in: [A, B] } } });
  await prisma.$disconnect();
});

test('no login -> 401', async () => expect((await request(app).get('/v1/publish/accounts')).status).toBe(401));

test('accounts list never contains tokens and only your own accounts', async () => {
  const r = await request(app).get('/v1/publish/accounts').set(as(A));
  expect(r.status).toBe(200);
  expect(r.body.map((x: any) => x.id)).toEqual([accA]);
  expect(JSON.stringify(r.body)).not.toMatch(/token|Enc/i);
});

test('A cannot post using B\'s account', async () => {
  const r = await request(app).post('/v1/publish/posts').set(as(A)).set('Idempotency-Key', 'k-' + randomBytes(4).toString('hex'))
    .send({ body: 'hi', accountIds: [accB] });
  expect(r.status).toBe(422);
});

test('same Idempotency-Key twice creates exactly one post', async () => {
  const key = 'dbl-' + randomBytes(4).toString('hex');
  const [r1, r2] = await Promise.all([1, 2].map(() => request(app).post('/v1/publish/posts').set(as(A)).set('Idempotency-Key', key).send({ body: 'once', accountIds: [accA] })));
  expect(r1.body.postId).toBe(r2.body.postId);
  expect(await prisma.post.count({ where: { ownerId: A, idempotencyKey: key } })).toBe(1);
});

test('B cannot read, cancel or retry A\'s post', async () => {
  const p = await request(app).post('/v1/publish/posts').set(as(A)).set('Idempotency-Key', 'iso-' + randomBytes(4).toString('hex')).send({ body: 'private', accountIds: [accA] });
  const id = p.body.postId, target = p.body.targets[0].id;
  expect((await request(app).get(`/v1/publish/posts/${id}`).set(as(B))).status).toBe(404);
  expect((await request(app).delete(`/v1/publish/posts/${id}`).set(as(B))).status).toBe(404);
  expect((await request(app).post(`/v1/publish/targets/${target}/retry`).set(as(B))).status).toBe(404);
  expect((await request(app).get('/v1/publish/posts').set(as(B))).body).toEqual([]);
});

test('missing Idempotency-Key -> 400', async () =>
  expect((await request(app).post('/v1/publish/posts').set(as(A)).send({ body: 'x', accountIds: [accA] })).status).toBe(400));

test('over-long text is rejected before anything is saved', async () => {
  const r = await request(app).post('/v1/publish/posts').set(as(A)).set('Idempotency-Key', 'long-' + randomBytes(4).toString('hex')).send({ body: 'x'.repeat(281), accountIds: [accA] });
  expect(r.status).toBe(422);
  expect(r.body.problems[accA][0]).toMatch(/280/);
});
