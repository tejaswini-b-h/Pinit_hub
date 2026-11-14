import { prisma } from '../db';

/** Token bucket per account and platform, kept in PostgreSQL so every worker shares it. Defaults are conservative guesses: tune from the platform docs. */
const DEFAULTS: Record<string, { capacity: number; perMinute: number }> = {
  mock: { capacity: 1000, perMinute: 6000 }, linkedin: { capacity: 10, perMinute: 20 }, facebook_page: { capacity: 10, perMinute: 20 },
  bluesky: { capacity: 20, perMinute: 60 }, telegram: { capacity: 20, perMinute: 20 },
};
export function bucketConfig(platform: string) {
  const d = DEFAULTS[platform] ?? { capacity: 10, perMinute: 10 };
  return { capacity: Number(process.env.RATE_CAPACITY ?? d.capacity), perMinute: Number(process.env.RATE_PER_MINUTE ?? d.perMinute) };
}

/** Returns 0 when a token was taken, otherwise the seconds to wait. The target waits (Retrying); it is never dropped. */
export async function takeToken(accountId: string, platform: string): Promise<number> {
  const cfg = bucketConfig(platform);
  return prisma.$transaction(async (tx: any) => {
    await tx.$executeRaw`INSERT INTO rate_buckets (account_id, platform, tokens, refilled_at)
      VALUES (${accountId}::uuid, ${platform}, ${cfg.capacity}, (now() AT TIME ZONE 'UTC')) ON CONFLICT DO NOTHING`;
    const [b] = await tx.$queryRaw<{ tokens: number; secs: number }[]>`
      SELECT tokens, EXTRACT(EPOCH FROM ((now() AT TIME ZONE 'UTC') - refilled_at))::float8 AS secs
        FROM rate_buckets WHERE account_id = ${accountId}::uuid AND platform = ${platform} FOR UPDATE`;
    const tokens = Math.min(cfg.capacity, Number(b.tokens) + Number(b.secs) * cfg.perMinute / 60);
    const left = tokens >= 1 ? tokens - 1 : tokens;
    await tx.$executeRaw`UPDATE rate_buckets SET tokens = ${left}, refilled_at = (now() AT TIME ZONE 'UTC')
      WHERE account_id = ${accountId}::uuid AND platform = ${platform}`;
    return tokens >= 1 ? 0 : Math.ceil(((1 - tokens) * 60) / cfg.perMinute);
  });
}
