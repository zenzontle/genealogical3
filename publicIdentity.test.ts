import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { renderPrivacyPolicy, resolvePublicIdentity } from './publicIdentity';

const policy = readFileSync(new URL('./privacy-policy/index.html', import.meta.url), 'utf8');

describe('public deployment identity', () => {
  it('preserves the original deployment when settings are unset or blank', () => {
    const defaults = resolvePublicIdentity({});
    expect(defaults).toEqual({
      appUrl: 'https://genealogical3.vercel.app',
      developerName: 'Jorge Hernandez',
      repositoryUrl: 'https://github.com/zenzontle/genealogical3',
      privacyContactEmail: '',
    });
    expect(resolvePublicIdentity({ PUBLIC_DEVELOPER_NAME: '  ', PUBLIC_APP_URL: '' })).toEqual(
      defaults,
    );
  });

  it('renders a fork identity and its own issue tracker without the original identity', () => {
    const identity = resolvePublicIdentity({
      PUBLIC_APP_URL: ' https://family.example/ ',
      PUBLIC_DEVELOPER_NAME: ' Alice & Bob ',
      PUBLIC_REPOSITORY_URL: ' https://github.com/alice/family-tree.git/ ',
    });
    const html = renderPrivacyPolicy(policy, identity);
    expect(html).toContain('Alice &amp; Bob');
    expect(html).toContain('href="https://family.example/">family.example</a>');
    expect(html).toContain('href="https://github.com/alice/family-tree/issues"');
    expect(html).not.toContain('Jorge Hernandez');
    expect(html).not.toContain('genealogical3.vercel.app');
    expect(html).not.toContain('zenzontle');
  });

  it('escapes developer text and email while providing a safely encoded mailto link', () => {
    const html = renderPrivacyPolicy(
      policy,
      resolvePublicIdentity({
        PUBLIC_DEVELOPER_NAME: '<img src=x onerror="alert(1)">',
        PRIVACY_CONTACT_EMAIL: 'privacy+family&team@example.com',
      }),
    );
    expect(html).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
    expect(html).not.toContain('<img');
    expect(html).toContain('mailto:privacy%2Bfamily%26team%40example.com');
    expect(html).toContain('privacy+family&amp;team@example.com');
    expect(html).not.toContain('GENEalogical3 issue tracker');
    expect(html).not.toContain('<script');
  });

  it.each([
    { PUBLIC_APP_URL: 'javascript:alert(1)' },
    { PUBLIC_APP_URL: 'https://user:password@example.com' },
    { PUBLIC_APP_URL: 'https://family.example/subpath' },
    { PUBLIC_APP_URL: 'https://family.example/?tracking=1' },
    { PUBLIC_REPOSITORY_URL: 'https://gitlab.com/alice/tree' },
    { PUBLIC_REPOSITORY_URL: 'https://github.com/alice/tree/issues' },
    { PRIVACY_CONTACT_EMAIL: 'not-an-email' },
  ])('rejects invalid deployment settings: %j', (env) => {
    expect(() => resolvePublicIdentity(env)).toThrow(/PUBLIC_|PRIVACY_CONTACT_EMAIL/);
  });
});
