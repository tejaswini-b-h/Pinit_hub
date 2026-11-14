/** Offset (ms) of a time zone at a given UTC instant. */
function offsetAt(utcMs: number, tz: string): number {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(utcMs));
  const g = (t: string) => Number(p.find(x => x.type === t)!.value);
  return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second')) - Math.floor(utcMs / 1000) * 1000;
}
/** "2026-11-01T09:30" typed in zone `tz` -> the real UTC instant (handles daylight saving). */
export function zonedToUtc(local: string, tz: string): Date {
  const [d, t] = local.split('T'); const [y, m, day] = d.split('-').map(Number); const [h, mi] = t.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, day, h, mi);
  let utc = guess - offsetAt(guess, tz);
  utc = guess - offsetAt(utc, tz); // second pass fixes times near a clock change
  return new Date(utc);
}

/** A UTC instant shown as a "YYYY-MM-DDTHH:mm" wall-clock string in zone `tz` (for datetime-local inputs). */
export function utcToZonedLocal(d: Date, tz: string): string {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(d);
  const g = (t: string) => p.find(x => x.type === t)!.value;
  return `${g('year')}-${g('month')}-${g('day')}T${g('hour')}:${g('minute')}`;
}
