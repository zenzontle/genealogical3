export type PublicIdentity = {
  appUrl: string;
  developerName: string;
  repositoryUrl: string;
  privacyContactEmail: string;
};

export function resolvePublicIdentity(env: Record<string, string | undefined>): PublicIdentity {
  const developerName = env.PUBLIC_DEVELOPER_NAME?.trim() || 'Jorge Hernandez';
  const appUrl = env.PUBLIC_APP_URL?.trim() || 'https://genealogical3.vercel.app';
  const repositoryUrl =
    env.PUBLIC_REPOSITORY_URL?.trim() || 'https://github.com/zenzontle/genealogical3';
  const privacyContactEmail = env.PRIVACY_CONTACT_EMAIL?.trim() || '';
  const app = parsePublicUrl(appUrl, 'PUBLIC_APP_URL');
  if (app.pathname !== '/' || app.search || app.hash) {
    throw new Error('PUBLIC_APP_URL must be the site origin without a path, query, or fragment.');
  }
  const repository = parsePublicUrl(repositoryUrl, 'PUBLIC_REPOSITORY_URL');
  if (
    repository.hostname !== 'github.com' ||
    repository.port ||
    repository.search ||
    repository.hash ||
    !/^\/[^/]+\/[^/]+\/?$/.test(repository.pathname)
  ) {
    throw new Error('PUBLIC_REPOSITORY_URL must be a GitHub repository URL.');
  }
  if (privacyContactEmail && !/^[^\s@<>"?]+@[^\s@<>"?]+\.[^\s@<>"?]+$/.test(privacyContactEmail)) {
    throw new Error('PRIVACY_CONTACT_EMAIL must be a single email address, or left empty.');
  }
  return {
    appUrl: app.origin,
    developerName,
    repositoryUrl: repository.href.replace(/\/$/, '').replace(/\.git$/, ''),
    privacyContactEmail,
  };
}

function parsePublicUrl(value: string, setting: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${setting} must be an absolute HTTPS URL.`);
  }
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error(`${setting} must be an HTTPS URL without embedded credentials.`);
  }
  return url;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function renderPrivacyPolicy(html: string, identity: PublicIdentity): string {
  const developerName = escapeHtml(identity.developerName);
  const introduction = `<p id="privacy-introduction">
    GENEalogical3 is a browser-based family tree editor maintained by ${developerName}.
    This policy explains how the app handles your information at
    <a href="${escapeHtml(identity.appUrl)}/">${escapeHtml(new URL(identity.appUrl).host)}</a>.
    You can use the editor without creating a GENEalogical3 account or connecting Google Drive.
  </p>`;
  const contact = identity.privacyContactEmail
    ? `<p id="privacy-contact">For privacy questions, contact ${developerName} at
        <a href="mailto:${encodeURIComponent(identity.privacyContactEmail)}">${escapeHtml(identity.privacyContactEmail)}</a>.
        Please do not send passwords, access tokens, or private family tree files.</p>`
    : `<p id="privacy-contact">For privacy questions, contact ${developerName} through the
        <a href="${escapeHtml(identity.repositoryUrl)}/issues">GENEalogical3 issue tracker</a>.
        GitHub issues are public: do not include private family details, tree files, passwords,
        or access tokens. Information you voluntarily submit there is handled by GitHub under its
        <a href="https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement">privacy statement</a>.</p>`;
  return html
    .replace(/<p id="privacy-introduction">[\s\S]*?<\/p>/, () => introduction)
    .replace(/<p id="privacy-contact">[\s\S]*?<\/p>/, () => contact);
}

export function renderTermsOfService(html: string, identity: PublicIdentity): string {
  const developerName = escapeHtml(identity.developerName);
  const introduction = `<p id="terms-introduction">
    These Terms of Service govern your use of GENEalogical3, a browser-based family tree editor
    provided by ${developerName} at
    <a href="${escapeHtml(identity.appUrl)}/">${escapeHtml(new URL(identity.appUrl).host)}</a>.
    By using the app, you agree to these terms. If you do not agree, please stop using the app.
  </p>`;
  const contact = identity.privacyContactEmail
    ? `<p id="terms-contact">For questions about these terms or the app, contact ${developerName} at
        <a href="mailto:${encodeURIComponent(identity.privacyContactEmail)}">${escapeHtml(identity.privacyContactEmail)}</a>.
        Please do not send passwords, access tokens, or private family tree files.</p>`
    : `<p id="terms-contact">For questions about these terms or the app, contact ${developerName} through the
        <a href="${escapeHtml(identity.repositoryUrl)}/issues">GENEalogical3 issue tracker</a>.
        GitHub issues are public: do not include private family details, tree files, passwords,
        or access tokens.</p>`;
  return html
    .replace(/<p id="terms-introduction">[\s\S]*?<\/p>/, () => introduction)
    .replace(/<p id="terms-contact">[\s\S]*?<\/p>/, () => contact);
}
