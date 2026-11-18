// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CSP_DIRECTIVES, serializeCsp } from './contentSecurityPolicy';

type VercelConfig = {
  headers: { source: string; headers: { key: string; value: string }[] }[];
};

describe('Content-Security-Policy', () => {
  it('is what vercel.json sends for every page', () => {
    const config = JSON.parse(
      readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'),
    ) as VercelConfig;
    const values = config.headers.flatMap(({ headers }) =>
      headers.filter(({ key }) => key === 'Content-Security-Policy').map(({ value }) => value),
    );
    expect(values).toEqual([serializeCsp(CSP_DIRECTIVES)]);
  });

  it('joins directives in order and keeps source-less directives bare', () => {
    expect(
      serializeCsp({
        'default-src': ["'self'"],
        'img-src': ["'self'", 'data:'],
        'upgrade-insecure-requests': [],
      }),
    ).toBe("default-src 'self'; img-src 'self' data:; upgrade-insecure-requests");
  });
});
