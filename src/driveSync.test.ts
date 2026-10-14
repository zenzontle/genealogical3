// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DriveSyncCoordinator, driveRetryDelay, retryableDriveError } from './driveSync';
import { DriveConflictError, DriveRequestError, type saveDriveTreeLocked } from './drive';
import { driveContent } from './driveContent';
import { makePerson, makeTree, type Tree } from './model';
import type { DriveLink } from './storage';

type Store = {
  trees: Map<string, Tree>;
  links: Map<string, DriveLink>;
  last: number;
  operations: Promise<unknown>;
};
function harness(shared?: Store) {
  const initial = {
    ...makeTree('Family'),
    dataUpdatedAt: Date.now() - 1000,
    people: [makePerson('Ada')],
  };
  const store = shared || {
    trees: new Map([[initial.id, initial]]),
    links: new Map<string, DriveLink>(),
    last: 0,
    operations: Promise.resolve(),
  };
  const tree = [...store.trees.values()][0];
  if (!shared)
    store.links.set(tree.id, {
      treeId: tree.id,
      id: 'backup',
      name: 'Family.json',
      modifiedTime: '',
      sync: { acknowledgedDataUpdatedAt: tree.dataUpdatedAt, revision: 'baseline', pending: false },
    });
  let remote = structuredClone(tree),
    revision = 'baseline',
    online = true,
    connection = 'connected' as 'connected' | 'disconnected' | 'error',
    generation = 0;
  let remoteEdits = 0;
  let nextCommit: (() => void) | undefined;
  let warnings: { personId: string; name: string }[] = [];
  const save = vi.fn<typeof saveDriveTreeLocked>(
    async (snapshot, _generation, id, _progress, options) => {
      await options?.beforeReplace?.();
      if (!id || id === 'backup') {
        remote = structuredClone(snapshot);
        revision = options?.revision || 'uploaded';
      }
      return {
        id: id || 'new-backup',
        name: 'Family.json',
        modifiedTime: '',
        cleanupWarnings: [],
        revision,
      };
    },
  );
  const inspect = vi.fn(async (id: string) => ({
    tree: structuredClone(id === 'backup' ? remote : initial),
    revision: id === 'backup' ? revision : 'baseline',
    content: await driveContent(id === 'backup' ? remote : initial),
    file: { id, name: 'Family.json', modifiedTime: '', mimeType: 'application/json' },
  }));
  const restore = vi.fn(async () => ({
    tree: structuredClone(remote),
    revision,
    restoreWarnings: warnings,
  }));
  const coordinator = new DriveSyncCoordinator({
    getTree: async (id) => structuredClone(store.trees.get(id)),
    getDriveLink: async (id) => structuredClone(store.links.get(id)),
    listTrees: async () => structuredClone([...store.trees.values()]),
    listDriveLinks: async () => structuredClone([...store.links.values()]),
    updateLinkedTree: async (id, update) => {
      nextCommit?.();
      nextCommit = undefined;
      const next = update(
        structuredClone(store.trees.get(id)),
        structuredClone(store.links.get(id)),
      );
      if (next.tree) store.trees.set(id, next.tree);
      if (next.link) store.links.set(id, next.link);
    },
    getLastDriveAttempt: async () => store.last,
    setLastDriveAttempt: async (at) => {
      store.last = at;
      return 'attempt';
    },
    connection: () => connection,
    generation: () => generation,
    online: () => online,
    now: () => Date.now(),
    lock: <T>(_generation: number | undefined, work: () => Promise<T>) => {
      const queued = store.operations.then(work);
      store.operations = queued.catch(() => undefined);
      return queued;
    },
    inspect,
    restore,
    save,
  });
  const edit = async (name = 'Edited', id = tree.id) => {
    const latest = { ...store.trees.get(id)!, name, dataUpdatedAt: Date.now() };
    store.trees.set(id, latest);
    const link = store.links.get(id)!;
    store.links.set(id, { ...link, sync: { ...link.sync, pending: true, editedAt: Date.now() } });
    coordinator.noteEdit(id, latest.dataUpdatedAt);
    await coordinator.refresh();
    return latest;
  };
  return {
    coordinator,
    store,
    tree,
    save,
    inspect,
    restore,
    edit,
    atNextCommit: (run: () => void) => {
      nextCommit = run;
    },
    authError: () => {
      connection = 'error';
    },
    offline: () => {
      online = false;
    },
    online: () => {
      online = true;
    },
    disconnect: () => {
      connection = 'disconnected';
    },
    reconnect: () => {
      connection = 'connected';
    },
    accountChange: () => {
      ++generation;
    },
    missing: () => {
      warnings = [{ personId: tree.people[0].id, name: 'Ada' }];
    },
    remoteEdit: (name = 'Remote edit', timestamp = Date.now()) => {
      remote = { ...remote, name, dataUpdatedAt: timestamp };
      revision = ++remoteEdits === 1 ? 'remote-edit' : `remote-edit-${remoteEdits}`;
    },
    remoteUpload: (snapshot: Tree, nextRevision: string) => {
      remote = snapshot;
      revision = nextRevision;
    },
  };
}
const tick = (ms: number) => vi.advanceTimersByTimeAsync(ms);
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('durable automatic Drive queue', () => {
  it.each([false, true])(
    'clears discarded editor markers while retaining durable pending changes: %s',
    async (pending) => {
      const h = harness();
      await h.coordinator.refresh();
      if (pending) await h.edit();
      h.coordinator.noteEdit(h.tree.id, Date.now() + 100);
      expect(h.coordinator.hasPending()).toBe(true);
      await h.coordinator.discardEdits(h.tree.id);
      expect(h.coordinator.hasPending()).toBe(pending);
      expect(h.store.links.get(h.tree.id)?.sync?.pending).toBe(pending);
      expect(h.save).not.toHaveBeenCalled();
    },
  );
  it('debounces the latest data edit and coalesces snapshots', async () => {
    const h = harness();
    await h.coordinator.refresh();
    await h.edit('First');
    await tick(2000);
    await h.edit('Latest');
    await tick(2999);
    expect(h.save).not.toHaveBeenCalled();
    await tick(1);
    expect(h.save).toHaveBeenCalledOnce();
    expect(h.save.mock.calls[0][0].name).toBe('Latest');
    expect(h.store.links.get(h.tree.id)?.sync?.pending).toBe(false);
  });
  it('does not trigger or postpone syncing for viewport changes', async () => {
    const h = harness();
    await h.coordinator.refresh();
    h.store.trees.set(h.tree.id, {
      ...h.tree,
      viewport: { x: 30, y: 20, zoom: 2 },
      updatedAt: Date.now(),
    });
    await h.coordinator.refresh();
    await tick(5000);
    expect(h.save).not.toHaveBeenCalled();
    await h.edit();
    await tick(2500);
    h.store.trees.get(h.tree.id)!.viewport.x = 100;
    await h.coordinator.refresh();
    await tick(500);
    expect(h.save).toHaveBeenCalledOnce();
  });
  it('throttles all tree attempts across multiple pending trees', async () => {
    const h = harness();
    const other = { ...h.tree, id: 'other', name: 'Other' };
    h.store.trees.set(other.id, other);
    h.store.links.set(other.id, {
      ...h.store.links.get(h.tree.id)!,
      treeId: other.id,
      id: 'other-backup',
    });
    await h.coordinator.refresh();
    await h.edit();
    await h.edit('Second', other.id);
    await tick(3000);
    expect(h.save).toHaveBeenCalledOnce();
    await tick(9999);
    expect(h.save).toHaveBeenCalledOnce();
    await tick(1);
    expect(h.save).toHaveBeenCalledTimes(2);
  });
  it('expires a future throttle timestamp after clock rollback and throttles subsequent automatic attempts', async () => {
    const h = harness();
    h.store.last = Date.now();
    vi.setSystemTime(Date.now() - 30_000);
    await h.coordinator.refresh();
    await h.edit('After rollback');
    await tick(3000);
    expect(h.save).toHaveBeenCalledOnce();
    expect(h.store.last).toBe(Date.now());
    await h.edit('Next edit');
    await tick(9999);
    expect(h.save).toHaveBeenCalledOnce();
    await tick(1);
    expect(h.save).toHaveBeenCalledTimes(2);
  });
  it('allows manual sync immediately after a persisted attempt becomes future-dated', async () => {
    const h = harness();
    await h.coordinator.refresh();
    await h.edit();
    h.store.last = Date.now();
    vi.setSystemTime(Date.now() - 30_000);
    const pending = h.coordinator.manualSave(h.tree.id);
    await tick(0);
    expect(h.save).toHaveBeenCalledOnce();
    await pending;
    expect(h.store.last).toBe(Date.now());
    expect(h.coordinator.hasPending()).toBe(false);
  });
  it('keeps newer edits pending when an older upload finishes', async () => {
    const h = harness();
    let finish!: () => void;
    h.save.mockImplementationOnce(async (snapshot, _generation, _id, _progress, options) => {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      h.remoteUpload(snapshot, options!.revision!);
      return {
        id: 'backup',
        name: '',
        modifiedTime: '',
        revision: options!.revision!,
        cleanupWarnings: [],
      };
    });
    await h.coordinator.refresh();
    const older = await h.edit('Older');
    await tick(3000);
    await h.edit('Newer');
    finish();
    await tick(0);
    const sync = h.store.links.get(h.tree.id)!.sync!;
    expect(sync.acknowledgedDataUpdatedAt).toBe(older.dataUpdatedAt);
    expect(sync.pending).toBe(true);
    await tick(10000);
    expect(h.save).toHaveBeenCalledTimes(2);
    expect(h.save.mock.calls[1][0].name).toBe('Newer');
  });
  it('coalesces a manual request with a queued background save', async () => {
    const h = harness();
    await h.coordinator.refresh();
    await h.edit();
    const manual = h.coordinator.manualSave(h.tree.id);
    await tick(3000);
    await manual;
    expect(h.save).toHaveBeenCalledOnce();
  });
  it.each([undefined, null])(
    'links a local duplicate only after a successful manual save with expectation %s',
    async (expectedBackupId) => {
      const h = harness();
      h.store.links.clear();
      await h.coordinator.refresh();
      await tick(10000);
      expect(h.save).not.toHaveBeenCalled();
      await h.coordinator.manualSave(h.tree.id, undefined, undefined, expectedBackupId);
      expect(h.store.links.get(h.tree.id)?.id).toBe('new-backup');
      expect(h.coordinator.hasPending()).toBe(false);
    },
  );
  it('retains offline edits through coordinator recreation and resumes without authorization', async () => {
    const h = harness();
    h.offline();
    await h.coordinator.refresh();
    await h.edit();
    await tick(30000);
    expect(h.save).not.toHaveBeenCalled();
    expect(h.coordinator.hasPending()).toBe(true);
    const reopened = harness(h.store);
    await reopened.coordinator.refresh();
    await tick(0);
    expect(reopened.save).toHaveBeenCalledOnce();
    expect(reopened.coordinator.hasPending()).toBe(false);
  });
  it('retains disconnect warnings and resumes on reconnection', async () => {
    const h = harness();
    h.disconnect();
    await h.coordinator.refresh();
    await h.edit();
    await tick(30000);
    expect(h.coordinator.snapshot()[h.tree.id].status).toBe('waiting for connection');
    expect(h.coordinator.hasPending()).toBe(true);
    h.reconnect();
    await h.coordinator.retry();
    await tick(0);
    expect(h.save).toHaveBeenCalledOnce();
  });
  it('recognizes an uncertain successful upload without uploading it again', async () => {
    const h = harness();
    h.save.mockImplementationOnce(async (snapshot, _generation, _id, _progress, options) => {
      h.remoteUpload(snapshot, options!.revision!);
      throw new DriveRequestError(0, 'Response lost');
    });
    await h.coordinator.refresh();
    await h.edit();
    await tick(3000);
    expect(h.store.links.get(h.tree.id)?.sync?.upload).toBeDefined();
    await tick(11000);
    expect(h.save).toHaveBeenCalledOnce();
    expect(h.store.links.get(h.tree.id)?.sync?.pending).toBe(false);
  });
  it('retains newer pending edits after acknowledging an uncertain older upload', async () => {
    const h = harness();
    h.save.mockImplementationOnce(async (snapshot, _generation, _id, _progress, options) => {
      h.remoteUpload(snapshot, options!.revision!);
      throw new DriveRequestError(0, 'Response lost');
    });
    await h.coordinator.refresh();
    await h.edit('Older');
    await tick(3000);
    await h.edit('Newer');
    await tick(11000);
    expect(h.store.links.get(h.tree.id)?.sync?.pending).toBe(true);
    await tick(10000);
    expect(h.save.mock.calls[1][0].name).toBe('Newer');
  });
  it('exhausts six automatic retries, retains pending work, and allows Retry', async () => {
    const h = harness();
    h.save.mockRejectedValue(new DriveRequestError(503, 'Unavailable'));
    await h.coordinator.refresh();
    await h.edit();
    await tick(3000);
    for (let i = 0; i < 6; i++) await tick(65000);
    expect(h.save).toHaveBeenCalledTimes(7);
    expect(h.coordinator.snapshot()[h.tree.id].status).toBe('needs attention');
    expect(h.coordinator.hasPending()).toBe(true);
    await tick(200000);
    expect(h.save).toHaveBeenCalledTimes(7);
    h.save.mockResolvedValueOnce({
      id: 'backup',
      name: '',
      modifiedTime: '',
      revision: 'success',
      cleanupWarnings: [],
    });
    await h.coordinator.retry(h.tree.id);
    await tick(0);
    expect(h.save).toHaveBeenCalledTimes(8);
  });
  it('honors Retry-After and preserves backoff when closing or retrying manually', async () => {
    const h = harness();
    h.save.mockRejectedValueOnce(new DriveRequestError(429, 'Quota', [], 120000));
    await h.coordinator.refresh();
    await h.edit();
    await tick(3000);
    await h.coordinator.flush();
    const retryAt = h.store.links.get(h.tree.id)?.sync?.retryAt;
    await h.coordinator.retry(h.tree.id);
    expect(h.store.links.get(h.tree.id)?.sync?.retryAt).toBe(retryAt);
    await tick(119999);
    expect(h.save).toHaveBeenCalledOnce();
    await tick(1);
    expect(h.save).toHaveBeenCalledTimes(2);
  });
  it('pauses permission errors immediately', async () => {
    const h = harness();
    h.save.mockRejectedValue(
      new DriveRequestError(403, 'Permission', ['insufficientFilePermissions']),
    );
    await h.coordinator.refresh();
    await h.edit();
    await tick(3000);
    await tick(100000);
    expect(h.save).toHaveBeenCalledOnce();
    expect(h.coordinator.snapshot()[h.tree.id].status).toBe('needs attention');
  });
  it('does not acknowledge an upload across an account change', async () => {
    const h = harness();
    h.save.mockImplementationOnce(async () => {
      h.accountChange();
      return {
        id: 'backup',
        name: '',
        modifiedTime: '',
        revision: 'another-account',
        cleanupWarnings: [],
      };
    });
    await h.coordinator.refresh();
    await h.edit();
    await tick(3000);
    expect(h.store.links.get(h.tree.id)?.sync?.revision).toBe('baseline');
    expect(h.store.links.get(h.tree.id)?.sync?.pending).toBe(true);
  });
  it('rechecks association deletion after acquiring the lock', async () => {
    const h = harness();
    let release!: () => void;
    h.store.operations = new Promise<void>((resolve) => {
      release = resolve;
    });
    await h.coordinator.refresh();
    await h.edit();
    await tick(3000);
    h.store.links.clear();
    h.store.trees.clear();
    release();
    await tick(0);
    expect(h.save).not.toHaveBeenCalled();
    expect(h.store.links.size).toBe(0);
  });
  it('coordinates two tabs using the shared lock and persisted throttle', async () => {
    const h = harness();
    const other = harness(h.store);
    await h.coordinator.refresh();
    await other.coordinator.refresh();
    await h.edit();
    await other.coordinator.refresh();
    await tick(3000);
    expect(h.save.mock.calls.length + other.save.mock.calls.length).toBe(1);
  });
  it('bypasses only debounce on page hiding and still respects the global throttle', async () => {
    const h = harness();
    await h.coordinator.refresh();
    await h.edit();
    await h.coordinator.flush();
    await tick(0);
    expect(h.save).toHaveBeenCalledOnce();
    await tick(1);
    await h.edit('Next');
    await h.coordinator.flush();
    await tick(9998);
    expect(h.save).toHaveBeenCalledOnce();
    await tick(1);
    expect(h.save).toHaveBeenCalledTimes(2);
  });
});

describe('conflict review and safe replacement', () => {
  async function conflict() {
    const h = harness();
    await h.coordinator.refresh();
    h.remoteEdit('Drive', 900000);
    await h.edit('Local');
    await tick(3000);
    return h;
  }
  it('records data timestamps and pauses without overwriting either version', async () => {
    const h = await conflict();
    expect(h.save).not.toHaveBeenCalled();
    expect(h.coordinator.snapshot()[h.tree.id].conflict).toEqual({
      localDataUpdatedAt: 1000000,
      remoteDataUpdatedAt: 900000,
      revision: 'remote-edit',
    });
    await tick(100000);
    expect(h.save).not.toHaveBeenCalled();
    expect(h.coordinator.hasPending()).toBe(true);
  });
  it('replaces only the reviewed remote revision with local', async () => {
    const h = await conflict();
    const reviewed = h.coordinator.snapshot()[h.tree.id].conflict!;
    const save = h.coordinator.manualSave(h.tree.id, undefined, reviewed);
    await tick(10000);
    expect(await save).toBeDefined();
    expect(h.save.mock.calls[0][4]?.expectedRevision).toBe('remote-edit');
    expect(h.coordinator.hasPending()).toBe(false);
  });
  it.each(['local', 'remote'])(
    'refreshes review when %s changes before resolution',
    async (version) => {
      const h = await conflict();
      const reviewed = h.coordinator.snapshot()[h.tree.id].conflict!;
      if (version === 'local') await h.edit('More edits');
      else h.remoteEdit('New remote', 1002000);
      const save = h.coordinator.manualSave(h.tree.id, undefined, reviewed);
      await tick(10000);
      expect(await save).toBeUndefined();
      expect(h.save).not.toHaveBeenCalled();
      expect(h.coordinator.snapshot()[h.tree.id].conflict).not.toEqual(reviewed);
    },
  );
  it('revalidates local edits immediately before document replacement', async () => {
    const h = await conflict();
    const reviewed = h.coordinator.snapshot()[h.tree.id].conflict!;
    h.save.mockImplementationOnce(async (_snapshot, _generation, _id, _progress, options) => {
      await h.edit('During upload');
      await options!.beforeReplace!();
      throw Error('Unexpected commit');
    });
    const save = h.coordinator
      .manualSave(h.tree.id, undefined, reviewed)
      .catch((error: unknown) => error);
    await tick(10000);
    expect(await save).toBeInstanceOf(DriveConflictError);
    expect(h.store.links.get(h.tree.id)?.sync?.pending).toBe(true);
  });
  it('fully downloads and preserves local identity when using Drive', async () => {
    const h = await conflict();
    const reviewed = h.coordinator.snapshot()[h.tree.id].conflict!;
    const result = await h.coordinator.useDrive(h.tree.id, reviewed);
    expect(h.restore).toHaveBeenCalledOnce();
    expect(result?.id).toBe(h.tree.id);
    expect(result?.name).toBe('Drive');
    expect(h.coordinator.hasPending()).toBe(false);
  });
  it.each(['missing', 'network'])(
    'preserves all local contents after a %s download failure',
    async (failure) => {
      const h = await conflict();
      const original = structuredClone(h.store.trees.get(h.tree.id));
      if (failure === 'missing') h.missing();
      else h.restore.mockRejectedValueOnce(new DriveRequestError(0, 'Network'));
      await expect(
        h.coordinator.useDrive(h.tree.id, h.coordinator.snapshot()[h.tree.id].conflict!),
      ).rejects.toThrow();
      expect(h.store.trees.get(h.tree.id)).toEqual(original);
      expect(h.coordinator.hasPending()).toBe(true);
    },
  );
  it('rechecks Drive after downloading before touching local contents', async () => {
    const h = await conflict();
    const reviewed = h.coordinator.snapshot()[h.tree.id].conflict!;
    h.restore.mockImplementationOnce(async () => {
      h.remoteEdit('Changed during download', 1005000);
      return {
        tree: { ...h.tree, name: 'Drive' },
        revision: reviewed.revision,
        restoreWarnings: [],
      };
    });
    expect(await h.coordinator.useDrive(h.tree.id, reviewed)).toBeUndefined();
    expect(h.store.trees.get(h.tree.id)?.name).toBe('Local');
    expect(h.coordinator.snapshot()[h.tree.id].conflict?.remoteDataUpdatedAt).toBe(1005000);
  });
  it('initializes an older matching link while ignoring identity, viewport and timestamps', async () => {
    const h = harness();
    h.store.links.get(h.tree.id)!.sync = undefined;
    h.store.trees.set(h.tree.id, {
      ...h.tree,
      updatedAt: 123,
      dataUpdatedAt: 456,
      viewport: { x: 45, y: 50, zoom: 2 },
    });
    await h.coordinator.refresh();
    await tick(0);
    expect(h.restore).toHaveBeenCalledOnce();
    expect(h.save).not.toHaveBeenCalled();
    expect(h.store.links.get(h.tree.id)?.sync?.acknowledgedDataUpdatedAt).toBe(456);
  });
  it('requires review for different meaningful content in older links', async () => {
    const h = harness();
    h.store.links.get(h.tree.id)!.sync = undefined;
    h.remoteEdit();
    await h.coordinator.refresh();
    await tick(0);
    expect(h.save).not.toHaveBeenCalled();
    expect(h.coordinator.snapshot()[h.tree.id].conflict).toBeDefined();
  });
  it('requires attention for incomplete baseline downloads and existing restore warnings', async () => {
    const h = harness();
    h.store.links.get(h.tree.id)!.sync = undefined;
    h.missing();
    await h.coordinator.refresh();
    await tick(0);
    expect(h.coordinator.snapshot()[h.tree.id].status).toBe('needs attention');
    expect(h.save).not.toHaveBeenCalled();
  });
});

describe('sync recovery boundaries', () => {
  it.each([
    ['lock', null],
    ['lock', undefined],
    ['throttle', null],
    ['throttle', undefined],
  ] as const)(
    'rejects an unlinked save when an association appears while waiting for %s with expectation %s',
    async (waitingFor, expectedBackupId) => {
      const h = harness();
      const link = h.store.links.get(h.tree.id)!;
      h.store.links.clear();
      let release!: () => void;
      if (waitingFor === 'lock')
        h.store.operations = new Promise<void>((resolve) => {
          release = resolve;
        });
      else h.store.last = Date.now();
      await h.coordinator.refresh();
      const pending = h.coordinator
        .manualSave(h.tree.id, undefined, undefined, expectedBackupId)
        .catch((error: unknown) => error);
      await tick(0);
      h.store.links.set(h.tree.id, link);
      if (waitingFor === 'lock') release();
      await tick(waitingFor === 'lock' ? 0 : 10000);
      const result = await pending;
      expect(result).toBeInstanceOf(Error);
      expect((result as Error).message).toMatch(/association changed/);
      expect(h.inspect).not.toHaveBeenCalled();
      expect(h.save).not.toHaveBeenCalled();
      expect(h.store.links.get(h.tree.id)).toEqual(link);
    },
  );
  it('rejects a null backup expectation when a link appeared during authorization', async () => {
    const h = harness();
    await expect(h.coordinator.manualSave(h.tree.id, undefined, undefined, null)).rejects.toThrow(
      /association changed/,
    );
    expect(h.inspect).not.toHaveBeenCalled();
    expect(h.save).not.toHaveBeenCalled();
  });
  it('cancels a queued manual sync when deletion removes the intended association', async () => {
    const h = harness();
    let release!: () => void;
    h.store.operations = new Promise<void>((resolve) => {
      release = resolve;
    });
    await h.coordinator.refresh();
    await h.edit();
    const pending = h.coordinator.manualSave(h.tree.id).catch((error: unknown) => error);
    await tick(0);
    h.store.links.clear();
    release();
    await tick(0);
    expect(await pending).toBeInstanceOf(Error);
    expect(h.save).not.toHaveBeenCalled();
    expect(h.store.links.size).toBe(0);
  });
  it('cancels an intended update deleted while manual authorization was pending', async () => {
    const h = harness();
    h.store.links.clear();
    await expect(
      h.coordinator.manualSave(h.tree.id, undefined, undefined, 'backup'),
    ).rejects.toThrow(/association changed/);
    expect(h.save).not.toHaveBeenCalled();
    expect(h.store.links.size).toBe(0);
  });
  it('does not create a replacement file for a conflict whose association was deleted', async () => {
    const h = harness();
    await h.coordinator.refresh();
    h.remoteEdit();
    await h.edit();
    await tick(3000);
    const reviewed = h.coordinator.snapshot()[h.tree.id].conflict!;
    h.store.links.clear();
    await expect(h.coordinator.manualSave(h.tree.id, undefined, reviewed)).rejects.toThrow(
      /association changed/,
    );
    expect(h.save).not.toHaveBeenCalled();
    expect(h.store.trees.get(h.tree.id)?.name).toBe('Edited');
  });
  it('reuses the persisted upload identity when retrying the same data snapshot', async () => {
    const h = harness();
    h.save.mockRejectedValueOnce(new DriveRequestError(0, 'Response lost'));
    await h.coordinator.refresh();
    await h.edit();
    await tick(3000);
    const identity = h.store.links.get(h.tree.id)?.sync?.upload?.revision;
    await tick(11000);
    expect(h.save.mock.calls[1][4]?.revision).toBe(identity);
    expect(h.coordinator.hasPending()).toBe(false);
  });
  it('pauses both conflict-resolution request paths while offline', async () => {
    const h = harness();
    await h.coordinator.refresh();
    h.remoteEdit();
    await h.edit();
    await tick(3000);
    const reviewed = h.coordinator.snapshot()[h.tree.id].conflict!,
      requests = h.inspect.mock.calls.length;
    h.offline();
    await expect(h.coordinator.manualSave(h.tree.id, undefined, reviewed)).rejects.toThrow(
      /go online/,
    );
    await expect(h.coordinator.useDrive(h.tree.id, reviewed)).rejects.toThrow(/go online/);
    expect(h.inspect).toHaveBeenCalledTimes(requests);
    expect(h.store.trees.get(h.tree.id)?.name).toBe('Edited');
  });
  it('shows attention without a leave warning for an unchanged incomplete restore', async () => {
    const h = harness();
    h.store.links.get(h.tree.id)!.restoreWarnings = [
      { personId: h.tree.people[0].id, name: 'Ada' },
    ];
    await h.coordinator.refresh();
    expect(h.coordinator.snapshot()[h.tree.id].status).toBe('needs attention');
    expect(h.coordinator.hasPending()).toBe(false);
    await h.edit();
    expect(h.coordinator.hasPending()).toBe(true);
    expect(h.save).not.toHaveBeenCalled();
  });
  it('does not turn a known unchanged legacy restore into unacknowledged edits', async () => {
    const h = harness();
    h.store.links.get(h.tree.id)!.sync!.revision = undefined;
    h.inspect.mockRejectedValueOnce(Error('Unsupported legacy backup'));
    await h.coordinator.refresh();
    await tick(0);
    expect(h.coordinator.snapshot()[h.tree.id].status).toBe('needs attention');
    expect(h.coordinator.hasPending()).toBe(false);
    expect(h.save).not.toHaveBeenCalled();
  });
  it('does not acknowledge a save when the account changes inside the storage transaction', async () => {
    const h = harness();
    h.save.mockImplementationOnce(async () => {
      h.atNextCommit(h.accountChange);
      return {
        id: 'backup',
        name: '',
        modifiedTime: '',
        revision: 'uploaded',
        cleanupWarnings: [],
      };
    });
    await h.coordinator.refresh();
    await h.edit();
    await tick(3000);
    expect(h.store.links.get(h.tree.id)?.sync?.revision).toBe('baseline');
    expect(h.store.links.get(h.tree.id)?.sync?.pending).toBe(true);
  });
  it('does not create a first association across an account change during storage', async () => {
    const h = harness();
    h.store.links.clear();
    h.save.mockImplementationOnce(async () => {
      h.atNextCommit(h.accountChange);
      return { id: 'new', name: '', modifiedTime: '', revision: 'uploaded', cleanupWarnings: [] };
    });
    await expect(h.coordinator.manualSave(h.tree.id)).rejects.toThrow(/connection changed/);
    expect(h.store.links.has(h.tree.id)).toBe(false);
  });
  it('keeps local contents intact when the account changes inside Drive replacement storage', async () => {
    const h = harness();
    await h.coordinator.refresh();
    h.remoteEdit();
    await h.edit('Local');
    await tick(3000);
    h.atNextCommit(h.accountChange);
    await expect(
      h.coordinator.useDrive(h.tree.id, h.coordinator.snapshot()[h.tree.id].conflict!),
    ).rejects.toThrow(/connection changed/);
    expect(h.store.trees.get(h.tree.id)?.name).toBe('Local');
  });
  it('requires explicit user action for permission failures after network recovery', async () => {
    const h = harness();
    h.save.mockRejectedValue(
      new DriveRequestError(403, 'Permission', ['insufficientFilePermissions']),
    );
    await h.coordinator.refresh();
    await h.edit();
    await tick(3000);
    await h.coordinator.retry(undefined, true);
    await tick(100000);
    expect(h.save).toHaveBeenCalledOnce();
    expect(h.coordinator.snapshot()[h.tree.id].status).toBe('needs attention');
  });
  it('restarts exhausted transient attempts on network recovery', async () => {
    const h = harness();
    const link = h.store.links.get(h.tree.id)!;
    link.sync = {
      ...link.sync,
      pending: true,
      attention: 'Unavailable',
      retryable: true,
      retries: 7,
    };
    await h.coordinator.refresh();
    await h.coordinator.retry(undefined, true);
    await tick(0);
    expect(h.save).toHaveBeenCalledOnce();
    expect(h.coordinator.hasPending()).toBe(false);
  });
  it('retries transient token-renewal errors without opening authorization', async () => {
    const h = harness();
    h.save.mockImplementationOnce(async () => {
      h.authError();
      throw new DriveRequestError(503, 'Token service unavailable');
    });
    await h.coordinator.refresh();
    await h.edit();
    await tick(3000);
    expect(h.coordinator.snapshot()[h.tree.id].status).toBe('retrying');
    await tick(11000);
    expect(h.save).toHaveBeenCalledTimes(2);
  });
  it('schedules an explicit Retry after token-service failures exhaust automatic attempts', async () => {
    const h = harness();
    const succeed = h.save.getMockImplementation()!;
    h.save.mockImplementation(async () => {
      h.authError();
      throw new DriveRequestError(503, 'Token service unavailable');
    });
    await h.coordinator.refresh();
    await h.edit();
    await tick(3000);
    for (let i = 0; i < 6; i++) await tick(65000);
    expect(h.save).toHaveBeenCalledTimes(7);
    expect(h.coordinator.snapshot()[h.tree.id].status).toBe('needs attention');
    expect(h.store.links.get(h.tree.id)?.sync?.retryAt).toBeUndefined();
    await tick(200000);
    expect(h.save).toHaveBeenCalledTimes(7);
    h.save.mockImplementation(succeed);
    await h.coordinator.retry(h.tree.id);
    await tick(0);
    expect(h.save).toHaveBeenCalledTimes(8);
    expect(h.coordinator.snapshot()[h.tree.id].status).toBe('synced');
    expect(h.coordinator.hasPending()).toBe(false);
  });
  it('backs off when the network fails while refreshing a detected conflict', async () => {
    const h = harness();
    const inspect = h.inspect.getMockImplementation()!;
    h.inspect
      .mockImplementationOnce(inspect)
      .mockRejectedValueOnce(new DriveRequestError(0, 'Network'));
    h.save.mockRejectedValueOnce(new DriveConflictError());
    await h.coordinator.refresh();
    await h.edit();
    await tick(3000);
    expect(h.store.links.get(h.tree.id)?.sync?.retryAt).toBeGreaterThan(Date.now());
    expect(h.coordinator.snapshot()[h.tree.id].status).toBe('retrying');
  });
  it('keeps edits made during a full Drive download', async () => {
    const h = harness();
    await h.coordinator.refresh();
    h.remoteEdit();
    await h.edit('Local');
    await tick(3000);
    const reviewed = h.coordinator.snapshot()[h.tree.id].conflict!;
    h.restore.mockImplementationOnce(async () => {
      vi.setSystemTime(Date.now() + 1);
      await h.edit('During download');
      return { tree: h.tree, revision: reviewed.revision, restoreWarnings: [] };
    });
    expect(await h.coordinator.useDrive(h.tree.id, reviewed)).toBeUndefined();
    expect(h.store.trees.get(h.tree.id)?.name).toBe('During download');
  });
});

describe('retry policy', () => {
  it.each([
    'rateLimitExceeded',
    'userRateLimitExceeded',
    'quotaExceeded',
    'dailyLimitExceeded',
    'storageQuotaExceeded',
  ])('retries quota-related 403 reason %s', (reason) =>
    expect(retryableDriveError(new DriveRequestError(403, 'Quota', [reason]))).toBe(true),
  );
  it.each([0, 429, 500, 502, 503, 504])('retries network/server status %s', (status) =>
    expect(retryableDriveError(new DriveRequestError(status, 'Transient'))).toBe(true),
  );
  it.each([401, 403, 404, 410])('requires attention for status %s', (status) =>
    expect(retryableDriveError(new DriveRequestError(status, 'Attention'))).toBe(false),
  );
  it('starts at ten seconds, doubles with jitter, caps at 64 seconds and honors Retry-After', () => {
    expect(driveRetryDelay(0, 0, 0)).toBe(10000);
    expect(driveRetryDelay(1, 0, 0.5)).toBe(20500);
    expect(driveRetryDelay(20)).toBe(64000);
    expect(driveRetryDelay(20, 120000)).toBe(120000);
  });
});
