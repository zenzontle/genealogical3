// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { makeTree } from './model';

let fetchMock: ReturnType<typeof vi.fn>;
let open: MockInstance<typeof window.open>;
let popup: Window;
const channels = new Set<TestBroadcastChannel>();

class TestBroadcastChannel {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  constructor(readonly name: string) {
    channels.add(this);
  }
  postMessage = vi.fn((data: unknown) => {
    for (const channel of channels) {
      if (channel !== this && channel.name === this.name) {
        channel.onmessage?.(new MessageEvent('message', { data }));
      }
    }
  });
  close = vi.fn(() => channels.delete(this));
}

const tokenResponse = (token = 'token') =>
  new Response(JSON.stringify({ accessToken: token, expiresAt: Date.now() + 3600_000 }));
const disconnected = () =>
  new Response(JSON.stringify({ error: 'Not connected' }), { status: 401 });

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'client');
  vi.stubGlobal('BroadcastChannel', TestBroadcastChannel);
  popup = { closed: false, close: vi.fn() } as unknown as Window;
  open = vi.spyOn(window, 'open').mockReturnValue(popup);
  fetchMock = vi.fn().mockImplementation(async () => tokenResponse());
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  for (const channel of channels) channel.close();
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
  it('cancels an in-flight save before continuing with a broadcast account connection', async () => {
    const auth = await import('./driveAuth');
    const { saveDriveTree } = await import('./drive');
    await auth.restoreDrive();
    let finish!: (response: Response) => void;
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/drive-auth/token') return tokenResponse('other-account');
      return new Promise<Response>((resolve) => {
        finish = resolve;
      });
    });
    const pending = saveDriveTree(makeTree('Private tree'));
    const canceled = expect(pending).rejects.toThrow(/connection changed/i);
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    [...channels][0].onmessage?.(new MessageEvent('message', { data: 'connect' }));
    await vi.waitFor(() => expect(auth.getDriveConnection()).toBe('connected'));
    expect(await auth.driveAccessToken()).toBe('other-account');
    finish(new Response(JSON.stringify({ ids: ['old-account-file'] })));
    await canceled;
    const requests = fetchMock.mock.calls.filter(([url]) =>
      String(url).startsWith('https://www.googleapis.com/'),
    );
    expect(requests).toHaveLength(1);
    expect(requests[0][1].headers.Authorization).toBe('Bearer token');
    expect(open).not.toHaveBeenCalled();
  });
  it('reports the post-popup cookie failure in Workspace and retries interactive authorization', async () => {
    fetchMock.mockResolvedValueOnce(disconnected());
    const auth = await import('./driveAuth');
    const { useDriveWorkspace } = await import('../hooks/useDriveWorkspace');
    const { result, rerender } = renderHook(({ active }) => useDriveWorkspace(active), {
      initialProps: { active: true },
    });
    await waitFor(() => expect(result.current.connection).toBe('disconnected'));
    const generation = auth.getDriveGeneration();
    fetchMock.mockResolvedValueOnce(disconnected());
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.connect();
    });
    await act(async () => {
      message();
      await pending;
    });
    expect(auth.getDriveGeneration()).toBe(generation + 1);
    expect(result.current.error).toMatch(/Allow site cookies/);
    rerender({ active: false });
    rerender({ active: true });
    expect(result.current.error).toMatch(/Allow site cookies/);
    expect(result.current.ready).toBe(true);
    act(() => {
      pending = result.current.retry();
      expect(open).toHaveBeenCalledTimes(2);
    });
    await act(async () => {
      message();
      await pending;
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.connection).toBe('connected');
    expect(result.current.error).toBe('');
  });
  it('publishes restoration, explicit connection, expiration and cross-tab disconnect without sharing tokens', async () => {
    fetchMock.mockResolvedValueOnce(disconnected());
    const first = await import('./driveAuth');
    const listener = vi.fn();
    const unsubscribe = first.subscribeDriveConnection(listener);
    expect(first.getDriveConnection()).toBe('restoring');
    await first.restoreDrive();
    expect(first.getDriveConnection()).toBe('disconnected');
    const connecting = first.authorizeDrive();
    expect(first.getDriveConnection()).toBe('connecting');
    message();
    await connecting;
    expect(first.getDriveConnection()).toBe('connected');
    vi.resetModules();
    const second = await import('./driveAuth');
    await second.restoreDrive();
    await second.disconnectDrive();
    expect(first.getDriveConnection()).toBe('disconnected');
    expect(listener).toHaveBeenCalled();
    const calls = listener.mock.calls.length;
    unsubscribe();
    first.expireDriveConnection();
    expect(listener).toHaveBeenCalledTimes(calls);
    expect(open).toHaveBeenCalledOnce();
  });
  it('restores another tab silently after an explicit connection', async () => {
    fetchMock.mockResolvedValueOnce(disconnected());
    const first = await import('./driveAuth');
    await first.restoreDrive();
    vi.resetModules();
    const second = await import('./driveAuth');
    fetchMock.mockResolvedValueOnce(disconnected());
    await second.restoreDrive();
    const connecting = first.authorizeDrive();
    message();
    await connecting;
    await vi.waitFor(() => expect(second.getDriveConnection()).toBe('connected'));
    expect(open).toHaveBeenCalledOnce();
    expect([...channels][0].postMessage).toHaveBeenCalledWith('connect');
  });
  it('waits for stale renewal before restoring a cross-tab connection', async () => {
    const auth = await import('./driveAuth');
    let finish!: (response: Response) => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    const pending = auth.restoreDrive();
    const canceled = expect(pending).rejects.toThrow(/canceled/);
    [...channels][0].onmessage?.(new MessageEvent('message', { data: 'connect' }));
    finish(tokenResponse('stale'));
    await canceled;
    await vi.waitFor(() => expect(auth.getDriveConnection()).toBe('connected'));
    expect(await auth.driveAccessToken()).toBe('token');
    expect(open).not.toHaveBeenCalled();
  });
  it('clears other tabs only after successful disconnect and requires explicit reconnection', async () => {
    const firstTab = await import('./driveAuth');
    await firstTab.restoreDrive();
    vi.resetModules();
    const secondTab = await import('./driveAuth');
    await secondTab.restoreDrive();
    const [sender, receiver] = [...channels];
    expect(channels.size).toBe(2);

    let confirm!: (response: Response) => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          confirm = resolve;
        }),
    );
    const disconnect = firstTab.disconnectDrive();
    await vi.waitFor(() => expect(confirm).toBeTypeOf('function'));
    expect(await secondTab.driveAccessToken()).toBe('token');
    expect(sender.postMessage).not.toHaveBeenCalled();

    confirm(new Response('{}'));
    await disconnect;
    expect(sender.postMessage).toHaveBeenCalledExactlyOnceWith('disconnect');
    expect(receiver.postMessage).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    fetchMock.mockResolvedValueOnce(disconnected());
    await expect(secondTab.driveAccessToken()).rejects.toThrow(/reconnect/);
    const reconnect = secondTab.authorizeDrive();
    expect(open).toHaveBeenCalledOnce();
    message();
    await reconnect;
  });

  it('does not disconnect other tabs when the server rejects disconnect', async () => {
    const firstTab = await import('./driveAuth');
    await firstTab.restoreDrive();
    vi.resetModules();
    const secondTab = await import('./driveAuth');
    await secondTab.restoreDrive();
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 503 }));
    await expect(firstTab.disconnectDrive()).rejects.toThrow(/authentication failed/);
    expect(await secondTab.driveAccessToken()).toBe('token');
    await secondTab.authorizeDrive();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(open).not.toHaveBeenCalled();
    for (const channel of channels) expect(channel.postMessage).not.toHaveBeenCalled();
  });

  it('rejects a pending token response in another tab after receiving disconnect', async () => {
    const firstTab = await import('./driveAuth');
    await firstTab.restoreDrive();
    vi.resetModules();
    const secondTab = await import('./driveAuth');
    await secondTab.restoreDrive();
    let finish!: (response: Response) => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    const pending = secondTab.driveAccessToken(true);
    const canceled = expect(pending).rejects.toThrow(/canceled/);
    await firstTab.disconnectDrive();
    finish(tokenResponse('late-token'));
    await canceled;
    fetchMock.mockResolvedValueOnce(disconnected());
    await expect(secondTab.driveAccessToken()).rejects.toThrow(/reconnect/);
  });

  it("cancels another tab's authorization popup and ignores its late success message", async () => {
    const firstTab = await import('./driveAuth');
    await firstTab.restoreDrive();
    vi.resetModules();
    const secondTab = await import('./driveAuth');
    fetchMock.mockResolvedValueOnce(disconnected());
    await secondTab.restoreDrive();
    const pending = secondTab.authorizeDrive();
    const canceled = expect(pending).rejects.toThrow(/canceled/);
    await firstTab.disconnectDrive();
    await canceled;
    expect(popup.close).toHaveBeenCalledOnce();
    message();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    fetchMock.mockResolvedValueOnce(disconnected());
    await expect(secondTab.driveAccessToken()).rejects.toThrow(/reconnect/);
  });

  it('ignores unrelated messages on the authentication channel', async () => {
    const auth = await import('./driveAuth');
    await auth.restoreDrive();
    const unrelated = new TestBroadcastChannel('genealogical3-drive-auth');
    unrelated.postMessage({ type: 'disconnect' });
    unrelated.postMessage(null);
    expect(await auth.driveAccessToken()).toBe('token');
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('preserves single-tab authentication when BroadcastChannel is unavailable', async () => {
    vi.stubGlobal('BroadcastChannel', undefined);
    const auth = await import('./driveAuth');
    await auth.restoreDrive();
    await auth.disconnectDrive();
    expect(channels.size).toBe(0);
    expect(fetchMock.mock.calls.at(-1)?.[0]).toBe('/api/drive-auth/disconnect');
  });

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

  it("opens separate popups for concurrent tabs and accepts only each tab's own callback", async () => {
    const namedPopups = new Map<string, Window>();
    const opened: Window[] = [];
    open.mockImplementation((_url, target = '') => {
      const existing = target === '_blank' ? undefined : namedPopups.get(target);
      const next = existing ?? ({ closed: false, close: vi.fn() } as unknown as Window);
      if (target !== '_blank') namedPopups.set(target, next);
      opened.push(next);
      return next;
    });
    fetchMock.mockResolvedValueOnce(disconnected());
    const firstTab = await import('./driveAuth');
    await firstTab.restoreDrive();
    vi.resetModules();
    fetchMock.mockResolvedValueOnce(disconnected());
    const secondTab = await import('./driveAuth');
    await secondTab.restoreDrive();
    const first = firstTab.authorizeDrive();
    const firstResult = first.then(
      () => null,
      (error: unknown) => error,
    );
    const second = secondTab.authorizeDrive();
    expect(secondTab.authorizeDrive()).toBe(second);
    expect(open).toHaveBeenCalledTimes(2);
    const [firstPopup, secondPopup] = opened;
    message({ type: 'drive-auth' }, window.location.origin, secondPopup);
    await second;
    expect(firstPopup.close).not.toHaveBeenCalled();
    expect(secondPopup.close).toHaveBeenCalledOnce();
    expect(await secondTab.driveAccessToken()).toBe('token');
    message(
      { type: 'drive-auth', error: 'Authorization denied' },
      window.location.origin,
      firstPopup,
    );
    expect(await firstResult).toMatchObject({ message: 'Authorization denied' });
    expect(firstPopup).not.toBe(secondPopup);
    expect(fetchMock).toHaveBeenCalledTimes(3);
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

  it.each([
    ['retry', 'network'],
    ['retry', 'unavailable'],
    ['retry', 'malformed'],
    ['connect', 'network'],
    ['connect', 'unavailable'],
    ['connect', 'malformed'],
  ] as const)(
    'recovers Workspace %s after a rejected cached token and %s renewal failure',
    async (action, failure) => {
      fetchMock.mockImplementation(async (url: string) =>
        url === '/api/drive-auth/token'
          ? tokenResponse('replacement')
          : new Response(JSON.stringify({ files: [] })),
      );
      fetchMock.mockResolvedValueOnce(tokenResponse('rejected'));
      fetchMock.mockResolvedValueOnce(new Response('', { status: 401 }));
      if (failure === 'network') fetchMock.mockRejectedValueOnce(Error('offline'));
      else
        fetchMock.mockResolvedValueOnce(
          failure === 'unavailable'
            ? new Response('{}', { status: 503 })
            : new Response(JSON.stringify({ accessToken: 'invalid', expiresAt: 'invalid' })),
        );
      const auth = await import('./driveAuth');
      const { useDriveWorkspace } = await import('../hooks/useDriveWorkspace');
      const { result } = renderHook(() => useDriveWorkspace(true));
      await waitFor(() => expect(result.current.connection).toBe('error'));
      expect(result.current.error).toMatch(/retry/i);
      expect(result.current.loading).toBe(false);
      expect(fetchMock).toHaveBeenCalledTimes(3);
      const generation = auth.getDriveGeneration();

      await act(() => result.current[action]());
      await waitFor(() => expect(result.current.connection).toBe('connected'));
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.error).toBe('');
      expect(await auth.driveAccessToken()).toBe('replacement');
      expect(auth.getDriveGeneration()).toBe(generation);
      expect(fetchMock).toHaveBeenCalledTimes(5);
      const requests = fetchMock.mock.calls.filter(([url]) =>
        String(url).startsWith('https://www.googleapis.com/'),
      );
      expect(requests).toHaveLength(2);
      expect(requests[0][1].headers.Authorization).toBe('Bearer rejected');
      expect(requests[1][1].headers.Authorization).toBe('Bearer replacement');
      expect(open).not.toHaveBeenCalled();
    },
  );

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
