import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { canonicalPagePath, discoverHtmlPages, htmlPagePath } from './publicPages';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('public HTML pages', () => {
  it('discovers new pages recursively without including assets, tooling, or build output', () => {
    const root = mkdtempSync(join(tmpdir(), 'genealogical3-pages-'));
    roots.push(root);
    const pages = ['index.html', 'about.html', 'guides/index.html', 'guides/start.html'];
    const excluded = [
      '.hidden.html',
      '.git/page.html',
      'node_modules/package/page.html',
      'dist/index.html',
      'coverage/index.html',
      'public/embed.html',
      'src/fixture.html',
      'server/fixture.html',
      'api/fixture.html',
      'scripts/fixture.html',
      'guides/readme.md',
    ];
    for (const file of [...pages, ...excluded]) {
      const filename = join(root, file);
      mkdirSync(dirname(filename), { recursive: true });
      writeFileSync(filename, 'fixture');
    }
    expect(discoverHtmlPages(root)).toEqual(pages.map((file) => join(root, file)).sort());
  });

  it.each([
    ['index.html', '/'],
    ['about.html', '/about'],
    ['about/index.html', '/about'],
    ['guides/start.html', '/guides/start'],
    ['guides/start/index.html', '/guides/start'],
    ['family notes.html', '/family%20notes'],
    ['family#notes/index.html', '/family%23notes'],
  ])('maps %s to its canonical path %s', (filename, expected) => {
    expect(canonicalPagePath(tmpdir(), join(tmpdir(), filename))).toBe(expected);
  });

  it('keeps the HTML extension and encodes names for local request rewriting', () => {
    expect(htmlPagePath(tmpdir(), join(tmpdir(), 'family notes/index.html'))).toBe(
      '/family%20notes/index.html',
    );
  });
});
