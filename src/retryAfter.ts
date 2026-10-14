export function retryAfterDelay(value: string | null, now = Date.now()): number {
  if (!value) return 0;
  const delay = Number.isFinite(Number(value)) ? Number(value) * 1000 : Date.parse(value) - now;
  return Number.isFinite(delay) ? Math.max(0, delay) : 0;
}
