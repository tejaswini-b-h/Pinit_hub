import { prisma } from '../db';
import { decrypt, encrypt } from '../services/crypto';
import { getAdapter } from '../adapters/registry';

/** Refresh tokens that are close to expiry; mark the account "Needs reconnect" when that is not possible. */
export async function watchTokens() {
  const soon = new Date(Date.now() + 3 * 86400_000);
  const accounts = await prisma.socialAccount.findMany({ where: { status: 'CONNECTED', expiresAt: { not: null, lt: soon } } });
  for (const a of accounts) {
    const adapter = getAdapter(a.platform);
    try {
      if (!adapter.refresh || !a.refreshTokenEnc) throw new Error('no refresh available');
      const t = await adapter.refresh(decrypt(a.refreshTokenEnc));
      await prisma.socialAccount.update({ where: { id: a.id }, data: {
        accessTokenEnc: encrypt(t.accessToken), refreshTokenEnc: t.refreshToken ? encrypt(t.refreshToken) : a.refreshTokenEnc, expiresAt: t.expiresAt } });
    } catch {
      if (a.expiresAt && a.expiresAt < new Date()) await prisma.socialAccount.update({ where: { id: a.id }, data: { status: 'NEEDS_RECONNECT' } });
    }
  }
}
