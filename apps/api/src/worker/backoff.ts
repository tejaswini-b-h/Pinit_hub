export const MAX_ATTEMPTS = 5;
const BACKOFF_SECONDS = [60, 300, 900, 3600];
export function backoffSeconds(attempt: number, retryAfter?: number): number {
  const base = retryAfter ?? BACKOFF_SECONDS[Math.min(Math.max(attempt, 1) - 1, BACKOFF_SECONDS.length - 1)];
  return Math.round(base * (0.9 + Math.random() * 0.2)); // +-10% jitter
}
