import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv, normalizePath, type Plugin, type PreviewServer } from 'vite';
import react from '@vitejs/plugin-react';
import { renderPrivacyPolicy, resolvePublicIdentity, type PublicIdentity } from './publicIdentity';

const root = fileURLToPath(new URL('.', import.meta.url));
const policyPath = fileURLToPath(new URL('./privacy-policy/index.html', import.meta.url));

function privacyPolicy(identity: PublicIdentity): Plugin {
  const rewritePolicyPath = (server: Pick<PreviewServer, 'middlewares'>) => {
    server.middlewares.use((request, _response, next) => {
      if (request.url?.split('?')[0] === '/privacy-policy') {
        request.url = request.url.replace('/privacy-policy', '/privacy-policy/index.html');
      }
      next();
    });
  };
  return {
    name: 'privacy-policy-contact',
    configureServer: rewritePolicyPath,
    configurePreviewServer: rewritePolicyPath,
    transformIndexHtml: {
      order: 'pre',
      handler(html, context) {
        if (normalizePath(context.filename) !== normalizePath(policyPath)) return html;
        return renderPrivacyPolicy(html, identity);
      },
    },
  };
}

export default defineConfig(({ mode }) => {
  const identity = resolvePublicIdentity(loadEnv(mode, root, ['PUBLIC_', 'PRIVACY_CONTACT_EMAIL']));
  return {
    plugins: [react(), privacyPolicy(identity)],
    define: {
      'import.meta.env.PUBLIC_APP_URL': JSON.stringify(identity.appUrl),
      'import.meta.env.PUBLIC_DEVELOPER_NAME': JSON.stringify(identity.developerName),
      'import.meta.env.PUBLIC_REPOSITORY_URL': JSON.stringify(identity.repositoryUrl),
    },
    build: {
      rollupOptions: {
        input: {
          main: fileURLToPath(new URL('./index.html', import.meta.url)),
          privacyPolicy: policyPath,
        },
      },
    },
  };
});
