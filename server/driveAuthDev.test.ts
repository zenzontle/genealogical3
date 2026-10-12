import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { preview, type PreviewServer } from 'vite';
import { driveAuthDev } from './driveAuthDev';

const env: NodeJS.ProcessEnv = {
  VITE_GOOGLE_CLIENT_ID: 'client',
  GOOGLE_CLIENT_SECRET: 'server-secret',
  DRIVE_SESSION_KEY: 'a1'.repeat(32),
  NODE_ENV: 'production',
};
let server: PreviewServer;
let baseUrl: string;

beforeAll(async () => {
  vi.stubEnv('NODE_ENV', 'production');
  server = await preview({
    configFile: false,
    envFile: false,
    mode: 'production',
    logLevel: 'silent',
    plugins: [driveAuthDev(env)],
    preview: { host: '127.0.0.1', port: 0, strictPort: true },
  });
  baseUrl = `http://127.0.0.1:${(server.httpServer.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await server?.close();
  vi.unstubAllEnvs();
});

describe('Drive authentication in production-mode Vite preview', () => {
  it.each([
    ['http://localhost:4173', 302, false],
    ['http://127.0.0.1:4173', 302, false],
    ['http://[::1]:4173', 302, false],
    ['http://public.example', 503, false],
    ['https://app.example', 302, true],
  ])('validates %s and applies the correct cookie security', async (origin, status, secure) => {
    env.DRIVE_APP_ORIGIN = origin;
    expect(server.config.mode).toBe('production');
    expect(server.config.isProduction).toBe(true);
    const response = await fetch(`${baseUrl}/api/drive-auth/start`, { redirect: 'manual' });
    expect(response.status).toBe(status);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    if (status === 302) {
      const authorization = new URL(response.headers.get('Location')!);
      expect(authorization.searchParams.get('redirect_uri')).toBe(
        `${origin}/api/drive-auth/callback`,
      );
      expect(response.headers.getSetCookie()).toHaveLength(2);
      for (const cookie of response.headers.getSetCookie()) {
        expect(cookie).toContain('HttpOnly; SameSite=Lax;');
        expect(cookie.includes('; Secure')).toBe(secure);
      }
    } else {
      expect(response.headers.getSetCookie()).toEqual([]);
      expect(await response.text()).toContain('not configured');
    }
  });
});
