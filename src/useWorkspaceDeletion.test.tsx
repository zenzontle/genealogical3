// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { queueDriveOperation } from './drive';
import { makeTree } from './model';
import { removeWorkspaceStorage } from './storage';
import { useWorkspaceDeletion } from './useWorkspaceDeletion';

const session = vi.hoisted(() => ({ generation: 0 }));
vi.mock('./driveAuth', async (original) => ({
  ...(await original<typeof import('./driveAuth')>()),
  getDriveGeneration: () => session.generation,
}));
vi.mock('./storage', () => ({ removeWorkspaceStorage: vi.fn(async () => {}) }));

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
};
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('local Workspace deletion', () => {
  it.each(['operation queue', 'another tab'] as const)(
    'removes local data after the Drive generation changes while waiting for %s',
    async (waitingFor) => {
      const reached = deferred(),
        gate = deferred();
      let held: Promise<void> | undefined;
      if (waitingFor === 'operation queue') {
        held = queueDriveOperation(session.generation, async () => {
          reached.resolve();
          await gate.promise;
        });
        await reached.promise;
      } else {
        vi.stubGlobal('navigator', {
          locks: {
            request: vi.fn(async (name: string, run: () => Promise<void>) => {
              expect(name).toBe('genealogical3-drive-save');
              reached.resolve();
              await gate.promise;
              return run();
            }),
          },
        });
      }
      const releaseLocal = vi.fn(async () => {}),
        onRemoved = vi.fn();
      const operationBusy = { current: false };
      const { result } = renderHook(() =>
        useWorkspaceDeletion({
          operationBusy,
          beforeLocalRemoval: async () => releaseLocal,
          onDriveDeleted: vi.fn(),
          onRemoved,
          onBusy: vi.fn(),
        }),
      );
      const tree = makeTree('Family');
      act(() =>
        result.current.open({
          kind: 'local',
          tree,
          updatedAt: tree.dataUpdatedAt,
          link: { treeId: tree.id, id: 'backup', name: 'Family', modifiedTime: '' },
        }),
      );
      let completion!: Promise<unknown>;
      await act(async () => {
        completion = result.current.submit('local').catch((error: unknown) => error);
      });
      if (waitingFor === 'another tab') await reached.promise;
      expect(removeWorkspaceStorage).not.toHaveBeenCalled();
      ++session.generation;
      gate.resolve();
      await act(async () => {
        await held;
        expect(await completion).toBeUndefined();
      });
      expect(removeWorkspaceStorage).toHaveBeenCalledWith({ treeId: tree.id, backupId: undefined });
      expect(onRemoved).toHaveBeenCalledWith(tree.id, undefined);
      expect(releaseLocal).toHaveBeenCalledOnce();
      expect(operationBusy.current).toBe(false);
    },
  );
});
