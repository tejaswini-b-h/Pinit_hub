export interface HourRow { hour: number; n: number; ok: number }
/** Best hour (UTC) from the owner's own past results: highest success rate, then most samples. Needs at least 2 samples per hour. */
export function pickBestHour(rows: HourRow[]): { hourUtc: number; successRate: number; samples: number } | null {
  const usable = rows.filter(r => r.n >= 2);
  if (!usable.length) return null;
  usable.sort((a, b) => b.ok / b.n - a.ok / a.n || b.n - a.n || a.hour - b.hour);
  const t = usable[0];
  return { hourUtc: t.hour, successRate: t.ok / t.n, samples: t.n };
}
