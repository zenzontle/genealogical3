import type { Tree } from './model';
import { driveContent } from './driveContent';
import { retryAfterDelay } from './retryAfter';
import { assertValidLifeDates, normalizeHomePerson, validateTree } from './model';
import {
  DriveAuthenticationError,
  driveAccessToken,
  expireDriveConnection,
  getDriveGeneration,
} from './driveAuth';
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
export { getDriveConnection, getDriveGeneration, subscribeDriveConnection } from './driveAuth';

const api = 'https://www.googleapis.com/drive/v3/files';
const uploadApi = 'https://www.googleapis.com/upload/drive/v3/files';
const app = 'GENEalogical3';
const folderMimeType = 'application/vnd.google-apps.folder';
const metadataFields =
  'id,name,description,modifiedTime,mimeType,parents,appProperties,trashed,contentRestrictions(readOnly)';
export type DriveFile = { id: string; name: string; description?: string; modifiedTime: string };
type FileMetadata = DriveFile & {
  mimeType: string;
  parents?: string[];
  appProperties?: Record<string, string>;
  trashed?: boolean;
  contentRestrictions?: { readOnly?: boolean }[];
};
export type RestoreWarning = { personId: string; name: string };
export type DriveRestoreResult = {
  tree: Tree;
  restoreWarnings: RestoreWarning[];
  revision?: string;
};
export type DriveSaveResult = DriveFile & { cleanupWarnings: string[]; revision: string };
export type DriveSaveOptions = {
  expectedRevision?: string;
  revision?: string;
  beforeReplace?: () => Promise<void>;
};
export class DriveConflictError extends Error {
  constructor() {
    super('The Drive version changed. Review both versions before continuing.');
  }
}
export type PhotoProgress = { direction: 'upload' | 'download'; completed: number; total: number };
export type ProgressCallback = (progress: PhotoProgress) => void;

export class DriveRequestError extends Error {
  get retryable() {
    return (
      this.status === 0 ||
      this.status === 429 ||
      this.status >= 500 ||
      (this.status === 403 &&
        this.reasons.length > 0 &&
        this.reasons.every((reason) =>
          [
            'rateLimitExceeded',
            'userRateLimitExceeded',
            'quotaExceeded',
            'dailyLimitExceeded',
            'storageQuotaExceeded',
          ].includes(reason),
        ))
    );
  }
  constructor(
    public status: number,
    message: string,
    public reasons: string[] = [],
    public retryAfter = 0,
  ) {
    super(message);
  }
}
function assertGeneration(generation: number) {
  if (generation !== getDriveGeneration())
    throw Error(
      'Google Drive connection changed. Return to Workspace and retry in the intended account.',
    );
}
async function request(url: string, options: RequestInit = {}, generation = getDriveGeneration()) {
  assertGeneration(generation);
  const access = async (refresh = false) => {
    try {
      return await driveAccessToken(refresh);
    } catch (error) {
      if (error instanceof DriveAuthenticationError)
        throw new DriveRequestError(error.status, error.message, [], error.retryAfter);
      throw error;
    }
  };
  let token = await access();
  const send = async () => {
    assertGeneration(generation);
    try {
      const response = await fetch(url, {
        ...options,
        headers: { Authorization: `Bearer ${token}`, ...(options.headers || {}) },
      });
      assertGeneration(generation);
      return response;
    } catch {
      assertGeneration(generation);
      throw new DriveRequestError(0, 'Could not reach Google Drive. Your local tree is unchanged.');
    }
  };
  let response = await send();
  if (response.status === 401) {
    token = await access(true);
    response = await send();
  }
  if (response.status === 401) {
    expireDriveConnection();
    throw new DriveRequestError(
      401,
      'Google Drive access expired. Use Connect Drive in Workspace to reconnect.',
    );
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const reasons = (Array.isArray(body?.error?.errors) ? body.error.errors : []).flatMap(
      (error: { reason?: unknown }) => (typeof error?.reason === 'string' ? [error.reason] : []),
    );
    const retryAfter = retryAfterDelay(response.headers.get('Retry-After'));
    throw new DriveRequestError(
      response.status,
      `Google Drive request failed (${response.status}). Your local tree is unchanged.`,
      reasons,
      retryAfter,
    );
  }
  return response;
}
async function readJson(response: Response) {
  try {
    return await response.json();
  } catch (error) {
    if (error instanceof SyntaxError) throw error;
    throw new DriveRequestError(
      0,
      'The Drive response was interrupted. Your changes remain pending.',
    );
  }
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
const contentReadOnly = (file: FileMetadata) =>
  file.contentRestrictions?.some((restriction) => restriction.readOnly);
const escaped = (value: string) => value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
const mediaUrl = (id: string) => `${api}/${encodeURIComponent(id)}?alt=media`;
const metadataUrl = (id: string) => `${api}/${encodeURIComponent(id)}?fields=${metadataFields}`;
const metadata = async (id: string, generation?: number): Promise<FileMetadata> =>
  readJson(await request(metadataUrl(id), {}, generation));
async function readDocument(id: string, generation?: number): Promise<DriveDocument> {
  return validateDriveDocument(await readJson(await request(mediaUrl(id), {}, generation)), id);
}
async function generateId(generation?: number): Promise<string> {
  const data = await readJson(
    await request(`${api}/generateIds?count=1&space=drive&type=files`, {}, generation),
  );
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
  generation?: number,
): Promise<FileMetadata> {
  let file: FileMetadata;
  try {
    return await readJson(await request(url, options, generation));
  } catch (error) {
    if (
      !(error instanceof DriveRequestError) ||
      !(error.status === 409 || error.status === 0 || error.status >= 500)
    )
      throw error;
    try {
      file = await metadata(id, generation);
    } catch {
      throw error;
    }
  }
  const props = expected.appProperties as Record<string, string>;
  const parents = expected.parents as string[];
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

async function createFolder(
  name: string,
  parent: string,
  kind: string,
  backupId?: string,
  generation?: number,
): Promise<string> {
  const id = await generateId(generation);
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
    generation,
  );
  return id;
}
async function findDriveFolderId(generation?: number): Promise<string | undefined> {
  const query = new URLSearchParams({
    q: `trashed = false and name = 'genealogical3' and mimeType = '${folderMimeType}' and 'root' in parents`,
    fields: 'nextPageToken,files(id)',
    pageSize: '1',
    orderBy: 'createdTime',
  });
  let pageToken: string | undefined;
  do {
    if (pageToken) query.set('pageToken', pageToken);
    const data = (await readJson(await request(`${api}?${query}`, {}, generation))) as {
      files?: { id: string }[];
      nextPageToken?: string;
    };
    if (data.files?.[0]?.id) return data.files[0].id;
    pageToken = data.nextPageToken;
  } while (pageToken);
}
async function getUploadFolderId(generation: number): Promise<string> {
  return (
    (await findDriveFolderId(generation)) ||
    (await createFolder('genealogical3', 'root', 'library', undefined, generation))
  );
}
async function listFiles(query: URLSearchParams, generation?: number): Promise<FileMetadata[]> {
  const files: FileMetadata[] = [];
  let pageToken: string | undefined;
  do {
    if (pageToken) query.set('pageToken', pageToken);
    const data = (await readJson(await request(`${api}?${query}`, {}, generation))) as {
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
      fields: 'nextPageToken,files(id,name,description,modifiedTime)',
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
async function restoreTree(
  id: string,
  generation: number,
  progress?: ProgressCallback,
): Promise<DriveRestoreResult> {
  const file = await metadata(id, generation);
  const legacy =
    !file.trashed && file.appProperties?.app === app && file.appProperties?.format === 'tree-v1';
  if (file.mimeType !== 'application/json' || (!owned(file, 'tree', id) && !legacy))
    throw Error('This file is not an accessible app-owned backup.');
  const input = await readJson(await request(mediaUrl(id), {}, generation));
  assertGeneration(generation);
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
        response = await request(mediaUrl(ref.imageFileId), {}, generation);
      } catch (error) {
        if (
          error instanceof DriveRequestError &&
          !error.retryable &&
          [403, 404, 410].includes(error.status)
        ) {
          images.set(ref.imageFileId, null);
          return;
        }
        throw error;
      }
      // Reading the body can fail independently of fetch (a dropped connection).
      let bytes: Uint8Array<ArrayBuffer>;
      try {
        bytes = new Uint8Array(await response.arrayBuffer());
      } catch {
        throw new DriveRequestError(
          0,
          'The Drive portrait download was interrupted. Your local tree is unchanged.',
        );
      }
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
  assertGeneration(generation);
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
  const current = await readDocument(id, generation);
  if (current.revision !== doc.revision) throw new DriveConflictError();
  return { tree, restoreWarnings, revision: doc.revision };
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
async function photoInventory(doc: DriveDocument, generation: number): Promise<FileMetadata[]> {
  const folder = await metadata(doc.photoFolderId, generation);
  if (!owned(folder, 'photos', doc.backupId) || folder.mimeType !== folderMimeType)
    throw Error('The backup photo folder is missing or does not belong to this backup.');
  const files = await listFiles(
    new URLSearchParams({
      q: `trashed = false and '${escaped(doc.photoFolderId)}' in parents`,
      fields: `nextPageToken,files(${metadataFields})`,
      pageSize: '100',
    }),
    generation,
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
  generation: number,
  existingId?: string,
  progress?: ProgressCallback,
  options: DriveSaveOptions = {},
): Promise<DriveSaveResult> {
  assertGeneration(generation);
  assertValidLifeDates(tree);
  const backupId = existingId || (await generateId(generation));
  let previous: DriveDocument | undefined;
  let folderId: string;
  let inventory: FileMetadata[] = [];
  let parent: string | undefined;
  if (existingId) {
    const file = await metadata(existingId, generation);
    if (!owned(file, 'tree', existingId) || file.mimeType !== 'application/json')
      throw Error(
        'This backup requires attention. Duplicate your local tree in Workspace to save a new backup.',
      );
    if (contentReadOnly(file))
      throw Error(
        'This Drive backup is read-only, possibly because deletion is in progress. Retry deletion in Workspace, or duplicate your local tree to save a new backup.',
      );
    previous = await readDocument(existingId, generation);
    if (options.expectedRevision && previous.revision !== options.expectedRevision)
      throw new DriveConflictError();
    inventory = await photoInventory(previous, generation);
    if (
      previous.portraits.some(
        (ref) =>
          !inventory.some(
            (photo) => photo.id === ref.imageFileId && photo.appProperties?.digest === ref.digest,
          ),
      )
    )
      throw Error(
        'This backup has missing portraits. Duplicate your local tree in Workspace before saving a new backup.',
      );
    folderId = previous.photoFolderId;
  } else {
    parent = await getUploadFolderId(generation);
    folderId = await createFolder(`${backupId}.photos`, parent, 'photos', backupId, generation);
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
      const id = await generateId(generation);
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
        generation,
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
    revision: options.revision || crypto.randomUUID(),
    tree: { ...tree, people: tree.people.map((person) => ({ ...person, portrait: null })) },
    portraits,
  };
  const meta = {
    ...(existingId ? {} : { id: backupId, parents: [parent!] }),
    name: `${backupId}.json`,
    description: tree.name.trim() || 'Family tree',
    mimeType: 'application/json',
    appProperties: { ...properties('tree', backupId), format: 'drive-v1' },
  };
  const content = new Blob([JSON.stringify(doc)], { type: 'application/json' });
  await options.beforeReplace?.();
  if (previous) {
    const fresh = await metadata(backupId, generation);
    if (!owned(fresh, 'tree', backupId)) throw Error('Backup ownership changed. Save stopped.');
    if ((await readDocument(backupId, generation)).revision !== previous.revision)
      throw new DriveConflictError();
  }
  const requestOptions = { method: existingId ? 'PATCH' : 'POST', ...multipart(meta, content) };
  const file: DriveFile = existingId
    ? await readJson(
        await request(
          `${uploadApi}/${encodeURIComponent(existingId)}?uploadType=multipart&fields=id,name,description,modifiedTime`,
          requestOptions,
          generation,
        ),
      )
    : await create(
        backupId,
        `${uploadApi}?uploadType=multipart&fields=${metadataFields}`,
        requestOptions,
        meta,
        generation,
      );
  if ((await readDocument(backupId, generation)).revision !== doc.revision)
    throw new DriveConflictError();
  if (file.id !== backupId)
    throw Error('Drive returned an unexpected backup identity. Save confirmation failed.');
  const cleanupWarnings: string[] = [];
  if (previous) {
    try {
      const current = await readDocument(backupId, generation);
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
            const fresh = await metadata(old.id, generation);
            if (
              owned(fresh, 'portrait', backupId) &&
              fresh.mimeType === 'image/jpeg' &&
              fresh.parents?.includes(folderId)
            )
              await request(
                `${api}/${encodeURIComponent(old.id)}`,
                {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ trashed: true }),
                },
                generation,
              );
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
  assertGeneration(generation);
  return {
    id: file.id,
    name: file.name,
    description: meta.description,
    modifiedTime: file.modifiedTime,
    cleanupWarnings,
    revision: doc.revision,
  };
}
let operations: Promise<unknown> = Promise.resolve();
const deletedBackups = new Set<string>();
/** Local cleanup passes undefined to share the lock independently of the Drive session. */
export function queueDriveOperation<T>(
  generation: number | undefined,
  run: () => Promise<T>,
): Promise<T> {
  const operation = operations
    .catch(() => undefined)
    .then(async () => {
      if (generation !== undefined) assertGeneration(generation);
      // Share the existing save lock with downloads and permanent deletion, including other tabs.
      if (globalThis.navigator?.locks)
        return navigator.locks.request('genealogical3-drive-save', () => {
          if (generation !== undefined) assertGeneration(generation);
          return run();
        });
      return run();
    });
  operations = operation;
  return operation;
}
export function openDriveTree(
  id: string,
  progress?: ProgressCallback,
): Promise<DriveRestoreResult> {
  const generation = getDriveGeneration();
  return queueDriveOperation(generation, () => restoreTree(id, generation, progress));
}
/** Internal coordinator entry points: caller must hold queueDriveOperation's lock. */
export const restoreDriveTreeLocked = restoreTree;
export const saveDriveTreeLocked = saveSnapshot;
/** Revalidate a downloaded backup while holding the lock through its local association commit. */
export async function verifyDriveRestoreLocked(
  id: string,
  generation: number,
  restored: DriveRestoreResult,
) {
  const file = await metadata(id, generation);
  if (file.trashed || file.mimeType !== 'application/json')
    throw Error('The downloaded backup is no longer available.');
  if (restored.revision) {
    if (!owned(file, 'tree', id)) throw Error('The downloaded backup ownership changed.');
    if ((await readDocument(id, generation)).revision !== restored.revision)
      throw new DriveConflictError();
  } else {
    if (file.appProperties?.app !== app || file.appProperties?.format !== 'tree-v1')
      throw Error('The downloaded backup format changed.');
    const tree = validateTree(await readJson(await request(mediaUrl(id), {}, generation)));
    if (JSON.stringify(tree) !== JSON.stringify(restored.tree)) throw new DriveConflictError();
  }
  assertGeneration(generation);
}
export async function inspectDriveTreeLocked(id: string, generation: number) {
  const file = await metadata(id, generation);
  if (!owned(file, 'tree', id) || file.mimeType !== 'application/json')
    throw Error(
      'This backup is missing, inaccessible, or uses an unsupported legacy format. Review it in Workspace.',
    );
  const doc = await readDocument(id, generation);
  return {
    revision: doc.revision,
    tree: doc.tree,
    content: await driveContent(doc.tree, doc.portraits),
    file,
  };
}

/** Keep this state after errors so retries never repeat confirmed permanent deletions. */
export type DriveDeletionProgress = {
  id: string;
  generation: number;
  deletedPortraitIds: string[];
  documentDeleted: boolean;
  documentAttempted: boolean;
  photoFolderId?: string;
  folderAttempted: boolean;
  folderDeleted: boolean;
  portraitAttempted?: string;
  revision?: string;
};
export function createDriveDeletion(id: string): DriveDeletionProgress {
  return {
    id,
    generation: getDriveGeneration(),
    deletedPortraitIds: [],
    documentDeleted: false,
    documentAttempted: false,
    folderAttempted: false,
    folderDeleted: false,
  };
}
const deletionOwned = (file: FileMetadata, kind: string, id: string) =>
  file.appProperties?.app === app &&
  file.appProperties?.kind === kind &&
  file.appProperties?.backupId === id;
async function deleteBackup(progress: DriveDeletionProgress) {
  const { id, generation } = progress;
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw Error('Invalid Google Drive backup identifier.');
  assertGeneration(generation);
  const remove = async (fileId: string) => {
    try {
      await request(`${api}/${encodeURIComponent(fileId)}`, { method: 'DELETE' }, generation);
    } catch (error) {
      // An earlier verified DELETE may have succeeded despite a lost response.
      if (!(error instanceof DriveRequestError && error.status === 404)) throw error;
    }
  };
  let file: FileMetadata;
  try {
    file = await metadata(id, generation);
  } catch (error) {
    if (!(error instanceof DriveRequestError && error.status === 404 && progress.documentAttempted))
      throw error;
    progress.documentDeleted = true;
    deletedBackups.add(`${generation}:${id}`);
    return;
  }
  const legacy = file.appProperties?.app === app && file.appProperties?.format === 'tree-v1';
  if (
    file.id !== id ||
    file.mimeType !== 'application/json' ||
    (!deletionOwned(file, 'tree', id) && !legacy)
  )
    throw Error('This file is not an app-owned tree backup. Deletion stopped.');
  const input = await readJson(await request(mediaUrl(id), {}, generation));
  let requireWriteProtection = false;
  const verifyDocument = async () => {
    const fresh = await metadata(id, generation);
    if (
      fresh.id !== id ||
      fresh.mimeType !== 'application/json' ||
      (legacy
        ? fresh.appProperties?.app !== app || fresh.appProperties?.format !== 'tree-v1'
        : !deletionOwned(fresh, 'tree', id))
    )
      throw Error('The backup ownership changed. The tree document was kept.');
    if (requireWriteProtection && !contentReadOnly(fresh))
      throw Error(
        'The backup write protection changed. Deletion stopped. Retry deletion in Workspace.',
      );
    const current = await readJson(await request(mediaUrl(id), {}, generation));
    if (JSON.stringify(current) !== JSON.stringify(input))
      throw Error('The backup changed during deletion. The tree document was kept.');
    return fresh;
  };
  if (legacy) {
    validateTree(input);
    if (input?.format === driveFormat)
      throw Error('The backup identity does not match its metadata.');
  } else {
    const doc = validateDriveDocument(input, id);
    if (progress.revision && progress.revision !== doc.revision)
      throw Error(
        'The backup changed during deletion. Reopen its Workspace card to review before retrying.',
      );
    progress.revision = doc.revision;
    if (progress.photoFolderId && progress.photoFolderId !== doc.photoFolderId)
      throw Error(
        'The backup photo folder changed during deletion. Reopen Workspace to review it.',
      );
    progress.photoFolderId = doc.photoFolderId;
    const verifyFolder = async () => {
      if (progress.folderDeleted) return;
      let folder: FileMetadata;
      try {
        folder = await metadata(doc.photoFolderId, generation);
      } catch (error) {
        if (
          !(error instanceof DriveRequestError) ||
          !(error.status === 404 || (error.status === 403 && !error.retryable))
        )
          throw error;
        if (error.status === 404 && progress.folderAttempted) {
          progress.folderDeleted = true;
          return;
        }
        throw Error(
          'The backup photos folder is missing or inaccessible. Restore access to it in Google Drive, then retry in the intended account. Deletion stopped.',
        );
      }
      if (
        folder.id !== doc.photoFolderId ||
        folder.id === id ||
        folder.mimeType !== folderMimeType ||
        !deletionOwned(folder, 'photos', id)
      )
        throw Error(
          'The photos folder does not belong to this backup. Deletion stopped to protect unrelated files.',
        );
    };
    // Validate the exact document-owned folder before deleting any portrait.
    await verifyFolder();
    // Do not exclude Trash: superseded portraits must also be permanently removed.
    const inventory = await listFiles(
      new URLSearchParams({
        q: `appProperties has { key='app' and value='${app}' } and appProperties has { key='kind' and value='portrait' } and appProperties has { key='backupId' and value='${escaped(id)}' }`,
        fields: `nextPageToken,files(${metadataFields})`,
        pageSize: '100',
      }),
      generation,
    );
    const ids = new Set([
      ...doc.portraits.map((ref) => ref.imageFileId),
      ...inventory.map((photo) => photo.id),
      ...(progress.portraitAttempted ? [progress.portraitAttempted] : []),
    ]);
    const verifyPortrait = async (photoId: string) => {
      let photo: FileMetadata;
      try {
        photo = await metadata(photoId, generation);
      } catch (error) {
        if (!(error instanceof DriveRequestError && error.status === 404)) throw error;
        // Missing references need no deletion; count only our verified, attempted DELETEs.
        if (progress.portraitAttempted === photoId) progress.deletedPortraitIds.push(photoId);
        return false;
      }
      if (
        photo.id !== photoId ||
        !deletionOwned(photo, 'portrait', id) ||
        photo.mimeType !== 'image/jpeg'
      )
        throw Error(
          'A portrait does not belong to this backup. Deletion stopped to protect unrelated files.',
        );
      return true;
    };
    const verifiedPortraitIds: string[] = [];
    // Preflight every candidate so a validation failure leaves the retained backup intact.
    for (const photoId of ids) {
      if (!progress.deletedPortraitIds.includes(photoId) && (await verifyPortrait(photoId)))
        verifiedPortraitIds.push(photoId);
    }
    const fresh = await verifyDocument();
    // Drive enforces this barrier even for other devices that already passed save preflight.
    // Keep it through partial failures: a retained document must not accept new revisions.
    if (!contentReadOnly(fresh))
      await request(
        `${api}/${encodeURIComponent(id)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contentRestrictions: [
              {
                readOnly: true,
                reason: 'GENEalogical3 backup deletion in progress. Retry deletion in Workspace.',
              },
            ],
          }),
        },
        generation,
      );
    requireWriteProtection = true;
    // A writer may have committed just before the barrier was installed.
    await verifyDocument();
    for (const photoId of verifiedPortraitIds) {
      await verifyDocument();
      await verifyFolder();
      if (!(await verifyPortrait(photoId))) continue;
      progress.portraitAttempted = photoId;
      await remove(photoId);
      progress.deletedPortraitIds.push(photoId);
      progress.portraitAttempted = undefined;
    }
    await verifyDocument();
    // Recheck ownership immediately before DELETE; drive.file may hide descendants.
    // Google also permanently deletes user-owned contents, as disclosed in confirmation.
    await verifyFolder();
    if (!progress.folderDeleted) {
      progress.folderAttempted = true;
      await remove(doc.photoFolderId);
      progress.folderDeleted = true;
    }
  }
  await verifyDocument();
  progress.documentAttempted = true;
  await remove(id);
  progress.documentDeleted = true;
  deletedBackups.add(`${generation}:${id}`);
}
const deletions = new WeakMap<DriveDeletionProgress, Promise<void>>();
export function deleteDriveBackup(
  progress: DriveDeletionProgress,
  afterDelete?: () => Promise<void>,
): Promise<void> {
  if (progress.documentDeleted)
    return afterDelete ? queueDriveOperation(undefined, afterDelete) : Promise.resolve();
  const pending = deletions.get(progress);
  if (pending) return pending;
  const operation = queueDriveOperation(progress.generation, async () => {
    await deleteBackup(progress);
    await afterDelete?.();
  })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'Drive deletion failed.';
      const completed = progress.deletedPortraitIds.length;
      if (progress.documentDeleted)
        throw Error(
          `${message} The Drive backup was permanently deleted.${progress.folderDeleted ? ' The photos folder and files you own inside it were also permanently deleted.' : ''} Retry to finish browser cleanup.`,
          { cause: error },
        );
      const portraitStatus = completed
        ? `${completed} portrait file${completed === 1 ? '' : 's'} permanently deleted.`
        : progress.folderDeleted
          ? ''
          : 'No files have been confirmed deleted.';
      const folderStatus = progress.folderDeleted
        ? 'The photos folder and files you own inside it were permanently deleted.'
        : progress.photoFolderId
          ? 'The photos folder has not been confirmed deleted.'
          : '';
      throw Error(
        [
          message,
          portraitStatus,
          folderStatus,
          'The tree document has not been confirmed deleted. Retry to finish cleanup.',
        ]
          .filter(Boolean)
          .join(' '),
        { cause: error },
      );
    })
    .finally(() => deletions.delete(progress));
  deletions.set(progress, operation);
  return operation;
}
export function saveDriveTree(
  tree: Tree,
  existingId?: string,
  progress?: ProgressCallback,
  options?: DriveSaveOptions,
): Promise<DriveSaveResult> {
  // Capture the session and tree before waiting for another save.
  const generation = getDriveGeneration();
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
  return queueDriveOperation(generation, () => {
    if (existingId && deletedBackups.has(`${generation}:${existingId}`))
      throw Error(
        'This Drive backup was deleted. Duplicate your tree in Workspace to save a new backup.',
      );
    return saveSnapshot(snapshot, generation, existingId, progress, options);
  });
}
