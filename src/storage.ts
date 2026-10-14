import { assertValidLifeDates, duplicateTree, normalizeHomePerson, type Tree } from './model';
import { normalizePersonNames } from './personNames';
import type { RestoreWarning } from './drive';
const DB = 'genealogical3';
const STORE = 'trees';
const LINKS = 'driveLinks';
const SETTINGS = 'driveSyncSettings';
export type SyncConflict = {
  localDataUpdatedAt: number;
  remoteDataUpdatedAt: number;
  revision: string;
};
export type DriveSync = {
  acknowledgedDataUpdatedAt?: number;
  revision?: string;
  pending?: boolean;
  editedAt?: number;
  upload?: { revision: string; dataUpdatedAt: number; content: string };
  retries?: number;
  retryable?: boolean;
  retryAt?: number;
  attention?: string;
  conflict?: SyncConflict;
};
export const storageChanged = () => {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('tree-storage-changed'));
};
export type DriveLink = {
  treeId: string;
  id: string;
  name: string;
  description?: string;
  modifiedTime: string;
  restoreWarnings?: RestoreWarning[];
  cleanupWarnings?: string[];
  sync?: DriveSync;
};
// Navigation and local-save timestamps do not identify a different data version.
export const storedTreeData = (tree: Tree) => {
  const normalized = normalizePersonNames(normalizeHomePerson(tree));
  return JSON.stringify([
    normalized.dataUpdatedAt,
    normalized.name,
    normalized.homePersonId,
    normalized.people,
    normalized.relations,
  ]);
};
export class TreeChangedError extends Error {
  constructor() {
    super('This tree changed in another tab. Reopen it from Workspace before saving.');
  }
}
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 3);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE))
        request.result.createObjectStore(STORE, { keyPath: 'id' });
      if (!request.result.objectStoreNames.contains(LINKS))
        request.result.createObjectStore(LINKS, { keyPath: 'treeId' });
      if (!request.result.objectStoreNames.contains(SETTINGS))
        request.result.createObjectStore(SETTINGS, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || Error('Could not open browser storage.'));
  });
}
async function transaction<T>(
  storeName: string,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const request = run(tx.objectStore(storeName));
    request.onerror = () => {
      db.close();
      reject(request.error || Error('Browser storage failed.'));
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error || Error('Browser storage was interrupted.'));
    };
    tx.oncomplete = () => {
      const value = request.result;
      db.close();
      resolve(value);
    };
  });
}
export const listTrees = () =>
  transaction<Tree[]>(STORE, 'readonly', (store) => store.getAll()).then((trees) =>
    trees.map((tree) => normalizePersonNames(normalizeHomePerson(tree))),
  );
export const getTree = (id: string) =>
  transaction<Tree | undefined>(STORE, 'readonly', (store) => store.get(id)).then((tree) =>
    tree ? normalizePersonNames(normalizeHomePerson(tree)) : undefined,
  );
export const saveTree = (tree: Tree, expected?: Tree) => {
  assertValidLifeDates(tree);
  const normalized = normalizeHomePerson(tree);
  return updateLinkedTree(tree.id, (previous, link) => {
    if (expected && (!previous || storedTreeData(previous) !== storedTreeData(expected)))
      throw new TreeChangedError();
    if (link && previous?.dataUpdatedAt !== normalized.dataUpdatedAt) {
      link.sync = {
        ...link.sync,
        pending: link.sync?.acknowledgedDataUpdatedAt !== normalized.dataUpdatedAt,
        // Monotonic data timestamps can run ahead after a system clock change.
        editedAt: Math.min(normalized.dataUpdatedAt, Date.now()),
      };
    }
    return { tree: { ...normalized, version: 2 }, link };
  }).then(() => tree.id);
};
/** Read/modify both records in one transaction; callbacks never await remote work. */
export async function updateLinkedTree(
  id: string,
  update: (
    tree: Tree | undefined,
    link: DriveLink | undefined,
  ) => { tree?: Tree; link?: DriveLink },
): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([STORE, LINKS], 'readwrite');
    const trees = tx.objectStore(STORE),
      links = tx.objectStore(LINKS);
    const tree = trees.get(id),
      link = links.get(id);
    let completed = 0;
    let failure: unknown;
    const ready = () => {
      if (++completed !== 2) return;
      try {
        const next = update(tree.result, link.result);
        if (next.tree) trees.put(next.tree);
        if (next.link) links.put(next.link);
      } catch (error) {
        failure = error;
        tx.abort();
      }
    };
    tree.onsuccess = ready;
    link.onsuccess = ready;
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onabort = () => {
      db.close();
      reject(failure || tx.error || Error('Browser storage was interrupted.'));
    };
  });
  storageChanged();
}
export const getLastDriveAttempt = () =>
  transaction<{ id: string; at: number } | undefined>(SETTINGS, 'readonly', (store) =>
    store.get('attempt'),
  ).then((value) => value?.at || 0);
export const setLastDriveAttempt = (at: number) =>
  transaction(SETTINGS, 'readwrite', (store) => store.put({ id: 'attempt', at }));
/** Read the committed document, since a library tile may lag behind an editor save. */
export async function duplicateSavedTree(id: string): Promise<Tree> {
  const source = await getTree(id);
  if (!source) throw Error('This tree was not found.');
  const copy = duplicateTree(source);
  await saveTree(copy);
  return copy;
}
export const deleteTree = (id: string) =>
  transaction<undefined>(STORE, 'readwrite', (store) => store.delete(id));
export const getDriveLink = (treeId: string) =>
  transaction<DriveLink | undefined>(LINKS, 'readonly', (store) => store.get(treeId));
export const listDriveLinks = () =>
  transaction<DriveLink[]>(LINKS, 'readonly', (store) => store.getAll());
export const saveDriveLink = (link: DriveLink) =>
  transaction<IDBValidKey>(LINKS, 'readwrite', (store) => store.put(link)).then((key) => {
    storageChanged();
    return key;
  });
export const deleteDriveLink = (treeId: string) =>
  transaction<undefined>(LINKS, 'readwrite', (store) => store.delete(treeId));

/** Remove a local copy and/or every association with a deleted backup atomically. */
export async function removeWorkspaceStorage({
  treeId,
  backupId,
}: {
  treeId?: string;
  backupId?: string;
}): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE, LINKS], 'readwrite');
    const links = tx.objectStore(LINKS);
    if (treeId) {
      tx.objectStore(STORE).delete(treeId);
      links.delete(treeId);
    }
    if (backupId) {
      const cursor = links.openCursor();
      cursor.onsuccess = () => {
        const entry = cursor.result;
        if (!entry) return;
        if ((entry.value as DriveLink).id === backupId) entry.delete();
        entry.continue();
      };
    }
    tx.oncomplete = () => {
      db.close();
      storageChanged();
      resolve();
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error || Error('Browser storage was interrupted.'));
    };
    tx.onerror = () => {
      /* onabort reports the transaction failure after rollback. */
    };
  });
}
