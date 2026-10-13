// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDriveWorkspace } from './useDriveWorkspace';
import { authorizeDrive, listDriveTrees, restoreDrive, type DriveFile } from './drive';
import type { DriveConnection } from './driveAuth';

const auth = vi.hoisted(() => ({
  configured: true,
  status: 'restoring' as DriveConnection,
  generation: 0,
  listeners: new Set<() => void>(),
}));
vi.mock('./drive', () => ({
  get driveConfigured() {
    return auth.configured;
  },
  getDriveConnection: () => auth.status,
  getDriveGeneration: () => auth.generation,
  subscribeDriveConnection: (listener: () => void) => {
    auth.listeners.add(listener);
    return () => auth.listeners.delete(listener);
  },
  restoreDrive: vi.fn(),
  authorizeDrive: vi.fn(),
  listDriveTrees: vi.fn(),
}));
function connection(status: DriveConnection) {
  auth.status = status;
  auth.listeners.forEach((listener) => listener());
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const file: DriveFile = {
  id: 'remote',
  name: 'Remote.genealogical3.json',
  modifiedTime: '2026-10-10',
};
beforeEach(() => {
  vi.resetAllMocks();
  auth.configured = true;
  auth.status = 'restoring';
  auth.generation = 0;
  auth.listeners.clear();
  vi.mocked(restoreDrive).mockImplementation(async () => connection('connected'));
  vi.mocked(authorizeDrive).mockImplementation(async () => connection('connected'));
  vi.mocked(listDriveTrees).mockResolvedValue([file]);
});
afterEach(cleanup);

describe('Workspace metadata discovery', () => {
  it.each(['unconfigured', 'disconnected'] as const)(
    'does not list or authorize for %s sessions',
    async (status) => {
      auth.status = status;
      auth.configured = status !== 'unconfigured';
      vi.mocked(restoreDrive).mockImplementation(async () => connection(status));
      const { result } = renderHook(() => useDriveWorkspace(true));
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(listDriveTrees).not.toHaveBeenCalled();
      expect(authorizeDrive).not.toHaveBeenCalled();
      if (!auth.configured) expect(restoreDrive).not.toHaveBeenCalled();
    },
  );
  it('lists after restoration and when returning to Workspace, without interactive authentication', async () => {
    const { result, rerender } = renderHook(({ active }) => useDriveWorkspace(active), {
      initialProps: { active: true },
    });
    await waitFor(() => expect(result.current.files).toEqual([file]));
    rerender({ active: false });
    rerender({ active: true });
    await waitFor(() => expect(listDriveTrees).toHaveBeenCalledTimes(2));
    expect(authorizeDrive).not.toHaveBeenCalled();
  });
  it('discovers after startup restoration even if a local editor was opened', async () => {
    const restored = deferred<void>();
    vi.mocked(restoreDrive).mockReturnValue(restored.promise);
    const { result } = renderHook(() => useDriveWorkspace(false));
    await act(async () => {
      connection('connected');
      restored.resolve();
    });
    await waitFor(() => expect(result.current.files).toEqual([file]));
  });
  it('connects only on an explicit action and immediately lists an empty Drive', async () => {
    vi.mocked(restoreDrive).mockImplementation(async () => connection('disconnected'));
    vi.mocked(listDriveTrees).mockResolvedValue([]);
    const { result } = renderHook(() => useDriveWorkspace(true));
    await waitFor(() => expect(result.current.connection).toBe('disconnected'));
    await act(() => result.current.connect());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(authorizeDrive).toHaveBeenCalledOnce();
    expect(listDriveTrees).toHaveBeenCalledOnce();
    expect(result.current.files).toEqual([]);
  });
  it('exposes listing failures and supports Retry', async () => {
    vi.mocked(listDriveTrees).mockRejectedValueOnce(Error('Listing failed'));
    const { result } = renderHook(() => useDriveWorkspace(true));
    await waitFor(() => expect(result.current.error).toBe('Listing failed'));
    expect(result.current.loading).toBe(false);
    await act(() => result.current.retry());
    expect(result.current.files).toEqual([file]);
    expect(result.current.error).toBe('');
  });
  it.each([
    'Google sign-in was blocked. Allow popups for this site and retry.',
    'Google Drive authorization was canceled or denied.',
    'Access denied',
    'Google authorization was canceled or timed out.',
  ])('preserves explicit connection failure: %s', async (message) => {
    vi.mocked(restoreDrive).mockImplementation(async () => connection('disconnected'));
    vi.mocked(authorizeDrive).mockImplementationOnce(async () => {
      connection('connecting');
      connection('disconnected');
      throw Error(message);
    });
    const { result, rerender } = renderHook(({ active }) => useDriveWorkspace(active), {
      initialProps: { active: true },
    });
    await waitFor(() => expect(result.current.connection).toBe('disconnected'));
    await act(() => result.current.connect());
    expect(result.current.error).toBe(message);
    expect(result.current.ready).toBe(true);
    expect(listDriveTrees).not.toHaveBeenCalled();
    rerender({ active: false });
    rerender({ active: true });
    expect(result.current.error).toBe(message);
    await act(async () => {
      ++auth.generation;
      connection('disconnected');
    });
    expect(result.current.error).toBe('');
  });
  it('clears a connection failure on a new attempt and lists after it succeeds', async () => {
    vi.mocked(restoreDrive).mockImplementation(async () => connection('disconnected'));
    vi.mocked(authorizeDrive).mockImplementationOnce(async () => {
      connection('connecting');
      connection('disconnected');
      throw Error('Access denied');
    });
    const { result } = renderHook(() => useDriveWorkspace(true));
    await waitFor(() => expect(result.current.connection).toBe('disconnected'));
    await act(() => result.current.connect());
    expect(result.current.error).toBe('Access denied');
    const pending = deferred<void>();
    vi.mocked(authorizeDrive).mockImplementationOnce(() => {
      connection('connecting');
      return pending.promise;
    });
    let attempt!: Promise<void>;
    act(() => {
      attempt = result.current.connect();
    });
    expect(result.current.error).toBe('');
    expect(result.current.loading).toBe(true);
    await act(async () => {
      connection('connected');
      pending.resolve();
      await attempt;
    });
    await waitFor(() => expect(result.current.files).toEqual([file]));
    expect(result.current.error).toBe('');
  });
  it('clears stale listing feedback through a disconnecting session transition', async () => {
    vi.mocked(listDriveTrees).mockRejectedValueOnce(Error('Listing failed'));
    const { result } = renderHook(() => useDriveWorkspace(true));
    await waitFor(() => expect(result.current.error).toBe('Listing failed'));
    await act(async () => {
      ++auth.generation;
      connection('disconnecting');
    });
    await act(async () => connection('disconnected'));
    expect(result.current.error).toBe('');
    expect(result.current.ready).toBe(true);
  });
  it('retries a failed session restoration without opening sign-in', async () => {
    vi.mocked(restoreDrive).mockImplementationOnce(async () => {
      connection('error');
      throw Error('Auth unavailable');
    });
    const { result } = renderHook(() => useDriveWorkspace(true));
    await waitFor(() => expect(result.current.error).toBe('Auth unavailable'));
    await act(() => result.current.retry());
    await waitFor(() => expect(result.current.files).toEqual([file]));
    expect(authorizeDrive).not.toHaveBeenCalled();
  });
  it.each(['resolve', 'reject'] as const)(
    'ignores a stale %s after cross-tab disconnect',
    async (completion) => {
      const listing = deferred<DriveFile[]>();
      vi.mocked(listDriveTrees).mockReturnValueOnce(listing.promise);
      const { result } = renderHook(() => useDriveWorkspace(true));
      await waitFor(() => expect(listDriveTrees).toHaveBeenCalledOnce());
      await act(async () => {
        ++auth.generation;
        connection('disconnected');
      });
      await act(async () => {
        if (completion === 'resolve') listing.resolve([file]);
        else listing.reject(Error('Stale error'));
      });
      expect(result.current.files).toEqual([]);
      expect(result.current.error).toBe('');
      expect(result.current.loading).toBe(false);
    },
  );
  it('ignores an older listing response after a newer refresh', async () => {
    const older = deferred<DriveFile[]>();
    vi.mocked(listDriveTrees).mockReturnValueOnce(older.promise);
    const { result } = renderHook(() => useDriveWorkspace(true));
    await waitFor(() => expect(listDriveTrees).toHaveBeenCalledOnce());
    await act(() => result.current.refresh());
    await act(async () => older.resolve([{ ...file, id: 'stale' }]));
    expect(result.current.files).toEqual([file]);
  });
  it('refreshes when another tab reconnects even if React observes the same final connected status', async () => {
    const { result } = renderHook(() => useDriveWorkspace(true));
    await waitFor(() => expect(result.current.files).toEqual([file]));
    const next = { ...file, id: 'new-session' };
    vi.mocked(listDriveTrees).mockResolvedValueOnce([next]);
    await act(async () => {
      ++auth.generation;
      connection('restoring');
      connection('connected');
    });
    await waitFor(() => expect(result.current.files).toEqual([next]));
    expect(listDriveTrees).toHaveBeenCalledTimes(2);
  });
});
