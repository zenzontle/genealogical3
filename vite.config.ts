import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv, normalizePath, type Plugin, type PreviewServer } from 'vite';
import react from '@vitejs/plugin-react';
import { driveAuthDev } from './server/driveAuthDev';
import { canonicalPagePath, discoverHtmlPages, htmlPagePath } from './publicPages';
import {
  renderPrivacyPolicy,
  renderTermsOfService,
  resolvePublicIdentity,
  type PublicIdentity,
} from './publicIdentity';

const root = fileURLToPath(new URL('.', import.meta.url));
const policyPath = fileURLToPath(new URL('./privacy-policy/index.html', import.meta.url));
const termsPath = fileURLToPath(new URL('./terms-of-service/index.html', import.meta.url));

function publicPages(identity: PublicIdentity, pages: string[]): Plugin {
  const routes = new Map<string, string>();
  for (const filename of pages) {
    const path = canonicalPagePath(root, filename);
    if (routes.has(path)) throw new Error(`Multiple HTML pages resolve to ${path}.`);
    routes.set(path, htmlPagePath(root, filename));
  }
  const rewritePagePath = (server: Pick<PreviewServer, 'middlewares'>) => {
    server.middlewares.use((request, _response, next) => {
      const path = request.url?.split('?')[0];
      if (path) {
        const destination = routes.get(path.replace(/\/$/, '') || '/');
        if (destination) request.url = destination + request.url!.slice(path.length);
      }
      next();
    });
  };
  return {
    name: 'public-pages',
    configureServer: rewritePagePath,
    configurePreviewServer: rewritePagePath,
    transformIndexHtml: {
      order: 'pre',
      handler(html, context) {
        const filename = normalizePath(context.filename);
        if (filename === normalizePath(policyPath)) {
          html = renderPrivacyPolicy(html, identity);
        } else if (filename === normalizePath(termsPath)) {
          html = renderTermsOfService(html, identity);
        }
        return {
          html,
          tags: [
            {
              tag: 'link',
              attrs: {
                rel: 'canonical',
                href: `${identity.appUrl}${canonicalPagePath(root, filename)}`,
              },
              injectTo: 'head',
            },
          ],
        };
      },
    },
  };
}

export default defineConfig(({ mode }) => {
  const identity = resolvePublicIdentity(loadEnv(mode, root, ['PUBLIC_', 'PRIVACY_CONTACT_EMAIL']));
  const pages = discoverHtmlPages(root);
  return {
    plugins: [
      react(),
      publicPages(identity, pages),
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
        input: pages,
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
