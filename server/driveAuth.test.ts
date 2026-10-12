import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleDriveAuth } from './driveAuth';

const browserFetch = globalThis.fetch;
const startTime = Date.UTC(2026, 9, 11);
const thirtyDays = 30 * 24 * 60 * 60 * 1000;
let env: NodeJS.ProcessEnv;
let server: Server;
let baseUrl: string;
let jar: Map<string, string>;
let google: ReturnType<typeof vi.fn>;

beforeAll(async () => {
  server = createServer((request, response) => {
    void handleDriveAuth(request, response, env);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});
beforeEach(() => {
  env = {
    VITE_GOOGLE_CLIENT_ID: 'client',
    GOOGLE_CLIENT_SECRET: 'server-secret',
    DRIVE_SESSION_KEY: 'a1'.repeat(32),
    DRIVE_APP_ORIGIN: 'https://app.example',
    NODE_ENV: 'production',
  };
  jar = new Map();
  vi.spyOn(Date, 'now').mockReturnValue(startTime);
  google = vi.fn().mockImplementation(
    async () =>
      new Response(
        JSON.stringify({
          access_token: 'short-lived-token',
          refresh_token: 'private-refresh-token',
          expires_in: 3600,
          scope: 'https://www.googleapis.com/auth/drive.file',
        }),
      ),
  );
  vi.stubGlobal('fetch', google);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function request(path: string, method = 'POST', headers: Record<string, string> = {}) {
  const response = await browserFetch(`${baseUrl}/api/drive-auth/${path}`, {
    method,
    redirect: 'manual',
    headers: {
      Cookie: [...jar].map(([name, value]) => `${name}=${value}`).join('; '),
      Origin: env.DRIVE_APP_ORIGIN!,
      'X-Requested-With': 'GENEalogical3',
      ...headers,
    },
  });
  for (const cookie of response.headers.getSetCookie()) {
    const [pair] = cookie.split(';');
    const index = pair.indexOf('=');
    const name = pair.slice(0, index);
    if (cookie.includes('Max-Age=0')) jar.delete(name);
    else jar.set(name, pair.slice(index + 1));
  }
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  return response;
}
async function begin() {
  const response = await request('start', 'GET');
  expect(response.status).toBe(302);
  return new URL(response.headers.get('Location')!);
}
async function connect() {
  const url = await begin();
  const response = await request(
    `callback?state=${url.searchParams.get('state')}&code=test-code`,
    'GET',
  );
  expect(response.status).toBe(200);
  await response.text();
  return url;
}

describe('remembered Drive authentication HTTP endpoints', () => {
  it('requests offline drive.file consent and remembers access with encrypted secure cookies', async () => {
    const url = await connect();
    expect(url.origin).toBe('https://accounts.google.com');
    expect(url.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/drive.file');
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent select_account');
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://app.example/api/drive-auth/callback',
    );
    expect(jar.get('drive_session')).not.toContain('private-refresh-token');
    expect(jar.has('drive_oauth_state')).toBe(false);
    const originalSession = jar.get('drive_session');
    vi.spyOn(Date, 'now').mockReturnValue(startTime + 20 * 24 * 60 * 60 * 1000);
    const token = await request('token');
    expect(await token.json()).toEqual({
      accessToken: 'short-lived-token',
      expiresAt: Date.now() + 3600_000,
    });
    expect(token.headers.getSetCookie()).toEqual([]);
    expect(jar.get('drive_session')).toBe(originalSession);
    const parameters = new URLSearchParams(google.mock.calls[1][1].body);
    expect(parameters.get('refresh_token')).toBe('private-refresh-token');
    expect(parameters.get('client_secret')).toBe('server-secret');
  });

  it('sets host-only persistent Secure HttpOnly SameSite cookies and a nonce-protected popup response', async () => {
    const url = await begin();
    const response = await request(
      `callback?state=${url.searchParams.get('state')}&code=code`,
      'GET',
    );
    const session = response.headers
      .getSetCookie()
      .find((cookie) => cookie.startsWith('drive_session='))!;
    expect(session).toContain('HttpOnly; SameSite=Lax; Max-Age=2592000; Secure');
    expect(session).not.toContain('Domain=');
    expect(response.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
    const html = await response.text();
    expect(html).toContain('postMessage');
    expect(html).toContain('https://app.example');
    expect(html).not.toMatch(/private-refresh-token|short-lived-token|test-code|server-secret/);
  });

  it.each([thirtyDays - 1, thirtyDays, thirtyDays + 1])(
    'enforces the absolute deadline at %i ms',
    async (elapsed) => {
      await connect();
      google.mockClear();
      vi.spyOn(Date, 'now').mockReturnValue(startTime + elapsed);
      const response = await request('token');
      expect(response.status).toBe(elapsed < thirtyDays ? 200 : 401);
      expect(google).toHaveBeenCalledTimes(elapsed < thirtyDays ? 1 : 0);
      if (elapsed < thirtyDays)
        expect((await response.json()).expiresAt).toBe(startTime + thirtyDays);
    },
  );

  it('forgets the browser without revoking Google permission', async () => {
    await connect();
    google.mockClear();
    expect((await request('disconnect')).status).toBe(200);
    expect(jar.size).toBe(0);
    expect((await request('token')).status).toBe(401);
    expect(google).not.toHaveBeenCalled();
  });

  it.each(['closed', 'denied', 'expired', 'exchange-failed'])(
    'preserves remembered access when another authorization is %s',
    async (failure) => {
      await connect();
      const originalSession = jar.get('drive_session');
      const originalBinding = jar.get('drive_binding');
      vi.spyOn(Date, 'now').mockReturnValue(startTime + 20 * 24 * 60 * 60 * 1000);
      const url = await begin();
      expect(jar.get('drive_binding')).toBe(originalBinding);
      expect(jar.get('drive_session')).toBe(originalSession);

      if (failure !== 'closed') {
        if (failure === 'expired') vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 600_000);
        if (failure === 'exchange-failed') google.mockRejectedValueOnce(Error('offline'));
        const tail = failure === 'denied' ? '&error=access_denied' : '&code=code';
        const callback = await request(
          `callback?state=${url.searchParams.get('state')}${tail}`,
          'GET',
        );
        expect(callback.status).toBe(failure === 'exchange-failed' ? 502 : 400);
      }
      const token = await request('token');
      expect(token.status).toBe(200);
      expect((await token.json()).accessToken).toBe('short-lived-token');
      expect(jar.get('drive_session')).toBe(originalSession);
      vi.spyOn(Date, 'now').mockReturnValue(startTime + thirtyDays);
      expect((await request('token')).status).toBe(401);
    },
  );

  it('uses fresh state for another authorization and replaces the session only on success', async () => {
    const original = await connect();
    const originalSession = jar.get('drive_session');
    const originalBinding = jar.get('drive_binding');
    const url = await begin();
    expect(url.searchParams.get('state')).not.toBe(original.searchParams.get('state'));
    expect(jar.get('drive_binding')).toBe(originalBinding);
    google.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          access_token: 'new-token',
          refresh_token: 'new-refresh',
          expires_in: 3600,
        }),
      ),
    );
    expect(
      (await request(`callback?state=${url.searchParams.get('state')}&code=code`, 'GET')).status,
    ).toBe(200);
    expect(jar.get('drive_session')).not.toBe(originalSession);
    expect((await request('token')).status).toBe(200);
    const parameters = new URLSearchParams(google.mock.calls.at(-1)![1].body);
    expect(parameters.get('refresh_token')).toBe('new-refresh');
  });

  it('creates a new browser binding after disconnect and rejects the old authorization state', async () => {
    await connect();
    const originalBinding = jar.get('drive_binding');
    const oldAttempt = await begin();
    const oldState = jar.get('drive_oauth_state')!;
    await request('disconnect');
    await connect();
    expect(jar.get('drive_binding')).not.toBe(originalBinding);
    jar.set('drive_oauth_state', oldState);
    google.mockClear();
    expect(
      (await request(`callback?state=${oldAttempt.searchParams.get('state')}&code=code`, 'GET'))
        .status,
    ).toBe(400);
    expect(google).not.toHaveBeenCalled();
    expect((await request('token')).status).toBe(200);
  });

  it('rejects a late callback cookie after disconnect clears its separate binding', async () => {
    const url = await begin();
    let finishExchange!: (response: Response) => void;
    google.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          finishExchange = resolve;
        }),
    );
    const callback = request(`callback?state=${url.searchParams.get('state')}&code=code`, 'GET');
    await vi.waitFor(() => expect(google).toHaveBeenCalledOnce());
    await request('disconnect');
    finishExchange(
      new Response(
        JSON.stringify({ access_token: 'token', refresh_token: 'refresh', expires_in: 3600 }),
      ),
    );
    expect((await callback).status).toBe(200);
    expect(jar.has('drive_session')).toBe(true);
    expect(jar.has('drive_binding')).toBe(false);
    expect((await request('token')).status).toBe(401);
  });

  it.each(['wrong-state', 'expired-state', 'missing-binding', 'denied', 'missing-code'])(
    'rejects %s without establishing a connection',
    async (failure) => {
      const url = await begin();
      if (failure === 'expired-state') vi.spyOn(Date, 'now').mockReturnValue(startTime + 600_000);
      if (failure === 'missing-binding') jar.delete('drive_binding');
      const state = failure === 'wrong-state' ? 'wrong' : url.searchParams.get('state');
      const tail =
        failure === 'denied'
          ? '&error=access_denied'
          : failure === 'missing-code'
            ? ''
            : '&code=code';
      const response = await request(`callback?state=${state}${tail}`, 'GET');
      expect(response.status).toBe(400);
      expect(jar.has('drive_session')).toBe(false);
      expect(google).not.toHaveBeenCalled();
    },
  );

  it.each(['tampered', 'malformed', 'changed-key', 'changed-client'])(
    'rejects a %s session',
    async (failure) => {
      await connect();
      google.mockClear();
      if (failure === 'tampered') {
        const session = jar.get('drive_session')!;
        jar.set('drive_session', `${session[0] === 'Z' ? 'Y' : 'Z'}${session.slice(1)}`);
      }
      if (failure === 'malformed') jar.set('drive_session', '%invalid');
      if (failure === 'changed-key') env.DRIVE_SESSION_KEY = 'b2'.repeat(32);
      if (failure === 'changed-client') env.VITE_GOOGLE_CLIENT_ID = 'other-client';
      expect((await request('token')).status).toBe(401);
      expect(google).not.toHaveBeenCalled();
    },
  );

  it.each(['token', 'disconnect'])(
    'rejects cross-origin and missing-header %s requests',
    async (action) => {
      await connect();
      google.mockClear();
      expect((await request(action, 'POST', { Origin: 'https://evil.example' })).status).toBe(403);
      expect((await request(action, 'POST', { 'X-Requested-With': '' })).status).toBe(403);
      expect((await request(action, 'GET')).status).toBe(405);
      expect(jar.has('drive_session')).toBe(true);
      expect(google).not.toHaveBeenCalled();
    },
  );

  it('clears revoked access but preserves the connection after transient Google failures', async () => {
    await connect();
    google.mockRejectedValueOnce(Error('offline'));
    expect((await request('token')).status).toBe(502);
    expect(jar.has('drive_session')).toBe(true);
    google.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'server_error' }), { status: 503 }),
    );
    expect((await request('token')).status).toBe(502);
    expect(jar.has('drive_session')).toBe(true);
    google.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }),
    );
    expect((await request('token')).status).toBe(401);
    expect(jar.has('drive_session')).toBe(false);
  });

  it.each([
    { access_token: 'token', expires_in: 3600 },
    { refresh_token: 'refresh', expires_in: 3600 },
    { access_token: 'token', refresh_token: 'refresh', expires_in: -1 },
    { access_token: 'token', refresh_token: 'refresh', expires_in: 3600, scope: 'other-scope' },
  ])('rejects incomplete Google tokens: %j', async (tokens) => {
    google.mockResolvedValueOnce(new Response(JSON.stringify(tokens)));
    const url = await begin();
    expect(
      (await request(`callback?state=${url.searchParams.get('state')}&code=code`, 'GET')).status,
    ).not.toBe(200);
    expect(jar.has('drive_session')).toBe(false);
  });

  it('reports missing server configuration inside the popup', async () => {
    delete env.GOOGLE_CLIENT_SECRET;
    const response = await request('start', 'GET');
    expect(response.status).toBe(503);
    expect(await response.text()).toContain('not configured');
    expect(google).not.toHaveBeenCalled();
  });

  it('allows non-Secure cookies only on development localhost', async () => {
    env.DRIVE_APP_ORIGIN = 'http://localhost:5173';
    expect((await request('start', 'GET')).status).toBe(503);
    env.NODE_ENV = 'development';
    const response = await request('start', 'GET');
    expect(response.status).toBe(302);
    expect(response.headers.getSetCookie().join(';')).not.toContain('Secure');
    env.DRIVE_APP_ORIGIN = 'http://public.example';
    expect((await request('start', 'GET')).status).toBe(503);
  });
});
