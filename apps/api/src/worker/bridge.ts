import { prisma } from '../db';

const base = () => process.env.ASSET_BRIDGE_URL ?? 'http://localhost:4100';

/** Send publish events to the asset's record. Safe to run repeatedly: undelivered events are retried, and the receiver de-duplicates by targetId. */
export async function deliverEvents(limit = 20): Promise<{ delivered: number; failed: number }> {
  const rows = await prisma.$queryRaw<{ id: string; asset_id: string; target_id: string; platform: string; url: string; published_at: Date; owner_id: string }[]>`
    SELECT e.id, e.asset_id, e.target_id, e.platform, e.url, e.published_at, p.owner_id
      FROM asset_publish_events e JOIN post_targets t ON t.id = e.target_id JOIN posts p ON p.id = t.post_id
     WHERE e.delivered_at IS NULL ORDER BY e.published_at LIMIT ${limit}`;
  let delivered = 0, failed = 0;
  for (const r of rows) {
    try {
      const res = await fetch(`${base()}/assets/${encodeURIComponent(r.asset_id)}/events`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-owner-id': r.owner_id },
        body: JSON.stringify({ targetId: r.target_id, platform: r.platform, url: r.url, publishedAt: new Date(r.published_at).toISOString() }),
        signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(String(res.status));
      await prisma.assetPublishEvent.update({ where: { id: r.id }, data: { deliveredAt: new Date() } });
      delivered++;
    } catch { failed++; } // stays undelivered; the next pass retries
  }
  return { delivered, failed };
}
