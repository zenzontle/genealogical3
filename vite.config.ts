import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv, normalizePath, type Plugin, type PreviewServer } from 'vite';
import react from '@vitejs/plugin-react';
import { driveAuthDev } from './server/driveAuthDev';
import {
  renderPrivacyPolicy,
  renderTermsOfService,
  resolvePublicIdentity,
  type PublicIdentity,
} from './publicIdentity';

const root = fileURLToPath(new URL('.', import.meta.url));
const policyPath = fileURLToPath(new URL('./privacy-policy/index.html', import.meta.url));
const termsPath = fileURLToPath(new URL('./terms-of-service/index.html', import.meta.url));

function publicLegalPages(identity: PublicIdentity): Plugin {
  const rewriteLegalPath = (server: Pick<PreviewServer, 'middlewares'>) => {
    server.middlewares.use((request, _response, next) => {
      const path = request.url?.split('?')[0];
      if (path === '/privacy-policy' || path === '/terms-of-service') {
        request.url = request.url!.replace(path, `${path}/index.html`);
      }
      next();
    });
  };
  return {
    name: 'public-legal-pages',
    configureServer: rewriteLegalPath,
    configurePreviewServer: rewriteLegalPath,
    transformIndexHtml: {
      order: 'pre',
      handler(html, context) {
        const filename = normalizePath(context.filename);
        if (filename === normalizePath(policyPath)) return renderPrivacyPolicy(html, identity);
        if (filename === normalizePath(termsPath)) return renderTermsOfService(html, identity);
        return html;
      },
    },
  };
}

export default defineConfig(({ mode }) => {
  const identity = resolvePublicIdentity(loadEnv(mode, root, ['PUBLIC_', 'PRIVACY_CONTACT_EMAIL']));
  return {
    plugins: [
      react(),
      publicLegalPages(identity),
      driveAuthDev({
        ...process.env,
        ...loadEnv(mode, root, ['VITE_GOOGLE_CLIENT_ID', 'GOOGLE_', 'DRIVE_']),
      }),
    ],
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
          termsOfService: termsPath,
        },
        output: {
          manualChunks: {
            'react-vendor': ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client'],
            'flow-vendor': ['@xyflow/react'],
          },
        },
      },
    },
  };
});
