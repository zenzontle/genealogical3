import type { Tree } from './model';
import { assertValidLifeDates, normalizeHomePerson, validateTree } from './model';
import { driveAccessToken } from './driveAuth';
import {
  driveFormat,
  embeddedPortrait,
  isJpeg,
  photoDigest,
  portraitBytes,
  validateDriveDocument,
  type DriveDocument,
  type PortraitReference,
} from './driveDocument';
export { authorizeDrive, disconnectDrive, driveConfigured, restoreDrive } from './driveAuth';

const api = 'https://www.googleapis.com/drive/v3/files';
const uploadApi = 'https://www.googleapis.com/upload/drive/v3/files';
const app = 'GENEalogical3';
const folderMimeType = 'application/vnd.google-apps.folder';
const metadataFields = 'id,name,modifiedTime,mimeType,parents,appProperties,trashed';
export type DriveFile = { id: string; name: string; modifiedTime: string };
type FileMetadata = DriveFile & {
  mimeType: string;
  parents?: string[];
  appProperties?: Record<string, string>;
  trashed?: boolean;
};
export type RestoreWarning = { personId: string; name: string };
export type DriveRestoreResult = { tree: Tree; restoreWarnings: RestoreWarning[] };
export type DriveSaveResult = DriveFile & { cleanupWarnings: string[] };
export type PhotoProgress = { direction: 'upload' | 'download'; completed: number; total: number };
export type ProgressCallback = (progress: PhotoProgress) => void;

class DriveRequestError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
async function request(url: string, options: RequestInit = {}) {
  let token = await driveAccessToken();
  const send = async () => {
    try {
      return await fetch(url, {
        ...options,
        headers: { Authorization: `Bearer ${token}`, ...(options.headers || {}) },
      });
    } catch {
      throw new DriveRequestError(0, 'Could not reach Google Drive. Your local tree is unchanged.');
    }
  };
  let response = await send();
  if (response.status === 401) {
    token = await driveAccessToken(true);
    response = await send();
  }
  if (response.status === 401)
    throw new DriveRequestError(
      401,
      'Google Drive access expired. Choose a Drive action to reconnect.',
    );
  if (!response.ok)
    throw new DriveRequestError(
      response.status,
      `Google Drive request failed (${response.status}). Your local tree is unchanged.`,
    );
  return response;
}
const properties = (kind: string, backupId?: string) => ({
  app,
  kind,
  ...(backupId ? { backupId } : {}),
});
const owned = (file: FileMetadata, kind: string, backupId: string) =>
  !file.trashed &&
  file.appProperties?.app === app &&
  file.appProperties?.kind === kind &&
  file.appProperties?.backupId === backupId;
const escaped = (value: string) => value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
const mediaUrl = (id: string) => `${api}/${encodeURIComponent(id)}?alt=media`;
const metadataUrl = (id: string) => `${api}/${encodeURIComponent(id)}?fields=${metadataFields}`;
const metadata = async (id: string): Promise<FileMetadata> =>
  (await request(metadataUrl(id))).json();
async function readDocument(id: string): Promise<DriveDocument> {
  return validateDriveDocument(await (await request(mediaUrl(id))).json(), id);
}
async function generateId(): Promise<string> {
  const data = await (await request(`${api}/generateIds?count=1&space=drive&type=files`)).json();
  if (typeof data.ids?.[0] !== 'string' || !data.ids[0])
    throw Error('Google Drive did not return a file identifier.');
  return data.ids[0];
}
// Only creates with a pre-generated ID are retried. Lost responses may produce
// 409, which is checked against the intended resource's metadata.
async function create(
  id: string,
  url: string,
  options: RequestInit,
  expected: Record<string, unknown>,
): Promise<FileMetadata> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await (await request(url, options)).json();
    } catch (error) {
      if (!(error instanceof DriveRequestError)) throw error;
      if (error.status === 409) {
        const file = await metadata(id);
        const props = expected.appProperties as Record<string, string>;
        const parents = expected.parents as string[];
        // Drive resolves the special 'root' parent alias to the actual root ID.
        if (
          file.id !== id ||
          file.trashed ||
          file.name !== expected.name ||
          file.mimeType !== expected.mimeType ||
          !parents.every((parent) => parent === 'root' || file.parents?.includes(parent)) ||
          !Object.entries(props).every(([key, value]) => file.appProperties?.[key] === value)
        )
          throw Error('Google Drive create conflict. Please retry the save.');
        return file;
      }
      if (attempt >= 2 || !(error.status === 0 || error.status === 429 || error.status >= 500))
        throw error;
      await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
    }
  }
}
async function createFolder(
  name: string,
  parent: string,
  kind: string,
  backupId?: string,
): Promise<string> {
  const id = await generateId();
  const body = {
    id,
    name,
    mimeType: folderMimeType,
    parents: [parent],
    appProperties: properties(kind, backupId),
  };
  await create(
    id,
    `${api}?fields=${metadataFields}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    body,
  );
  return id;
}
async function findDriveFolderId(): Promise<string | undefined> {
  const query = new URLSearchParams({
    q: `trashed = false and name = 'genealogical3' and mimeType = '${folderMimeType}' and 'root' in parents`,
    fields: 'nextPageToken,files(id)',
    pageSize: '1',
    orderBy: 'createdTime',
  });
  let pageToken: string | undefined;
  do {
    if (pageToken) query.set('pageToken', pageToken);
    const data = (await (await request(`${api}?${query}`)).json()) as {
      files?: { id: string }[];
      nextPageToken?: string;
    };
    if (data.files?.[0]?.id) return data.files[0].id;
    pageToken = data.nextPageToken;
  } while (pageToken);
}
async function getUploadFolderId(): Promise<string> {
  return (await findDriveFolderId()) || (await createFolder('genealogical3', 'root', 'library'));
}
async function listFiles(query: URLSearchParams): Promise<FileMetadata[]> {
  const files: FileMetadata[] = [];
  let pageToken: string | undefined;
  do {
    if (pageToken) query.set('pageToken', pageToken);
    const data = (await (await request(`${api}?${query}`)).json()) as {
      files?: FileMetadata[];
      nextPageToken?: string;
    };
    files.push(...(data.files || []));
    pageToken = data.nextPageToken;
  } while (pageToken);
  return files;
}
export async function listDriveTrees(): Promise<DriveFile[]> {
  const folderId = await findDriveFolderId();
  if (!folderId) return [];
  return listFiles(
    new URLSearchParams({
      q: `trashed = false and '${escaped(folderId)}' in parents and mimeType = 'application/json' and appProperties has { key='app' and value='${app}' } and (appProperties has { key='kind' and value='tree' } or appProperties has { key='format' and value='tree-v1' })`,
      fields: 'nextPageToken,files(id,name,modifiedTime)',
      pageSize: '100',
      orderBy: 'modifiedTime desc',
    }),
  );
}
// Drain all workers after a failure before releasing the save lock.
async function transfer<T>(
  items: T[],
  work: (item: T) => Promise<void>,
  direction: PhotoProgress['direction'],
  progress?: ProgressCallback,
) {
  let next = 0,
    completed = 0;
  let failure: unknown;
  let failed = false;
  progress?.({ direction, completed, total: items.length });
  await Promise.all(
    Array.from({ length: Math.min(3, items.length) }, async () => {
      while (!failed && next < items.length) {
        const item = items[next++];
        try {
          await work(item);
          progress?.({ direction, completed: ++completed, total: items.length });
        } catch (error) {
          failed = true;
          failure = error;
        }
      }
    }),
  );
  if (failed) throw failure;
}
export async function openDriveTree(
  id: string,
  progress?: ProgressCallback,
): Promise<DriveRestoreResult> {
  const input = await (await request(mediaUrl(id))).json();
  // Preserve the existing portable-file read path; no legacy migration is performed.
  if (input?.format !== driveFormat) return { tree: validateTree(input), restoreWarnings: [] };
  const doc = validateDriveDocument(input, id);
  const images = new Map<string, string | null>();
  const refs = [...new Map(doc.portraits.map((ref) => [ref.imageFileId, ref])).values()];
  await transfer(
    refs,
    async (ref) => {
      let response: Response;
      try {
        response = await request(mediaUrl(ref.imageFileId));
      } catch (error) {
        if (error instanceof DriveRequestError && [403, 404, 410].includes(error.status)) {
          images.set(ref.imageFileId, null);
          return;
        }
        throw error;
      }
      // Reading the body can fail independently of fetch (a dropped connection).
      const bytes = new Uint8Array(await response.arrayBuffer());
      const mime = response.headers.get('Content-Type')?.split(';')[0].trim();
      if (mime !== 'image/jpeg' || !isJpeg(bytes) || (await photoDigest(bytes)) !== ref.digest) {
        images.set(ref.imageFileId, null);
        return;
      }
      try {
        const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }));
        const valid =
          bitmap.width > 0 && bitmap.height > 0 && Math.max(bitmap.width, bitmap.height) <= 512;
        bitmap.close();
        images.set(ref.imageFileId, valid ? embeddedPortrait(bytes) : null);
      } catch {
        images.set(ref.imageFileId, null);
      }
    },
    'download',
    progress,
  );
  const byPerson = new Map(doc.portraits.map((ref) => [ref.personId, ref]));
  const restoreWarnings: RestoreWarning[] = [];
  const tree = {
    ...doc.tree,
    people: doc.tree.people.map((person) => {
      const ref = byPerson.get(person.id);
      if (!ref) return person;
      const portrait = images.get(ref.imageFileId) || null;
      if (!portrait) restoreWarnings.push({ personId: person.id, name: person.name });
      return { ...person, portrait };
    }),
  };
  return { tree, restoreWarnings };
}
function multipart(meta: Record<string, unknown>, content: Blob) {
  const boundary = `genealogical3-${crypto.randomUUID()}`;
  return {
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body: new Blob([
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n`,
      `--${boundary}\r\nContent-Type: ${content.type}\r\n\r\n`,
      content,
      `\r\n--${boundary}--`,
    ]),
  };
}
async function photoInventory(doc: DriveDocument): Promise<FileMetadata[]> {
  const folder = await metadata(doc.photoFolderId);
  if (!owned(folder, 'photos', doc.backupId) || folder.mimeType !== folderMimeType)
    throw Error('The backup photo folder is missing or does not belong to this backup.');
  const files = await listFiles(
    new URLSearchParams({
      q: `trashed = false and '${escaped(doc.photoFolderId)}' in parents`,
      fields: `nextPageToken,files(${metadataFields})`,
      pageSize: '100',
    }),
  );
  return files.filter(
    (file) =>
      owned(file, 'portrait', doc.backupId) &&
      file.mimeType === 'image/jpeg' &&
      file.parents?.includes(doc.photoFolderId),
  );
}
async function saveSnapshot(
  tree: Tree,
  existingId?: string,
  progress?: ProgressCallback,
): Promise<DriveSaveResult> {
  const backupId = existingId || (await generateId());
  let previous: DriveDocument | undefined;
  let folderId: string;
  let inventory: FileMetadata[] = [];
  let parent: string | undefined;
  if (existingId) {
    const file = await metadata(existingId);
    if (!owned(file, 'tree', existingId) || file.mimeType !== 'application/json')
      throw Error('This file is not a separate-photo backup. Use Save a copy.');
    previous = await readDocument(existingId);
    inventory = await photoInventory(previous);
    folderId = previous.photoFolderId;
  } else {
    parent = await getUploadFolderId();
    folderId = await createFolder(`${backupId}.photos`, parent, 'photos', backupId);
  }
  const portraits: PortraitReference[] = [];
  const photos = new Map<string, { bytes: Uint8Array<ArrayBuffer>; refs: PortraitReference[] }>();
  for (const person of tree.people) {
    if (!person.portrait) continue;
    const bytes = portraitBytes(person.portrait),
      digest = await photoDigest(bytes);
    const ref: PortraitReference = {
      personId: person.id,
      imageFileId: '',
      mimeType: 'image/jpeg',
      digest,
    };
    portraits.push(ref);
    const photo = photos.get(digest);
    if (photo) photo.refs.push(ref);
    else photos.set(digest, { bytes, refs: [ref] });
  }
  const uploads: { digest: string; bytes: Uint8Array<ArrayBuffer>; refs: PortraitReference[] }[] =
    [];
  for (const [digest, photo] of photos) {
    const available = inventory.find((file) => file.appProperties?.digest === digest);
    if (available)
      photo.refs.forEach((ref) => {
        ref.imageFileId = available.id;
      });
    else uploads.push({ digest, ...photo });
  }
  await transfer(
    uploads,
    async (photo) => {
      const id = await generateId();
      const meta = {
        id,
        name: `${photo.digest}.jpg`,
        mimeType: 'image/jpeg',
        parents: [folderId],
        appProperties: { ...properties('portrait', backupId), digest: photo.digest },
      };
      await create(
        id,
        `${uploadApi}?uploadType=multipart&fields=${metadataFields}`,
        { method: 'POST', ...multipart(meta, new Blob([photo.bytes], { type: 'image/jpeg' })) },
        meta,
      );
      photo.refs.forEach((ref) => {
        ref.imageFileId = id;
      });
    },
    'upload',
    progress,
  );
  const doc: DriveDocument = {
    format: driveFormat,
    version: 1,
    backupId,
    photoFolderId: folderId,
    revision: crypto.randomUUID(),
    tree: { ...tree, people: tree.people.map((person) => ({ ...person, portrait: null })) },
    portraits,
  };
  const meta = {
    ...(existingId ? {} : { id: backupId, parents: [parent!] }),
    name: `${tree.name.trim() || 'Family tree'}.genealogical3.json`,
    mimeType: 'application/json',
    appProperties: { ...properties('tree', backupId), format: 'drive-v1' },
  };
  const content = new Blob([JSON.stringify(doc)], { type: 'application/json' });
  const options = { method: existingId ? 'PATCH' : 'POST', ...multipart(meta, content) };
  const file: DriveFile = existingId
    ? await (
        await request(
          `${uploadApi}/${encodeURIComponent(existingId)}?uploadType=multipart&fields=id,name,modifiedTime`,
          options,
        )
      ).json()
    : await create(
        backupId,
        `${uploadApi}?uploadType=multipart&fields=${metadataFields}`,
        options,
        meta,
      );
  const cleanupWarnings: string[] = [];
  if (previous) {
    try {
      const current = await readDocument(backupId);
      if (JSON.stringify(current) !== JSON.stringify(doc))
        cleanupWarnings.push('Photo cleanup skipped because another save changed the backup.');
      else {
        const currentIds = new Set(current.portraits.map((ref) => ref.imageFileId));
        const previousIds = new Set(previous.portraits.map((ref) => ref.imageFileId));
        for (const old of inventory.filter(
          (photo) => previousIds.has(photo.id) && !currentIds.has(photo.id),
        )) {
          try {
            // Check ownership and location again immediately before trashing.
            const fresh = await metadata(old.id);
            if (
              owned(fresh, 'portrait', backupId) &&
              fresh.mimeType === 'image/jpeg' &&
              fresh.parents?.includes(folderId)
            )
              await request(`${api}/${encodeURIComponent(old.id)}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ trashed: true }),
              });
          } catch {
            cleanupWarnings.push(
              `Saved successfully, but photo ${old.id} could not be moved to Drive Trash.`,
            );
          }
        }
      }
    } catch {
      cleanupWarnings.push('Saved successfully, but photo cleanup could not be completed.');
    }
  }
  return { id: file.id, name: file.name, modifiedTime: file.modifiedTime, cleanupWarnings };
}
let saves: Promise<unknown> = Promise.resolve();
export function saveDriveTree(
  tree: Tree,
  existingId?: string,
  progress?: ProgressCallback,
): Promise<DriveSaveResult> {
  // Capture before waiting for another save; caller edits cannot alter this operation.
  let snapshot: Tree;
  try {
    assertValidLifeDates(tree);
    snapshot = structuredClone(normalizeHomePerson(tree));
    snapshot.people.forEach((person) => {
      if (person.portrait) portraitBytes(person.portrait);
    });
  } catch (error) {
    return Promise.reject(error);
  }
  const operation = saves
    .catch(() => undefined)
    .then(async () => {
      const run = () => saveSnapshot(snapshot, existingId, progress);
      // Web Locks also serialize saves from other tabs of this browser and origin.
      if (globalThis.navigator?.locks) {
        return await navigator.locks.request('genealogical3-drive-save', run);
      }
      return run();
    });
  saves = operation;
  return operation;
}
