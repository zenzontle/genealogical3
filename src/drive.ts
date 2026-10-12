import type { Tree } from './model';
import { assertValidLifeDates, normalizeHomePerson, validateTree } from './model';
import { driveAccessToken } from './driveAuth';
export { authorizeDrive, disconnectDrive, driveConfigured, restoreDrive } from './driveAuth';
const marker = { app: 'GENEalogical3', format: 'tree-v1' };
const folderName = 'genealogical3';
const folderMimeType = 'application/vnd.google-apps.folder';
async function request(url: string, options: RequestInit = {}) {
  let token = await driveAccessToken();
  const send = async () => {
    try {
      return await fetch(url, {
        ...options,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(options.headers || {}),
        },
      });
    } catch {
      throw Error('Could not reach Google Drive. Your local tree is unchanged.');
    }
  };
  let response = await send();
  if (response.status === 401) {
    token = await driveAccessToken(true);
    response = await send();
  }
  if (response.status === 401) {
    throw Error('Google Drive access expired. Choose a Drive action to reconnect.');
  }
  if (!response.ok)
    throw Error(`Google Drive request failed (${response.status}). Your local tree is unchanged.`);
  return response;
}
export type DriveFile = { id: string; name: string; modifiedTime: string };
async function findDriveFolderId(): Promise<string | undefined> {
  const query = new URLSearchParams({
    q: `trashed = false and name = '${folderName}' and mimeType = '${folderMimeType}' and 'root' in parents`,
    fields: 'nextPageToken,files(id)',
    pageSize: '1',
    orderBy: 'createdTime',
  });
  let pageToken: string | undefined;
  do {
    if (pageToken) query.set('pageToken', pageToken);
    const response = await request(`https://www.googleapis.com/drive/v3/files?${query}`);
    const data = (await response.json()) as { files?: { id: string }[]; nextPageToken?: string };
    const id = data.files?.[0]?.id;
    if (typeof id === 'string' && id) return id;
    pageToken = data.nextPageToken;
  } while (pageToken);
}

async function getUploadFolderId(): Promise<string> {
  const existingId = await findDriveFolderId();
  if (existingId) return existingId;
  const response = await request('https://www.googleapis.com/drive/v3/files?fields=id', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: folderName,
      mimeType: folderMimeType,
      parents: ['root'],
      appProperties: { app: marker.app },
    }),
  });
  const folder = (await response.json()) as { id?: string };
  if (typeof folder.id !== 'string' || !folder.id) {
    throw Error('Google Drive did not return a folder identifier. Your local tree is unchanged.');
  }
  return folder.id;
}
export async function listDriveTrees(): Promise<DriveFile[]> {
  const folderId = await findDriveFolderId();
  if (!folderId) return [];
  const escapedFolderId = folderId.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const query = new URLSearchParams({
    q: `trashed = false and '${escapedFolderId}' in parents and mimeType != '${folderMimeType}' and appProperties has { key='app' and value='GENEalogical3' }`,
    fields: 'nextPageToken,files(id,name,modifiedTime)',
    pageSize: '100',
    orderBy: 'modifiedTime desc',
  });
  const files: DriveFile[] = [];
  let pageToken: string | undefined;
  do {
    if (pageToken) query.set('pageToken', pageToken);
    const response = await request(`https://www.googleapis.com/drive/v3/files?${query}`);
    const data = (await response.json()) as { files?: DriveFile[]; nextPageToken?: string };
    files.push(...(data.files || []));
    pageToken = data.nextPageToken;
  } while (pageToken);
  return files;
}
export async function openDriveTree(id: string): Promise<Tree> {
  const response = await request(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media`,
  );
  return validateTree(await response.json());
}
export async function saveDriveTree(tree: Tree, existingId?: string): Promise<DriveFile> {
  assertValidLifeDates(tree);
  const normalized = normalizeHomePerson(tree);
  const metadata = {
    name: `${tree.name.trim() || 'Family tree'}.genealogical3.json`,
    mimeType: 'application/json',
    appProperties: marker,
    ...(existingId ? {} : { parents: [await getUploadFolderId()] }),
  };
  const boundary = `genealogical3-${crypto.randomUUID()}`;
  const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify({ ...normalized, version: 2 })}\r\n--${boundary}--`;
  const method = existingId ? 'PATCH' : 'POST';
  const url = existingId
    ? `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(existingId)}?uploadType=multipart&fields=id,name,modifiedTime`
    : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,modifiedTime';
  const response = await request(url, {
    method,
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  return response.json() as Promise<DriveFile>;
}
