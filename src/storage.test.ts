import { afterEach, describe, expect, it, vi } from 'vitest';
import { makePerson, makeTree, setHomePerson, type Tree } from './model';
import {
  deleteTree,
  duplicateSavedTree,
  getDriveLink,
  getTree,
  listTrees,
  listDriveLinks,
  saveDriveLink,
  saveTree,
  removeWorkspaceStorage,
} from './storage';

afterEach(() => vi.unstubAllGlobals());

// A small asynchronous IDB boundary fake checks the real storage functions,
// including read-only legacy normalization, without adding a dependency.
function browserStorage(initial: unknown[]) {
  const records = new Map(initial.map((value) => [(value as { id: string }).id, value]));
  const links = new Map();
  const put = vi.fn((value: { id: string }) => {
    records.set(value.id, structuredClone(value));
    return value.id;
  });
  const modes: string[] = [];
  const storeNames: (string | string[])[] = [];
  const failure = { linkDelete: false };
  const db = {
    close: vi.fn(),
    transaction: (stores: string | string[], mode: string) => {
      modes.push(mode);
      storeNames.push(stores);
      const stagedTrees = new Map(records),
        stagedLinks = new Map(links);
      let pending = 0,
        aborted = false;
      const tx = {
        oncomplete: () => {},
        onabort: () => {},
        error: null as Error | null,
        objectStore: (selected?: string) => {
          const storeName = selected || stores;
          const activeRecords = storeName === 'driveLinks' ? stagedLinks : stagedTrees;
          const request = (read: () => unknown) => {
            ++pending;
            const result = { result: undefined as unknown, onsuccess: () => {} };
            queueMicrotask(() => {
              if (aborted) return;
              try {
                result.result = read();
                result.onsuccess();
              } catch (error) {
                aborted = true;
                tx.error = error as Error;
                tx.onabort();
                return;
              }
              if (--pending === 0) {
                if (mode === 'readwrite') {
                  records.clear();
                  for (const [id, value] of stagedTrees) records.set(id, value);
                  links.clear();
                  for (const [id, value] of stagedLinks) links.set(id, value);
                }
                tx.oncomplete();
              }
            });
            return result;
          };
          return {
            get: (id: string) => request(() => structuredClone(activeRecords.get(id))),
            getAll: () => request(() => structuredClone([...activeRecords.values()])),
            put: (value: { id: string; treeId?: string }) =>
              request(() => {
                if (storeName === 'driveLinks') {
                  stagedLinks.set(value.treeId, structuredClone(value));
                  return value.treeId;
                }
                put(value);
                stagedTrees.set(value.id, structuredClone(value));
                return value.id;
              }),
            delete: (id: string) =>
              request(() => {
                if (storeName === 'driveLinks' && failure.linkDelete)
                  throw Error('Link deletion failed');
                activeRecords.delete(id);
              }),
            openCursor: () => {
              const keys = [...activeRecords.keys()];
              let index = 0;
              const cursor = { result: null as unknown, onsuccess: () => {} };
              const advance = () => {
                const operation = request(() => {
                  while (index < keys.length && !activeRecords.has(keys[index])) ++index;
                  const id = keys[index++];
                  cursor.result =
                    id === undefined
                      ? null
                      : {
                          value: activeRecords.get(id),
                          delete: () =>
                            request(() => {
                              if (failure.linkDelete) throw Error('Link deletion failed');
                              activeRecords.delete(id);
                            }),
                          continue: advance,
                        };
                });
                operation.onsuccess = () => cursor.onsuccess();
              };
              advance();
              return cursor;
            },
          };
        },
      };
      return tx;
    },
  };
  vi.stubGlobal('indexedDB', {
    open: () => {
      const request = { result: db, onsuccess: () => {} };
      queueMicrotask(() => request.onsuccess());
      return request;
    },
  });
  return { records, links, put, modes, storeNames, failure };
}

describe('home designation in browser storage', () => {
  it.each(['local', 'drive', 'both'] as const)(
    'atomically applies %s scope to shared associations without removing other local copies',
    async (scope) => {
      const selected = makeTree('Selected'),
        other = makeTree('Other'),
        unrelated = makeTree('Unrelated');
      const storage = browserStorage([selected, other, unrelated]);
      for (const tree of [selected, other, unrelated])
        await saveDriveLink({
          treeId: tree.id,
          id: tree === unrelated ? 'another-backup' : 'shared',
          name: '',
          modifiedTime: '',
        });
      await removeWorkspaceStorage({
        treeId: scope === 'drive' ? undefined : selected.id,
        backupId: scope === 'local' ? undefined : 'shared',
      });
      expect((await getTree(selected.id)) !== undefined).toBe(scope === 'drive');
      expect(await getTree(other.id)).toEqual(other);
      expect(await getDriveLink(selected.id)).toBeUndefined();
      expect((await getDriveLink(other.id)) !== undefined).toBe(scope === 'local');
      expect((await getDriveLink(unrelated.id))?.id).toBe('another-backup');
      expect(storage.storeNames).toContainEqual(['trees', 'driveLinks']);
    },
  );
  it('rolls back tree removal when link cleanup fails, then supports retry', async () => {
    const tree = makeTree('Kept');
    const storage = browserStorage([tree]);
    await saveDriveLink({ treeId: tree.id, id: 'backup', name: '', modifiedTime: '' });
    storage.failure.linkDelete = true;
    await expect(removeWorkspaceStorage({ treeId: tree.id, backupId: 'backup' })).rejects.toThrow(
      'Link deletion failed',
    );
    expect(await getTree(tree.id)).toEqual(tree);
    expect((await getDriveLink(tree.id))?.id).toBe('backup');
    storage.failure.linkDelete = false;
    await removeWorkspaceStorage({ treeId: tree.id, backupId: 'backup' });
    expect(await getTree(tree.id)).toBeUndefined();
    expect(await getDriveLink(tree.id)).toBeUndefined();
  });
  it('lists every Drive association in a read-only transaction without writing trees', async () => {
    const { put, modes } = browserStorage([]);
    const links = ['first', 'second'].map((treeId) => ({
      treeId,
      id: 'same-backup',
      name: 'Family',
      modifiedTime: '2026-10-10',
    }));
    for (const link of links) await saveDriveLink(link);
    const writes = modes.length;
    expect(await listDriveLinks()).toEqual(links);
    expect(modes.slice(writes)).toEqual(['readonly']);
    expect(put).not.toHaveBeenCalled();
  });
  it('preserves both timestamps through repeated local saves and reads', async () => {
    browserStorage([]);
    const tree = { ...makeTree('Saved'), updatedAt: 100, dataUpdatedAt: 80 };
    await saveTree(tree);
    expect(await getTree(tree.id)).toEqual(tree);
    await saveTree(tree);
    expect(await listTrees()).toEqual([tree]);
  });
  it('persists incomplete Drive restore status alongside its association without altering the local tree', async () => {
    const tree = { ...makeTree('Incomplete'), people: [makePerson('Missing portrait')] };
    browserStorage([tree]);
    const link = {
      treeId: tree.id,
      id: 'drive-backup',
      name: 'Incomplete.json',
      modifiedTime: '',
      restoreWarnings: [{ personId: tree.people[0].id, name: tree.people[0].name }],
    };
    await saveDriveLink(link);
    expect(await getDriveLink(tree.id)).toEqual(link);
    expect(await getTree(tree.id)).toEqual(tree);
    const copy = await duplicateSavedTree(tree.id);
    expect(await getDriveLink(copy.id)).toBeUndefined();
  });
  it('persists a separate copy without the original Drive link and supports independent edits and deletion', async () => {
    const tree = { ...makeTree('Original'), people: [makePerson('A')] };
    const original = structuredClone(tree);
    browserStorage([tree]);
    await saveDriveLink({
      treeId: tree.id,
      id: 'drive-file',
      name: 'Original.json',
      modifiedTime: '2026-10-08',
    });
    const copy = await duplicateSavedTree(tree.id);
    expect(await getTree(copy.id)).toEqual(copy);
    expect(await getTree(tree.id)).toEqual(original);
    expect(await listTrees()).toHaveLength(2);
    expect(await getDriveLink(copy.id)).toBeUndefined();
    expect((await getDriveLink(tree.id))!.id).toBe('drive-file');
    copy.people[0].notes = 'Copied notes';
    await saveTree(copy);
    expect((await getTree(copy.id))!.people[0].notes).toBe('Copied notes');
    expect(await getTree(tree.id)).toEqual(original);
    await deleteTree(copy.id);
    expect(await getTree(copy.id)).toBeUndefined();
    expect(await listTrees()).toEqual([original]);
  });
  it('duplicates the latest persisted edit while the library still holds an older tile', async () => {
    const cachedTile = { ...makeTree('Before edit'), people: [makePerson('A')] };
    const snapshot = structuredClone(cachedTile);
    const storage = browserStorage([cachedTile]);
    const parent = { ...cachedTile.people[0], x: -500, notes: 'Latest notes' };
    const child = makePerson('New child', 350, 400);
    const persisted: Tree = {
      ...cachedTile,
      name: 'After edit',
      people: [parent, child],
      homePersonId: child.id,
      relations: [
        {
          id: 'new-parent',
          type: 'parent',
          parentId: parent.id,
          childId: child.id,
          kind: 'biological',
        },
      ],
      viewport: { x: -200, y: 50, zoom: 0.5 },
    };
    await saveTree(persisted);
    const copy = await duplicateSavedTree(cachedTile.id);
    expect(copy).toEqual({
      ...persisted,
      id: copy.id,
      name: 'After edit (copy)',
      updatedAt: copy.updatedAt,
      dataUpdatedAt: copy.dataUpdatedAt,
    });
    expect(copy.id).not.toBe(persisted.id);
    expect(await getTree(copy.id)).toEqual(copy);
    expect(await getTree(persisted.id)).toEqual(persisted);
    expect(cachedTile).toEqual(snapshot);
    expect(storage.put).toHaveBeenCalledTimes(2);
  });
  it('does not recreate a tree that disappeared after the library was loaded', async () => {
    const storage = browserStorage([]);
    await expect(duplicateSavedTree('deleted-tree')).rejects.toThrow('This tree was not found.');
    expect(storage.put).not.toHaveBeenCalled();
    expect(await listTrees()).toEqual([]);
  });
  it('reports a failed source read instead of falling back to a cached tree', async () => {
    const storage = browserStorage([]);
    vi.stubGlobal('indexedDB', {
      open: () => {
        const request = { error: Error('Storage unavailable'), onerror: () => {} };
        queueMicrotask(() => request.onerror());
        return request;
      },
    });
    await expect(duplicateSavedTree('cached-id')).rejects.toThrow('Storage unavailable');
    expect(storage.put).not.toHaveBeenCalled();
  });
  it('persists explicit life status even when the death date is unknown', async () => {
    browserStorage([]);
    const person = { ...makePerson('A'), lifeStatus: 'deceased' as const };
    const tree = { ...makeTree(), people: [person] };
    await saveTree(tree);
    expect((await getTree(tree.id))!.people[0]).toEqual(person);
    expect((await listTrees())[0].people[0].lifeStatus).toBe('deceased');
    await saveTree({ ...tree, people: [{ ...person, lifeStatus: 'living' }] });
    expect((await getTree(tree.id))!.people[0].lifeStatus).toBe('living');
  });
  it('opens legacy full names in separate fields without mutating stored records', async () => {
    const { firstName: _first, lastName: _last, ...person } = makePerson('Ada Lovelace');
    const tree = { ...makeTree(), people: [person] };
    const storage = browserStorage([tree]);
    expect((await getTree(tree.id))!.people[0]).toMatchObject({
      firstName: 'Ada',
      lastName: 'Lovelace',
    });
    expect((await listTrees())[0].people[0]).toMatchObject({
      firstName: 'Ada',
      lastName: 'Lovelace',
    });
    expect(storage.records.get(tree.id)).toEqual(tree);
    expect(storage.put).not.toHaveBeenCalled();
  });

  it('normalizes legacy reads without rewriting records or timestamps', async () => {
    const { homePersonId: _home, ...legacy } = makeTree();
    const storage = browserStorage([legacy]);
    expect(await getTree(legacy.id)).toEqual({ ...legacy, homePersonId: null });
    expect(await listTrees()).toEqual([{ ...legacy, homePersonId: null }]);
    expect(await getTree('missing')).toBeUndefined();
    expect(storage.put).not.toHaveBeenCalled();
    expect(storage.modes).toEqual(['readonly', 'readonly', 'readonly']);
    expect(storage.records.get(legacy.id)).toEqual(legacy);
  });
  it('round-trips designation changes independently for each local tree', async () => {
    browserStorage([]);
    const a = makePerson('A'),
      b = makePerson('B');
    const tree = { ...makeTree(), people: [a, b] };
    const other = { ...makeTree(), people: [a] };
    await saveTree(setHomePerson(tree, a.id));
    await saveTree(other);
    expect((await getTree(tree.id))!.homePersonId).toBe(a.id);
    expect((await getTree(other.id))!.homePersonId).toBeNull();
    await saveTree(setHomePerson(tree, b.id));
    expect((await getTree(tree.id))!.homePersonId).toBe(b.id);
    await saveTree(setHomePerson(tree, null));
    expect((await getTree(tree.id))!.homePersonId).toBeNull();
  });
});
