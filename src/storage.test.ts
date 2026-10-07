import { afterEach, describe, expect, it, vi } from 'vitest';
import { makePerson, makeTree, setHomePerson } from './model';
import { getTree, listTrees, saveTree } from './storage';

afterEach(() => vi.unstubAllGlobals());

// A small asynchronous IDB boundary fake checks the real storage functions,
// including read-only legacy normalization, without adding a dependency.
function browserStorage(initial: unknown[]) {
  const records = new Map(initial.map((value) => [(value as { id: string }).id, value]));
  const put = vi.fn((value: { id: string }) => {
    records.set(value.id, structuredClone(value));
    return value.id;
  });
  const modes: string[] = [];
  const db = {
    close: vi.fn(),
    transaction: (_store: string, mode: string) => {
      modes.push(mode);
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
            get: (id: string) => request(() => structuredClone(records.get(id))),
            getAll: () => request(() => structuredClone([...records.values()])),
            put: (value: { id: string }) => request(() => put(value)),
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
