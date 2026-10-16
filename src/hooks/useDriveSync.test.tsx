// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useDriveSync } from './useDriveSync';
import type { SyncView } from '../lib/driveSync';
const state = vi.hoisted(() => ({
  views: {} as Record<string, SyncView>,
  listeners: new Set<() => void>(),
  flush: vi.fn(async () => {}),
  start: vi.fn(() => () => {}),
}));
vi.mock('../lib/driveSync', () => ({
  driveSync: {
    subscribe: (listener: () => void) => {
      state.listeners.add(listener);
      return () => state.listeners.delete(listener);
    },
    snapshot: () => state.views,
    hasPending: () => Object.values(state.views).some((view) => view.pending),
    start: state.start,
    flush: state.flush,
  },
}));
afterEach(() => {
  cleanup();
  state.views = {};
  vi.clearAllMocks();
  vi.restoreAllMocks();
});
describe('Drive lifecycle persistence and native warnings', () => {
  it.each(['waiting for connection', 'needs attention', 'pending', 'syncing'] as const)(
    'warns for %s changes outside the editor and unregisters after acknowledgement',
    async (status) => {
      state.views = {
        background: {
          status,
          pending: true,
          link: { treeId: 'background', id: 'backup', name: '', modifiedTime: '' },
        },
      };
      const persist = vi.fn(async () => {}),
        onError = vi.fn();
      renderHook(() => useDriveSync(persist, onError));
      const leaving = new Event('beforeunload', { cancelable: true });
      await act(async () => window.dispatchEvent(leaving));
      expect(leaving.defaultPrevented).toBe(true);
      expect(persist).toHaveBeenCalledOnce();
      expect(state.flush).toHaveBeenCalledOnce();
      await act(async () => {
        state.views = {
          background: { ...state.views.background, pending: false, status: 'synced' },
        };
        state.listeners.forEach((listener) => listener());
      });
      const acknowledged = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(acknowledged);
      expect(acknowledged.defaultPrevented).toBe(false);
    },
  );
  it('persists on hiding and pagehide without warning for unlinked trees', async () => {
    const persist = vi.fn(async () => {});
    renderHook(() => useDriveSync(persist, vi.fn()));
    const leaving = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(leaving);
    expect(leaving.defaultPrevented).toBe(false);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    await act(async () => window.dispatchEvent(new Event('pagehide')));
    expect(persist).toHaveBeenCalledTimes(2);
    expect(state.flush).toHaveBeenCalledTimes(2);
  });
  it('reports local persistence failures while still flushing other pending trees', async () => {
    const error = Error('Local storage failed'),
      onError = vi.fn();
    renderHook(() =>
      useDriveSync(
        vi.fn(async () => {
          throw error;
        }),
        onError,
      ),
    );
    await act(async () => window.dispatchEvent(new Event('pagehide')));
    expect(onError).toHaveBeenCalledWith(error);
    expect(state.flush).toHaveBeenCalledOnce();
  });
});
