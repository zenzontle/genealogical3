import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { normalizePath } from 'vite';

const excludedDirectories = new Set([
  'node_modules',
  'dist',
  'coverage',
  'public',
  'src',
  'server',
  'api',
  'scripts',
]);

export function discoverHtmlPages(root: string): string[] {
  function visit(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      if (entry.name.startsWith('.')) return [];
      const filename = join(directory, entry.name);
      if (entry.isDirectory()) {
        return excludedDirectories.has(entry.name) ? [] : visit(filename);
      }
      return entry.isFile() && entry.name.endsWith('.html') ? [filename] : [];
    });
  }
  return visit(root).sort();
}

export function htmlPagePath(root: string, filename: string): string {
  return `/${normalizePath(relative(root, filename)).split('/').map(encodeURIComponent).join('/')}`;
}

export function canonicalPagePath(root: string, filename: string): string {
  return (
    htmlPagePath(root, filename)
      .replace(/\/index\.html$/, '/')
      .replace(/\.html$/, '')
      .replace(/\/$/, '') || '/'
  );
}
