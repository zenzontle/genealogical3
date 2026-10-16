import { expect, it } from 'vitest';
import { retryAfterDelay } from './retryAfter';
it.each([null, '', 'invalid-date', '-5'])('ignores invalid or negative Retry-After %s', (value) =>
  expect(retryAfterDelay(value)).toBe(0),
);
it('accepts seconds and HTTP dates, ignoring dates already in the past', () => {
  const now = Date.UTC(2026, 9, 13, 12);
  expect(retryAfterDelay('120', now)).toBe(120000);
  expect(retryAfterDelay(new Date(now + 120000).toUTCString(), now)).toBe(120000);
  expect(retryAfterDelay(new Date(now - 120000).toUTCString(), now)).toBe(0);
});
