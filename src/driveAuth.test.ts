// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

let fetchMock: ReturnType<typeof vi.fn>;
let open: MockInstance<typeof window.open>;
let popup: Window;
const tokenResponse = (token = 'token') =>
  new Response(JSON.stringify({ accessToken: token, expiresAt: Date.now() + 3600_000 }));
const disconnected = () =>
  new Response(JSON.stringify({ error: 'Not connected' }), { status: 401 });

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'client');
  popup = { closed: false, close: vi.fn() } as unknown as Window;
  open = vi.spyOn(window, 'open').mockReturnValue(popup);
  fetchMock = vi.fn().mockImplementation(async () => tokenResponse());
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function message(
  data: unknown = { type: 'drive-auth' },
  origin = window.location.origin,
  source: Window = popup,
) {
  window.dispatchEvent(new MessageEvent('message', { data, origin, source }));
}

describe('Drive authorization lifecycle', () => {
  it('restores remembered access and reuses it for repeated explicit actions', async () => {
    const auth = await import('./driveAuth');
    await auth.restoreDrive();
    await auth.authorizeDrive();
    await auth.authorizeDrive();
    expect(await auth.driveAccessToken()).toBe('token');
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/drive-auth/token',
      expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'X-Requested-With': 'GENEalogical3' },
      }),
    );
    expect(open).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it('restores after a new page/browser instance without prompting Google', async () => {
    const firstPage = await import('./driveAuth');
    await firstPage.restoreDrive();
    vi.resetModules();
    const nextPage = await import('./driveAuth');
    await nextPage.restoreDrive();
    await nextPage.authorizeDrive();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(open).not.toHaveBeenCalled();
  });

  it('opens one popup synchronously on an explicit action and continues after valid success', async () => {
    fetchMock.mockResolvedValueOnce(disconnected());
    const auth = await import('./driveAuth');
    await auth.restoreDrive();
    const pending = auth.authorizeDrive();
    expect(open).toHaveBeenCalledOnce();
    const same = auth.authorizeDrive();
    expect(same).toBe(pending);
    message({ type: 'drive-auth' }, 'https://evil.example');
    message({ type: 'drive-auth' }, window.location.origin, {} as Window);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    message();
    await pending;
    expect(popup.close).toHaveBeenCalledOnce();
    expect(await auth.driveAccessToken()).toBe('token');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('renews near expiry and shares concurrent restoration and renewal', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(100_000);
    const auth = await import('./driveAuth');
    await Promise.all([auth.restoreDrive(), auth.restoreDrive()]);
    expect(fetchMock).toHaveBeenCalledOnce();
    vi.spyOn(Date, 'now').mockReturnValue(100_000 + 3540_000);
    await Promise.all([auth.authorizeDrive(), auth.authorizeDrive(), auth.driveAccessToken()]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(open).not.toHaveBeenCalled();
  });

  it('requires a new explicit click when renewal discovers revoked access', async () => {
    const auth = await import('./driveAuth');
    await auth.restoreDrive();
    fetchMock.mockResolvedValueOnce(disconnected());
    await expect(auth.driveAccessToken(true)).rejects.toThrow(/reconnect/);
    expect(open).not.toHaveBeenCalled();
    const reconnect = auth.authorizeDrive();
    message();
    await reconnect;
    expect(open).toHaveBeenCalledOnce();
  });

  it('reports temporary authentication failures without opening sign-in', async () => {
    fetchMock.mockRejectedValueOnce(Error('offline'));
    const auth = await import('./driveAuth');
    await expect(auth.restoreDrive()).rejects.toThrow(/Please retry/);
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Service unavailable. Please retry.' }), {
        status: 502,
      }),
    );
    await expect(auth.authorizeDrive()).rejects.toThrow(/Service unavailable/);
    expect(open).not.toHaveBeenCalled();
    await auth.authorizeDrive();
    expect(await auth.driveAccessToken()).toBe('token');
  });

  it.each(['blocked', 'closed', 'denied', 'timeout'])(
    'handles a %s popup without restoring access',
    async (failure) => {
      fetchMock.mockResolvedValueOnce(disconnected());
      const auth = await import('./driveAuth');
      await auth.restoreDrive();
      if (failure === 'blocked') open.mockReturnValue(null);
      vi.useFakeTimers();
      const pending = auth.authorizeDrive();
      const expectation = expect(pending).rejects.toThrow(/blocked|canceled|denied|timed out/);
      if (failure === 'closed') {
        Object.defineProperty(popup, 'closed', { value: true });
        await vi.advanceTimersByTimeAsync(250);
      }
      if (failure === 'denied')
        message({
          type: 'drive-auth',
          error: 'Google Drive authorization was canceled or denied.',
        });
      if (failure === 'timeout') await vi.advanceTimersByTimeAsync(90_000);
      await expectation;
      expect(fetchMock).toHaveBeenCalledOnce();
    },
  );

  it('does not claim a connection if site cookies were blocked', async () => {
    fetchMock.mockImplementation(async () => disconnected());
    const auth = await import('./driveAuth');
    await auth.restoreDrive();
    const pending = auth.authorizeDrive();
    message();
    await expect(pending).rejects.toThrow(/Allow site cookies/);
  });

  it('awaits disconnect confirmation and ignores late popup messages', async () => {
    fetchMock.mockResolvedValueOnce(disconnected());
    const auth = await import('./driveAuth');
    await auth.restoreDrive();
    const pending = auth.authorizeDrive();
    const canceled = expect(pending).rejects.toThrow(/canceled/);
    let confirm!: (response: Response) => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          confirm = resolve;
        }),
    );
    const disconnect = auth.disconnectDrive();
    await canceled;
    await vi.waitFor(() => expect(confirm).toBeTypeOf('function'));
    await expect(auth.authorizeDrive()).rejects.toThrow(/disconnecting/);
    message();
    confirm(new Response('{}'));
    await disconnect;
    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe('/api/drive-auth/disconnect');
    const next = auth.authorizeDrive();
    message();
    await next;
    expect(open).toHaveBeenCalledTimes(2);
  });

  it('waits for an in-flight token before clearing cookies and rejects its stale token', async () => {
    const auth = await import('./driveAuth');
    let finish!: (response: Response) => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    const restoring = auth.restoreDrive();
    const stale = expect(restoring).rejects.toThrow(/canceled/);
    const disconnect = auth.disconnectDrive();
    expect(fetchMock).toHaveBeenCalledOnce();
    finish(tokenResponse('stale-token'));
    await stale;
    await disconnect;
    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe('/api/drive-auth/disconnect');
    const next = auth.authorizeDrive();
    message();
    await next;
    expect(await auth.driveAccessToken()).toBe('token');
  });

  it('reports a failed disconnect rather than claiming it forgot the browser', async () => {
    const auth = await import('./driveAuth');
    await auth.restoreDrive();
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Disconnect failed. Please retry.' }), { status: 503 }),
    );
    await expect(auth.disconnectDrive()).rejects.toThrow(/Disconnect failed/);
    await auth.authorizeDrive();
    expect(open).not.toHaveBeenCalled();
  });

  it.each([
    null,
    { accessToken: '', expiresAt: Date.now() + 10000 },
    { accessToken: 'token', expiresAt: 0 },
    { accessToken: 'token', expiresAt: 'bad' },
  ])('rejects malformed access: %j', async (body) => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body)));
    const auth = await import('./driveAuth');
    await expect(auth.restoreDrive()).rejects.toThrow(/invalid authentication/);
    expect(open).not.toHaveBeenCalled();
  });

  it('does not restore or start authentication when Drive is unconfigured', async () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', '');
    const auth = await import('./driveAuth');
    await auth.restoreDrive();
    await expect(auth.authorizeDrive()).rejects.toThrow(/not configured/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });
});
