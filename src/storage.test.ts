import { afterEach, describe, expect, it, vi } from 'vitest';
import { makePerson, makeTree, setHomePerson, type Tree } from './model';
import {
  deleteTree,
  duplicateSavedTree,
  getDriveLink,
  getTree,
  listTrees,
  saveDriveLink,
  saveTree,
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
  const db = {
    close: vi.fn(),
    transaction: (storeName: string, mode: string) => {
      modes.push(mode);
      const activeRecords = storeName === 'driveLinks' ? links : records;
      const tx = {
        oncomplete: () => {},
        objectStore: () => {
          const request = (read: () => unknown) => {
            const result = { result: undefined as unknown };
            queueMicrotask(() => {
              result.result = read();
              tx.oncomplete();
            });
            return result;
          };
          return {
            get: (id: string) => request(() => structuredClone(activeRecords.get(id))),
            getAll: () => request(() => structuredClone([...activeRecords.values()])),
            put: (value: { id: string; treeId?: string }) =>
              request(() => {
                if (storeName === 'driveLinks') {
                  links.set(value.treeId, structuredClone(value));
                  return value.treeId;
                }
                return put(value);
              }),
            delete: (id: string) =>
              request(() => {
                activeRecords.delete(id);
              }),
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
  return { records, put, modes };
}

describe('home designation in browser storage', () => {
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
