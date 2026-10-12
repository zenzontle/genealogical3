import type { Plugin, PreviewServer } from 'vite';
import { handleDriveAuth } from './driveAuth';

export function driveAuthDev(env: NodeJS.ProcessEnv): Plugin {
  const configure = (server: Pick<PreviewServer, 'middlewares'>) => {
    server.middlewares.use((request, response, next) => {
      if (!request.url?.startsWith('/api/drive-auth/')) return next();
      void handleDriveAuth(request, response, env);
    });
  };
  return { name: 'drive-auth', configureServer: configure, configurePreviewServer: configure };
}
