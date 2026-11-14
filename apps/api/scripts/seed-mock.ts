// Adds a "Mock platform" account for a user so you can demo and test without any real account.
// Usage: node --import tsx scripts/seed-mock.ts <your-supabase-user-id>
import 'dotenv/config';
import { prisma } from '../src/db';
import { encrypt } from '../src/services/crypto';

async function main() {
  const owner = process.argv[2];
  if (!owner) throw new Error('Usage: scripts/seed-mock.ts <your-supabase-user-id>  (Supabase > Authentication > Users)');
  const a = await prisma.socialAccount.upsert({
    where: { ownerId_platform_externalId: { ownerId: owner, platform: 'mock', externalId: 'mock-1' } },
    create: { ownerId: owner, platform: 'mock', externalId: 'mock-1', displayName: 'Mock platform', accessTokenEnc: encrypt('mock-token'), refreshTokenEnc: encrypt('mock-refresh') },
    update: { status: 'CONNECTED' },
  });
  console.log('mock account ready:', a.id);
  await prisma.$disconnect();
}
main();
