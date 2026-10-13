import { assertValidLifeDates, duplicateTree, normalizeHomePerson, type Tree } from './model';
import { normalizePersonNames } from './personNames';
import type { RestoreWarning } from './drive';
const DB = 'genealogical3';
const STORE = 'trees';
const LINKS = 'driveLinks';
export type DriveLink = {
  treeId: string;
  id: string;
  name: string;
  description?: string;
  modifiedTime: string;
  restoreWarnings?: RestoreWarning[];
};
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE))
        request.result.createObjectStore(STORE, { keyPath: 'id' });
      if (!request.result.objectStoreNames.contains(LINKS))
        request.result.createObjectStore(LINKS, { keyPath: 'treeId' });
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
export const saveTree = (tree: Tree) => {
  assertValidLifeDates(tree);
  const normalized = normalizeHomePerson(tree);
  return transaction<IDBValidKey>(STORE, 'readwrite', (store) =>
    store.put({ ...normalized, version: 2 }),
  );
};
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
  transaction<IDBValidKey>(LINKS, 'readwrite', (store) => store.put(link));
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
