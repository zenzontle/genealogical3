// The Content-Security-Policy that vercel.json sends for every page. vercel.json cannot import
// code, so contentSecurityPolicy.test.ts checks that its header matches these directives.
export const CSP_DIRECTIVES = {
  'default-src': ["'self'"],
  'script-src': ["'self'"],
  'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
  'font-src': ["'self'", 'https://fonts.gstatic.com'],
  'img-src': ["'self'", 'data:', 'blob:'],
  // Drive file reads and writes go straight from the browser to the Drive API.
  'connect-src': ["'self'", 'https://www.googleapis.com'],
  'object-src': ["'none'"],
  'base-uri': ["'none'"],
  'form-action': ["'none'"],
  'frame-ancestors': ["'none'"],
} satisfies Record<string, readonly string[]>;

/** Joins CSP directives into a header value; a directive with no sources stands alone. */
export function serializeCsp(directives: Record<string, readonly string[]>): string {
  return Object.entries(directives)
    .map(([name, sources]) => [name, ...sources].join(' '))
    .join('; ');
}
