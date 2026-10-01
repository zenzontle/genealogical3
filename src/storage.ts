import { assertValidLifeDates, normalizeHomePerson, type Tree } from "./model";
const DB = "genealogical3";
const STORE = "trees";
const LINKS = "driveLinks";
export type DriveLink = {
  treeId: string;
  id: string;
  name: string;
  modifiedTime: string;
};
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE))
        request.result.createObjectStore(STORE, { keyPath: "id" });
      if (!request.result.objectStoreNames.contains(LINKS))
        request.result.createObjectStore(LINKS, { keyPath: "treeId" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error || Error("Could not open browser storage."));
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
      reject(request.error || Error("Browser storage failed."));
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error || Error("Browser storage was interrupted."));
    };
    tx.oncomplete = () => {
      const value = request.result;
      db.close();
      resolve(value);
    };
  });
}
export const listTrees = () =>
  transaction<Tree[]>(STORE, "readonly", (store) => store.getAll()).then(
    (trees) => trees.map(normalizeHomePerson),
  );
export const getTree = (id: string) =>
  transaction<Tree | undefined>(STORE, "readonly", (store) =>
    store.get(id),
  ).then((tree) => (tree ? normalizeHomePerson(tree) : undefined));
export const saveTree = (tree: Tree) => {
  assertValidLifeDates(tree);
  const normalized = normalizeHomePerson(tree);
  return transaction<IDBValidKey>(STORE, "readwrite", (store) =>
    store.put({ ...normalized, version: 2 }),
  );
};
export const deleteTree = (id: string) =>
  transaction<undefined>(STORE, "readwrite", (store) => store.delete(id));
export const getDriveLink = (treeId: string) =>
  transaction<DriveLink | undefined>(LINKS, "readonly", (store) =>
    store.get(treeId),
  );
export const saveDriveLink = (link: DriveLink) =>
  transaction<IDBValidKey>(LINKS, "readwrite", (store) => store.put(link));
export const deleteDriveLink = (treeId: string) =>
  transaction<undefined>(LINKS, "readwrite", (store) => store.delete(treeId));
