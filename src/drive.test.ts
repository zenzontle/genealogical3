import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makePerson, makeTree, validateTree, type Tree } from './model';
import { photoDigest, type DriveDocument } from './driveDocument';

const session = vi.hoisted(() => ({ generation: 0 }));
vi.mock('./driveAuth', () => ({
  getDriveGeneration: () => session.generation,
  driveAccessToken: vi.fn(async () => 'token'),
  authorizeDrive: vi.fn(),
  disconnectDrive: vi.fn(),
  restoreDrive: vi.fn(),
  driveConfigured: true,
  expireDriveConnection: vi.fn(),
}));
import { driveAccessToken } from './driveAuth';
import {
  createDriveDeletion,
  deleteDriveBackup,
  listDriveTrees,
  openDriveTree,
  saveDriveTree,
  type PhotoProgress,
} from './drive';

const jpeg = (value = 1) => Uint8Array.from([0xff, 0xd8, value, 0xff, 0xd9]);
const portrait = (value = 1) =>
  `data:image/jpeg;base64,${Buffer.from(jpeg(value)).toString('base64')}`;
function family(values: (number | null)[] = [1, 2]): Tree {
  return {
    ...makeTree('Family'),
    people: values.map((value, index) => ({
      ...makePerson(`Person ${index}`),
      portrait: value === null ? null : portrait(value),
    })),
  };
}
type RemoteFile = {
  id: string;
  name: string;
  modifiedTime: string;
  mimeType: string;
  parents: string[];
  appProperties: Record<string, string>;
  trashed?: boolean;
  content: Uint8Array;
};
type Call = { url: URL; options: RequestInit; meta?: Partial<RemoteFile> };
function fakeDrive() {
  const files = new Map<string, RemoteFile>();
  const calls: Call[] = [];
  const hooks: {
    before?: (call: Call) => Promise<Response | void>;
    after?: (call: Call) => Promise<Response | void>;
  } = {};
  let counter = 0;
  const json = (value: unknown, status = 200) =>
    new Response(JSON.stringify(value), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  const fetchMock = vi.fn(async (input: string, options: RequestInit = {}) => {
    const url = new URL(input),
      call: Call = { url, options };
    calls.push(call);
    let content = new Uint8Array();
    if (options.body instanceof Blob) {
      const boundary = String((options.headers as Record<string, string>)['Content-Type']).split(
        'boundary=',
      )[1];
      const raw = Buffer.from(await options.body.arrayBuffer()).toString('latin1');
      const parts = raw.split(`--${boundary}`);
      call.meta = JSON.parse(
        Buffer.from(parts[1].split('\r\n\r\n')[1].trim(), 'latin1').toString('utf8'),
      );
      content = new Uint8Array(Buffer.from(parts[2].split('\r\n\r\n')[1].slice(0, -2), 'latin1'));
    } else if (options.body) call.meta = JSON.parse(String(options.body));
    const intercepted = await hooks.before?.(call);
    if (intercepted) return intercepted;
    if (url.pathname.endsWith('/generateIds')) return json({ ids: [`remote-${++counter}`] });
    if (!options.method && url.pathname === '/drive/v3/files') {
      const query = url.searchParams.get('q') || '';
      const listed = [...files.values()].filter((file) => {
        if (query.includes('trashed = false') && file.trashed) return false;
        for (const match of query.matchAll(
          /appProperties has \{ key='([^']+)' and value='([^']+)' \}/g,
        ))
          if (!(query.includes(' or ') && ['kind', 'format'].includes(match[1])))
            if (file.appProperties[match[1]] !== match[2]) return false;
        const parent = /'([^']+)' in parents/.exec(query)?.[1];
        if (parent && !file.parents.includes(parent)) return false;
        if (query.includes("name = 'genealogical3'") && file.name !== 'genealogical3') return false;
        if (query.includes("mimeType = 'application/json'") && file.mimeType !== 'application/json')
          return false;
        return true;
      });
      return json({ files: listed });
    }
    const id = url.pathname.split('/').at(-1)!;
    if (options.method === 'POST') {
      const meta = call.meta as RemoteFile;
      if (files.has(meta.id)) return json({}, 409);
      const file = { ...meta, modifiedTime: '2026-10-12T12:00:00Z', content };
      files.set(file.id, file);
      return (await hooks.after?.(call)) || json(file);
    }
    const file = files.get(id);
    if (!file) return json({}, 404);
    if (options.method === 'DELETE') {
      files.delete(id);
      return (await hooks.after?.(call)) || new Response(null, { status: 204 });
    }
    if (options.method === 'PATCH') {
      Object.assign(file, call.meta);
      if (options.body instanceof Blob) file.content = content;
      return (await hooks.after?.(call)) || json(file);
    }
    if (url.searchParams.get('alt') === 'media') if (file.trashed) return json({}, 404);
    if (url.searchParams.get('alt') === 'media')
      return new Response(new Uint8Array(file.content), {
        headers: { 'Content-Type': file.mimeType },
      });
    return json(file);
  });
  vi.stubGlobal('fetch', fetchMock);
  return {
    files,
    calls,
    hooks,
    fetchMock,
    document: (id: string) =>
      JSON.parse(Buffer.from(files.get(id)!.content).toString('utf8')) as DriveDocument,
    setDocument: (id: string, doc: DriveDocument) => {
      files.get(id)!.content = new TextEncoder().encode(JSON.stringify(doc));
    },
    photoUploads: () =>
      calls.filter(
        (call) => call.options.method === 'POST' && call.meta?.mimeType === 'image/jpeg',
      ),
    trashCalls: () => calls.filter((call) => call.meta?.trashed),
  };
}
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
};
beforeEach(() => {
  ++session.generation;
  vi.mocked(driveAccessToken).mockReset().mockResolvedValue('token');
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => ({ width: 128, height: 256, close: vi.fn() })),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('permanent Drive deletion', () => {
  it('deletes current and superseded portraits, their folder, and the document last, retaining the library and unrelated files', async () => {
    const remote = fakeDrive();
    const file = await saveDriveTree(family([1, 2]));
    const old = remote.document(file.id).portraits[0].imageFileId;
    await saveDriveTree(family([3]), file.id);
    expect(remote.files.get(old)?.trashed).toBe(true);
    const folderId = remote.document(file.id).photoFolderId;
    remote.files.set('unrelated', {
      ...remote.files.get(old)!,
      id: 'unrelated',
      appProperties: {},
      parents: remote.files.get(file.id)!.parents,
      trashed: false,
    });
    remote.calls.length = 0;
    const progress = createDriveDeletion(file.id);
    await deleteDriveBackup(progress);
    const deleted = remote.calls
      .filter((call) => call.options.method === 'DELETE')
      .map((call) => call.url.pathname.split('/').at(-1));
    expect(deleted).toContain(old);
    expect(deleted.at(-1)).toBe(file.id);
    expect(deleted).toHaveLength(5);
    expect(deleted.at(-2)).toBe(folderId);
    expect(remote.files.has(folderId)).toBe(false);
    expect(remote.files.has(remote.files.get('unrelated')!.parents[0])).toBe(true);
    expect(remote.files.has('unrelated')).toBe(true);
    expect(progress.documentDeleted).toBe(true);
  });
  it.each([false, true])(
    'deletes a backup with no portraits and a trashed folder: %s',
    async (trashed) => {
      const remote = fakeDrive();
      const file = await saveDriveTree(family([]));
      const folderId = remote.document(file.id).photoFolderId;
      remote.files.get(folderId)!.trashed = trashed;
      await deleteDriveBackup(createDriveDeletion(file.id));
      expect(remote.files.has(folderId)).toBe(false);
      expect(remote.files.has(file.id)).toBe(false);
    },
  );
  it('finishes deletion when the photo folder is already missing', async () => {
    const remote = fakeDrive();
    const file = await saveDriveTree(family([1]));
    remote.files.delete(remote.document(file.id).photoFolderId);
    await deleteDriveBackup(createDriveDeletion(file.id));
    expect(remote.files.has(file.id)).toBe(false);
  });
  it.each(['app', 'kind', 'backupId', 'mimeType'])(
    'preserves the backup and portraits when the photo folder has changed %s',
    async (field) => {
      const remote = fakeDrive();
      const file = await saveDriveTree(family([1]));
      const folder = remote.files.get(remote.document(file.id).photoFolderId)!;
      if (field === 'mimeType') folder.mimeType = 'application/json';
      else folder.appProperties[field] = 'other';
      remote.calls.length = 0;
      await expect(deleteDriveBackup(createDriveDeletion(file.id))).rejects.toThrow(
        /photo folder does not belong/,
      );
      expect(remote.calls.some((call) => call.options.method === 'DELETE')).toBe(false);
    },
  );
  it.each([false, true])(
    'preserves unrelated folder contents, including Trash: %s',
    async (trashed) => {
      const remote = fakeDrive();
      const file = await saveDriveTree(family([1]));
      const photo = remote.files.get(remote.document(file.id).portraits[0].imageFileId)!;
      remote.files.set('unrelated', { ...photo, id: 'unrelated', appProperties: {}, trashed });
      remote.calls.length = 0;
      await expect(deleteDriveBackup(createDriveDeletion(file.id))).rejects.toThrow(
        /unrelated files/,
      );
      expect(remote.calls.some((call) => call.options.method === 'DELETE')).toBe(false);
    },
  );
  it('retains the document and retries a failed folder deletion after portraits are deleted', async () => {
    const remote = fakeDrive();
    const file = await saveDriveTree(family([1]));
    const folderId = remote.document(file.id).photoFolderId;
    remote.hooks.before = async (call) => {
      if (call.options.method === 'DELETE' && call.url.pathname.endsWith(folderId))
        return new Response('', { status: 500 });
    };
    const progress = createDriveDeletion(file.id);
    await expect(deleteDriveBackup(progress)).rejects.toThrow(
      /1 portrait file permanently deleted/,
    );
    expect(remote.files.has(file.id)).toBe(true);
    expect(remote.files.has(folderId)).toBe(true);
    remote.hooks.before = undefined;
    remote.calls.length = 0;
    await deleteDriveBackup(progress);
    expect(
      remote.calls
        .filter((call) => call.options.method === 'DELETE')
        .map((call) => call.url.pathname.split('/').at(-1)),
    ).toEqual([folderId, file.id]);
  });
  it.each(['ownership', 'contents'] as const)(
    'rechecks folder %s after portrait deletion',
    async (change) => {
      const remote = fakeDrive();
      const file = await saveDriveTree(family([1]));
      const folderId = remote.document(file.id).photoFolderId;
      const folder = remote.files.get(folderId)!;
      remote.hooks.after = async (call) => {
        if (call.options.method !== 'DELETE') return;
        if (change === 'ownership') folder.appProperties.backupId = 'other';
        else
          remote.files.set('unrelated', {
            ...folder,
            id: 'unrelated',
            parents: [folderId],
            appProperties: {},
          });
      };
      await expect(deleteDriveBackup(createDriveDeletion(file.id))).rejects.toThrow(/photo folder/);
      expect(remote.files.has(folderId)).toBe(true);
      expect(remote.files.has(file.id)).toBe(true);
    },
  );
  it('deletes a validated legacy portable backup document only', async () => {
    const remote = fakeDrive();
    const file = await saveDriveTree(family([]));
    remote.files.get(file.id)!.appProperties = { app: 'GENEalogical3', format: 'tree-v1' };
    remote.files.get(file.id)!.content = new TextEncoder().encode(JSON.stringify(family([1])));
    remote.calls.length = 0;
    await deleteDriveBackup(createDriveDeletion(file.id));
    expect(remote.calls.filter((call) => call.options.method === 'DELETE')).toHaveLength(1);
    expect(remote.calls.some((call) => call.url.searchParams.get('q')?.includes('portrait'))).toBe(
      false,
    );
  });
  it.each(['app', 'kind', 'backupId', 'mimeType', 'document'])(
    'refuses invalid backup identity: %s',
    async (field) => {
      const remote = fakeDrive();
      const file = await saveDriveTree(family([1]));
      if (field === 'mimeType')
        remote.files.get(file.id)!.mimeType = 'application/vnd.google-apps.folder';
      else if (field === 'document') {
        const doc = remote.document(file.id);
        doc.backupId = 'other';
        remote.setDocument(file.id, doc);
      } else remote.files.get(file.id)!.appProperties[field] = 'other';
      remote.calls.length = 0;
      await expect(deleteDriveBackup(createDriveDeletion(file.id))).rejects.toThrow();
      expect(remote.calls.some((call) => call.options.method === 'DELETE')).toBe(false);
    },
  );
  it.each(['app', 'kind', 'backupId', 'mimeType'])(
    'preserves every portrait when a later referenced portrait has changed %s',
    async (field) => {
      const remote = fakeDrive();
      const file = await saveDriveTree(family([1, 2]));
      const doc = remote.document(file.id);
      const id = doc.portraits[1].imageFileId;
      if (field === 'mimeType')
        remote.files.get(id)!.mimeType = 'application/vnd.google-apps.folder';
      else remote.files.get(id)!.appProperties[field] = 'other';
      remote.calls.length = 0;
      const progress = createDriveDeletion(file.id);
      await expect(deleteDriveBackup(progress)).rejects.toThrow(/unrelated files/);
      expect(remote.calls.some((call) => call.options.method === 'DELETE')).toBe(false);
      expect(progress.deletedPortraitIds).toEqual([]);
      expect(doc.portraits.every((ref) => remote.files.has(ref.imageFileId))).toBe(true);
      expect(remote.document(file.id)).toEqual(doc);
      expect(remote.files.has(file.id)).toBe(true);
    },
  );
  it('preserves the backup when a superseded portrait in Trash fails preflight', async () => {
    const remote = fakeDrive();
    const file = await saveDriveTree(family([1]));
    const old = remote.document(file.id).portraits[0].imageFileId;
    await saveDriveTree(family([2]), file.id);
    expect(remote.files.get(old)?.trashed).toBe(true);
    remote.files.get(old)!.mimeType = 'image/png';
    const doc = remote.document(file.id);
    remote.calls.length = 0;
    await expect(deleteDriveBackup(createDriveDeletion(file.id))).rejects.toThrow(
      /No files have been confirmed deleted/,
    );
    expect(remote.calls.some((call) => call.options.method === 'DELETE')).toBe(false);
    expect(remote.files.has(old)).toBe(true);
    expect(remote.files.has(doc.portraits[0].imageFileId)).toBe(true);
    expect(remote.document(file.id)).toEqual(doc);
  });
  it('stops on failure, reports partial deletion, and resumes without repeating completed steps', async () => {
    const remote = fakeDrive();
    const file = await saveDriveTree(family([1, 2]));
    const doc = remote.document(file.id);
    const second = doc.portraits[1].imageFileId;
    remote.hooks.before = async (call) => {
      if (call.options.method === 'DELETE' && call.url.pathname.endsWith(second))
        return new Response('', { status: 500 });
    };
    const progress = createDriveDeletion(file.id);
    await expect(deleteDriveBackup(progress)).rejects.toThrow(
      /1 portrait file permanently deleted/,
    );
    expect(remote.files.has(file.id)).toBe(true);
    expect(progress.deletedPortraitIds).toEqual([doc.portraits[0].imageFileId]);
    remote.calls.length = 0;
    remote.hooks.before = undefined;
    await deleteDriveBackup(progress);
    expect(
      remote.calls
        .filter((call) => call.options.method === 'DELETE')
        .map((call) => call.url.pathname.split('/').at(-1)),
    ).toEqual([second, doc.photoFolderId, file.id]);
  });
  it.each(['portrait', 'folder', 'document'] as const)(
    'recovers a lost %s DELETE response without recreating anything',
    async (target) => {
      const remote = fakeDrive();
      const file = await saveDriveTree(family([1]));
      const id =
        target === 'portrait'
          ? remote.document(file.id).portraits[0].imageFileId
          : target === 'folder'
            ? remote.document(file.id).photoFolderId
            : file.id;
      remote.hooks.after = async (call) => {
        if (call.options.method === 'DELETE' && call.url.pathname.endsWith(id))
          throw Error('lost response');
      };
      const progress = createDriveDeletion(file.id);
      await expect(deleteDriveBackup(progress)).rejects.toThrow(/confirmed/);
      remote.hooks.after = undefined;
      await deleteDriveBackup(progress);
      expect(progress.documentDeleted).toBe(true);
      expect(remote.files.has(file.id)).toBe(false);
      expect(
        remote.calls.filter(
          (call) => call.options.method === 'DELETE' && call.url.pathname.endsWith(id),
        ),
      ).toHaveLength(1);
    },
  );
  it('stops deletion when authorization expires and preserves the document', async () => {
    const remote = fakeDrive();
    const file = await saveDriveTree(family([1]));
    remote.hooks.before = async (call) => {
      if (call.options.method === 'DELETE') return new Response('', { status: 401 });
    };
    await expect(deleteDriveBackup(createDriveDeletion(file.id))).rejects.toThrow(/access expired/);
    expect(remote.files.has(file.id)).toBe(true);
    expect(driveAccessToken).toHaveBeenCalledWith(true);
  });
  it('stops on an account change without sending requests using the new account', async () => {
    const remote = fakeDrive();
    const file = await saveDriveTree(family([1, 2]));
    const first = remote.document(file.id).portraits[0].imageFileId;
    remote.hooks.after = async (call) => {
      if (call.options.method === 'DELETE' && call.url.pathname.endsWith(first)) {
        ++session.generation;
        vi.mocked(driveAccessToken).mockResolvedValue('other-account');
      }
    };
    remote.calls.length = 0;
    await expect(deleteDriveBackup(createDriveDeletion(file.id))).rejects.toThrow(
      /connection changed/,
    );
    expect(remote.files.has(file.id)).toBe(true);
    expect(
      remote.calls.every(
        (call) => (call.options.headers as Record<string, string>).Authorization === 'Bearer token',
      ),
    ).toBe(true);
  });
  it('serializes deletion with saves and blocks a queued overwrite of a deleted backup', async () => {
    const remote = fakeDrive();
    const file = await saveDriveTree(family([]));
    const gate = deferred(),
      reached = deferred();
    remote.hooks.before = async (call) => {
      if (call.options.method === 'DELETE') {
        reached.resolve();
        await gate.promise;
      }
    };
    const pending = deleteDriveBackup(createDriveDeletion(file.id));
    await reached.promise;
    const overwrite = saveDriveTree(family([]), file.id);
    const rejected = expect(overwrite).rejects.toThrow(/backup was deleted/);
    gate.resolve();
    await pending;
    await rejected;
    expect(remote.files.has(file.id)).toBe(false);
  });
  it('preserves the document if another device changes the backup during portrait cleanup', async () => {
    const remote = fakeDrive();
    const file = await saveDriveTree(family([1]));
    remote.hooks.after = async (call) => {
      if (call.options.method === 'DELETE') {
        const doc = remote.document(file.id);
        doc.revision = 'new-revision';
        remote.setDocument(file.id, doc);
      }
    };
    await expect(deleteDriveBackup(createDriveDeletion(file.id))).rejects.toThrow(/backup changed/);
    expect(remote.files.has(file.id)).toBe(true);
  });
});

describe('separate-photo Drive backups', () => {
  it('renames an existing document to the shared backup ID when overwriting, and gives copies their own ID', async () => {
    const remote = fakeDrive();
    const tree = family([]);
    const file = await saveDriveTree(tree);
    const folderId = remote.document(file.id).photoFolderId;
    remote.files.get(file.id)!.name = 'Family.genealogical3.json';
    tree.name = 'Renamed family';
    const updated = await saveDriveTree(tree, file.id);
    expect(updated.name).toBe(`${file.id}.json`);
    expect(remote.document(file.id).photoFolderId).toBe(folderId);
    expect(remote.files.get(folderId)!.name).toBe(`${file.id}.photos`);
    expect(remote.document(file.id).tree.name).toBe('Renamed family');
    const copy = await saveDriveTree(tree);
    expect(copy.id).not.toBe(file.id);
    expect(copy.name).toBe(`${copy.id}.json`);
    expect(remote.files.get(remote.document(copy.id).photoFolderId)!.name).toBe(
      `${copy.id}.photos`,
    );
  });
  it.each(['copy', 'overwrite'] as const)(
    'cancels %s saves when the account changes during a portrait upload',
    async (mode) => {
      const remote = fakeDrive();
      const existing = mode === 'overwrite' ? await saveDriveTree(family([1])) : undefined;
      const previous = existing && remote.document(existing.id);
      remote.calls.length = 0;
      const reached = deferred(),
        gate = deferred();
      remote.hooks.before = async (call) => {
        if (call.meta?.mimeType === 'image/jpeg') {
          reached.resolve();
          await gate.promise;
        }
      };
      const pending = saveDriveTree(family([2, 3, 4, 5]), existing?.id);
      const canceled = expect(pending).rejects.toThrow(/connection changed/i);
      await reached.promise;
      ++session.generation;
      vi.mocked(driveAccessToken).mockResolvedValue('other-account');
      gate.resolve();
      await canceled;
      expect(
        remote.calls.every(
          (call) =>
            (call.options.headers as Record<string, string>).Authorization === 'Bearer token',
        ),
      ).toBe(true);
      expect(remote.calls.some((call) => call.meta?.mimeType === 'application/json')).toBe(false);
      if (existing) expect(remote.document(existing.id)).toEqual(previous);
      remote.hooks.before = undefined;
      await saveDriveTree(family([]));
      expect(
        remote.calls.some(
          (call) =>
            (call.options.headers as Record<string, string>).Authorization ===
            'Bearer other-account',
        ),
      ).toBe(true);
    },
  );
  it('cancels queued saves from the old session before obtaining the new account token', async () => {
    const remote = fakeDrive(),
      reached = deferred(),
      gate = deferred();
    remote.hooks.before = async (call) => {
      if (call.url.pathname.endsWith('/generateIds')) {
        reached.resolve();
        await gate.promise;
      }
    };
    const first = saveDriveTree(family([]));
    const firstCanceled = expect(first).rejects.toThrow(/connection changed/i);
    await reached.promise;
    const queued = saveDriveTree(family([]));
    const queuedCanceled = expect(queued).rejects.toThrow(/connection changed/i);
    const tokens = vi.mocked(driveAccessToken).mock.calls.length;
    ++session.generation;
    gate.resolve();
    const results = await Promise.allSettled([firstCanceled, queuedCanceled]);
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'fulfilled']);
    expect(remote.calls).toHaveLength(1);
    expect(driveAccessToken).toHaveBeenCalledTimes(tokens);
  });
  it('does not send a write with a token acquired across a session change', async () => {
    const remote = fakeDrive();
    vi.mocked(driveAccessToken).mockImplementationOnce(async () => {
      ++session.generation;
      return 'other-account';
    });
    await expect(saveDriveTree(family([]))).rejects.toThrow(/connection changed/i);
    expect(remote.calls).toHaveLength(0);
  });
  it('does not resend a save request across a token-renewal account change', async () => {
    const remote = fakeDrive();
    remote.hooks.before = async () => new Response('', { status: 401 });
    vi.mocked(driveAccessToken)
      .mockResolvedValueOnce('token')
      .mockImplementationOnce(async () => {
        ++session.generation;
        return 'other-account';
      });
    await expect(saveDriveTree(family([]))).rejects.toThrow(/connection changed/i);
    expect(remote.calls).toHaveLength(1);
    expect(driveAccessToken).toHaveBeenLastCalledWith(true);
  });
  it('does not retry a lost create response in a new account', async () => {
    const remote = fakeDrive();
    remote.hooks.after = async () => {
      ++session.generation;
      vi.mocked(driveAccessToken).mockResolvedValue('other-account');
      throw Error('Lost response');
    };
    await expect(saveDriveTree(family([]))).rejects.toThrow(/connection changed/i);
    expect(remote.calls.filter((call) => call.options.method === 'POST')).toHaveLength(1);
    expect(
      remote.calls.every(
        (call) => (call.options.headers as Record<string, string>).Authorization === 'Bearer token',
      ),
    ).toBe(true);
  });
  it('does not clean up portraits in a newly connected account after an overwrite commits', async () => {
    const remote = fakeDrive();
    const file = await saveDriveTree(family([1]));
    remote.calls.length = 0;
    remote.hooks.after = async (call) => {
      if (call.options.method === 'PATCH' && call.meta?.mimeType === 'application/json') {
        ++session.generation;
        vi.mocked(driveAccessToken).mockResolvedValue('other-account');
      }
    };
    await expect(saveDriveTree(family([]), file.id)).rejects.toThrow(/connection changed/i);
    expect(remote.trashCalls()).toHaveLength(0);
    expect(
      remote.calls.every(
        (call) => (call.options.headers as Record<string, string>).Authorization === 'Bearer token',
      ),
    ).toBe(true);
  });
  it.each([[1, 2], [1, 1], [], [null]])(
    'round trips processed portraits %j, without recompression',
    async (...values) => {
      const remote = fakeDrive(),
        tree = family(values as (number | null)[]),
        progress: PhotoProgress[] = [];
      const original = structuredClone(tree);
      tree.updatedAt = 100;
      tree.dataUpdatedAt = 80;
      original.updatedAt = 100;
      original.dataUpdatedAt = 80;
      const file = await saveDriveTree(tree, undefined, (p) => progress.push(p));
      const doc = remote.document(file.id);
      expect(doc).toMatchObject({ format: 'genealogical3-drive', version: 1, backupId: file.id });
      expect(doc.tree.people.every((person) => person.portrait === null)).toBe(true);
      expect(doc.tree).toMatchObject({ updatedAt: 100, dataUpdatedAt: 80 });
      const folder = remote.files.get(doc.photoFolderId)!;
      expect(folder.name).toBe(`${file.id}.photos`);
      expect(file.name).toBe(`${file.id}.json`);
      expect(folder.parents).toEqual(remote.files.get(file.id)!.parents);
      const unique = new Set(values.filter((value) => value !== null));
      expect(remote.photoUploads()).toHaveLength(unique.size);
      for (const ref of doc.portraits) {
        const image = remote.files.get(ref.imageFileId)!;
        expect(ref.digest).toBe(await photoDigest(image.content as Uint8Array<ArrayBuffer>));
        expect(image.content).toEqual(
          jpeg(
            values[Number(tree.people.findIndex((person) => person.id === ref.personId))] as number,
          ),
        );
        expect(image.appProperties.backupId).toBe(file.id);
      }
      const result = await openDriveTree(file.id, (p) => progress.push(p));
      expect(result).toEqual({ tree, restoreWarnings: [] });
      expect(tree).toEqual(original);
      expect(progress).toContainEqual({
        direction: 'upload',
        completed: unique.size,
        total: unique.size,
      });
      expect(progress).toContainEqual({
        direction: 'download',
        completed: unique.size,
        total: unique.size,
      });
      // Saving only decodes bytes. The decoder is used exclusively during restore.
      expect(createImageBitmap).toHaveBeenCalledTimes(unique.size);
    },
  );

  it('uploads no photos for ordinary edits and only one replacement, with safe cleanup', async () => {
    const remote = fakeDrive(),
      tree = family();
    const file = await saveDriveTree(tree),
      first = remote.document(file.id);
    const edited = {
      ...tree,
      name: 'Edited',
      people: tree.people.map((p) => ({ ...p, notes: 'A note' })),
    };
    await saveDriveTree(edited, file.id);
    expect(remote.photoUploads()).toHaveLength(2);
    const second = remote.document(file.id);
    expect(second.portraits).toEqual(first.portraits);
    edited.people[0].portrait = portrait(3);
    const saved = await saveDriveTree(edited, file.id);
    expect(saved.cleanupWarnings).toEqual([]);
    expect(remote.photoUploads()).toHaveLength(3);
    const third = remote.document(file.id);
    expect(third.portraits[0].imageFileId).not.toBe(first.portraits[0].imageFileId);
    expect(third.portraits[1]).toEqual(first.portraits[1]);
    expect(remote.files.get(first.portraits[0].imageFileId)!.trashed).toBe(true);
    expect(remote.files.get(first.portraits[1].imageFileId)!.trashed).toBeUndefined();
    expect(createImageBitmap).not.toHaveBeenCalled();
    const copy = await saveDriveTree(edited),
      copied = remote.document(copy.id);
    expect(copied.photoFolderId).not.toBe(third.photoFolderId);
    expect(
      copied.portraits.every(
        (ref) => !third.portraits.some((old) => old.imageFileId === ref.imageFileId),
      ),
    ).toBe(true);
  });

  it('retains a shared image until its last reference is removed', async () => {
    const remote = fakeDrive(),
      tree = family([1, 1]);
    const file = await saveDriveTree(tree),
      imageId = remote.document(file.id).portraits[0].imageFileId;
    tree.people[0].portrait = null;
    await saveDriveTree(tree, file.id);
    expect(remote.trashCalls()).toHaveLength(0);
    tree.people[1].portrait = null;
    await saveDriveTree(tree, file.id);
    expect(remote.files.get(imageId)!.trashed).toBe(true);
  });

  it('leaves the previous document usable if a photo upload or document commit is interrupted', async () => {
    const remote = fakeDrive(),
      tree = family();
    const file = await saveDriveTree(tree),
      previous = remote.document(file.id);
    const changed = { ...tree, people: tree.people.map((p) => ({ ...p, portrait: portrait(3) })) };
    remote.hooks.before = async (call) => {
      if (call.meta?.mimeType === 'image/jpeg') return new Response('', { status: 503 });
    };
    await expect(saveDriveTree(changed, file.id)).rejects.toThrow(/503/);
    expect(remote.document(file.id)).toEqual(previous);
    expect(remote.trashCalls()).toHaveLength(0);
    remote.hooks.before = async (call) => {
      if (call.options.method === 'PATCH' && call.meta?.mimeType === 'application/json')
        throw Error('connection lost');
    };
    await expect(saveDriveTree(changed, file.id)).rejects.toThrow(/reach Google Drive/);
    expect(remote.document(file.id)).toEqual(previous);
    expect((await openDriveTree(file.id)).tree).toEqual(tree);
    // A later operation reuses the app-owned photo left by the interrupted commit.
    remote.hooks.before = undefined;
    const uploads = remote.photoUploads().length;
    await saveDriveTree(changed, file.id);
    expect(remote.photoUploads()).toHaveLength(uploads);
  });

  it.each(['photos', 'portrait', 'tree', 'library'])(
    'retries a lost %s create response with the same pre-generated ID',
    async (kind) => {
      const remote = fakeDrive();
      let lost = false;
      remote.hooks.after = async (call) => {
        if (!lost && call.options.method === 'POST' && call.meta?.appProperties?.kind === kind) {
          lost = true;
          if (kind === 'library') remote.files.get(call.meta.id!)!.parents = ['actual-root-id'];
          throw Error('lost response');
        }
      };
      const file = await saveDriveTree(family([1]));
      expect(lost).toBe(true);
      expect((await openDriveTree(file.id)).restoreWarnings).toEqual([]);
      const creates = remote.calls.filter(
        (call) => call.options.method === 'POST' && call.meta?.appProperties?.kind === kind,
      );
      expect(creates).toHaveLength(2);
      expect(creates[0].meta?.id).toBe(creates[1].meta?.id);
      expect([...remote.files.values()].filter((f) => f.appProperties.kind === kind)).toHaveLength(
        1,
      );
    },
  );

  it('reports cleanup failure independently from a committed save', async () => {
    const remote = fakeDrive(),
      tree = family([1]);
    const file = await saveDriveTree(tree);
    tree.people[0].portrait = null;
    remote.hooks.before = async (call) => {
      if (call.meta?.trashed) return new Response('', { status: 403 });
    };
    const result = await saveDriveTree(tree, file.id);
    expect(result.id).toBe(file.id);
    expect(result.cleanupWarnings).toHaveLength(1);
    expect(remote.document(file.id).portraits).toEqual([]);
    expect((await openDriveTree(file.id)).tree.people[0].portrait).toBeNull();
  });

  it('skips cleanup when the committed document is changed by another save', async () => {
    const remote = fakeDrive(),
      tree = family([1]);
    const file = await saveDriveTree(tree);
    remote.hooks.after = async (call) => {
      if (call.options.method === 'PATCH' && call.meta?.mimeType === 'application/json') {
        const doc = remote.document(file.id);
        doc.revision = 'other-save';
        remote.setDocument(file.id, doc);
      }
    };
    tree.people[0].portrait = null;
    const result = await saveDriveTree(tree, file.id);
    expect(result.cleanupWarnings[0]).toMatch(/another save/);
    expect(remote.trashCalls()).toHaveLength(0);
  });

  it('never cleans another backup or an unowned image even if the previous document references it', async () => {
    const remote = fakeDrive(),
      tree = family([1]);
    const first = await saveDriveTree(tree),
      second = await saveDriveTree(tree);
    const doc = remote.document(first.id),
      other = remote.document(second.id).portraits[0];
    doc.portraits[0].imageFileId = other.imageFileId;
    remote.setDocument(first.id, doc);
    const ownPhoto = [...remote.files.values()].find(
      (f) => f.mimeType === 'image/jpeg' && f.appProperties.backupId === first.id,
    )!;
    ownPhoto.appProperties.app = 'another-app';
    // A cross-backup image in the folder is also excluded by ownership checks.
    remote.files.get(other.imageFileId)!.parents.push(doc.photoFolderId);
    tree.people[0].portrait = null;
    await saveDriveTree(tree, first.id);
    expect(remote.trashCalls()).toHaveLength(0);
    expect(remote.files.get(other.imageFileId)!.trashed).toBeUndefined();
    expect(ownPhoto.trashed).toBeUndefined();
  });

  it('rechecks image ownership before trashing and rejects a foreign photo folder', async () => {
    const remote = fakeDrive(),
      tree = family([1]);
    const file = await saveDriveTree(tree),
      doc = remote.document(file.id);
    remote.hooks.after = async (call) => {
      if (call.options.method === 'PATCH' && call.meta?.mimeType === 'application/json')
        remote.files.get(doc.portraits[0].imageFileId)!.appProperties.backupId = 'another-backup';
    };
    tree.people[0].portrait = null;
    await saveDriveTree(tree, file.id);
    expect(remote.trashCalls()).toHaveLength(0);
    remote.files.get(doc.photoFolderId)!.appProperties.backupId = 'another-backup';
    await expect(saveDriveTree(tree, file.id)).rejects.toThrow(/does not belong/);
  });

  it.each([404, 403, 'digest', 'mime', 'decode', 'dimensions'])(
    'restores an incomplete copy for individual photo failure %s',
    async (failure) => {
      const remote = fakeDrive(),
        tree = family([1, 1, 2]);
      const file = await saveDriveTree(tree),
        doc = remote.document(file.id),
        image = remote.files.get(doc.portraits[0].imageFileId)!;
      if (typeof failure === 'number')
        remote.hooks.before = async (call) => {
          if (call.url.pathname.endsWith(image.id) && call.url.searchParams.get('alt') === 'media')
            return new Response('', { status: failure });
        };
      else if (failure === 'digest') image.content = jpeg(9);
      else if (failure === 'mime') image.mimeType = 'image/png';
      else if (failure === 'decode')
        vi.mocked(createImageBitmap).mockImplementation(async (source) => {
          if (new Uint8Array(await (source as Blob).arrayBuffer())[2] === 1)
            throw Error('bad JPEG');
          return { width: 128, height: 256, close: vi.fn() } as unknown as ImageBitmap;
        });
      else
        vi.mocked(createImageBitmap).mockResolvedValueOnce({
          width: 513,
          height: 200,
          close: vi.fn(),
        } as unknown as ImageBitmap);
      const result = await openDriveTree(file.id);
      expect(result.restoreWarnings.map((w) => w.personId)).toEqual(
        tree.people.slice(0, 2).map((p) => p.id),
      );
      expect(result.tree.people.map((p) => p.portrait)).toEqual([null, null, portrait(2)]);
    },
  );

  it.each([401, 500, 'network', 'body'])(
    'stops restore for authentication/network failure %s',
    async (failure) => {
      const remote = fakeDrive(),
        tree = family([1]);
      const file = await saveDriveTree(tree),
        imageId = remote.document(file.id).portraits[0].imageFileId;
      remote.hooks.before = async (call) => {
        if (!call.url.pathname.endsWith(imageId) || call.url.searchParams.get('alt') !== 'media')
          return;
        if (failure === 'network') throw Error('offline');
        if (failure === 'body') {
          const response = new Response('');
          vi.spyOn(response, 'arrayBuffer').mockRejectedValue(Error('stream failed'));
          return response;
        }
        return new Response('', { status: failure as number });
      };
      await expect(openDriveTree(file.id)).rejects.toThrow();
    },
  );

  it('renews authentication once during a photo download', async () => {
    const remote = fakeDrive();
    const file = await saveDriveTree(family([1]));
    let rejected = false;
    remote.hooks.before = async (call) => {
      if (
        !rejected &&
        call.url.searchParams.get('alt') === 'media' &&
        call.url.pathname.endsWith(remote.document(file.id).portraits[0].imageFileId)
      ) {
        rejected = true;
        return new Response('', { status: 401 });
      }
    };
    expect((await openDriveTree(file.id)).restoreWarnings).toEqual([]);
    expect(driveAccessToken).toHaveBeenCalledWith(true);
    vi.mocked(driveAccessToken).mockRejectedValueOnce(Error('renewal failed'));
    await expect(openDriveTree(file.id)).rejects.toThrow(/renewal failed/);
  });

  it.each(['version', 'backupId', 'photoFolderId', 'personId', 'duplicate', 'digest', 'embedded'])(
    'rejects invalid document %s before photo requests',
    async (field) => {
      const remote = fakeDrive();
      const file = await saveDriveTree(family([1])),
        doc = remote.document(file.id);
      if (field === 'version') doc.version = 9 as 1;
      if (field === 'backupId') doc.backupId = 'other-backup';
      if (field === 'photoFolderId') doc.photoFolderId = '../foreign';
      if (field === 'personId') doc.portraits[0].personId = 'unknown';
      if (field === 'duplicate') doc.portraits.push(doc.portraits[0]);
      if (field === 'digest') doc.portraits[0].digest = 'bad';
      if (field === 'embedded') doc.tree.people[0].portrait = portrait();
      remote.setDocument(file.id, doc);
      const start = remote.calls.length;
      await expect(openDriveTree(file.id)).rejects.toThrow(/Invalid/);
      expect(remote.calls.slice(start)).toHaveLength(1);
    },
  );

  it('rejects invalid local data before any Drive requests and explains portable import', async () => {
    const remote = fakeDrive();
    await expect(saveDriveTree({ ...family(), homePersonId: 'missing' })).rejects.toThrow(
      /home person/,
    );
    const tree = family();
    tree.people[0].died = { precision: 'year', year: 1800 };
    tree.people[0].born = { precision: 'year', year: 1900 };
    await expect(saveDriveTree(tree)).rejects.toThrow(/before birth/);
    tree.people[0].born = { precision: 'unknown' };
    tree.people[0].portrait = 'data:image/png;base64,AAAA';
    await expect(saveDriveTree(tree)).rejects.toThrow(/processed JPEG/);
    expect(remote.calls).toHaveLength(0);
    const file = await saveDriveTree(family([]));
    expect(() => validateTree(remote.document(file.id))).toThrow(/Google Drive cards in Workspace/);
  });

  it('limits transfers to three and serializes saves while capturing each snapshot', async () => {
    const remote = fakeDrive(),
      gate = deferred(),
      reached = deferred();
    let active = 0,
      maximum = 0;
    remote.hooks.before = async (call) => {
      if (call.options.method === 'POST' && call.meta?.mimeType === 'image/jpeg') {
        maximum = Math.max(maximum, ++active);
        if (active === 3) reached.resolve();
        await gate.promise;
        --active;
      }
    };
    const tree = family([1, 2, 3, 4, 5]);
    const first = saveDriveTree(tree);
    await reached.promise;
    const second = saveDriveTree(tree);
    tree.name = 'Edited during transfer';
    tree.people[0].portrait = null;
    const generatedBeforeRelease = remote.calls.filter((c) =>
      c.url.pathname.endsWith('/generateIds'),
    ).length;
    gate.resolve();
    const [a, b] = await Promise.all([first, second]);
    expect(generatedBeforeRelease).toBe(6);
    expect(maximum).toBe(3);
    expect(remote.document(a.id).tree.name).toBe('Family');
    expect(remote.document(b.id).tree.name).toBe('Family');
    expect(remote.document(b.id).portraits).toHaveLength(5);
    const firstCommit = remote.calls.findIndex(
      (c) => c.meta?.id === a.id && c.meta?.mimeType === 'application/json',
    );
    const secondCreate = remote.calls.findIndex((c) => c.meta?.appProperties?.backupId === b.id);
    expect(secondCreate).toBeGreaterThan(firstCommit);
  });
});

describe('Drive picker', () => {
  it('lists only tree documents in genealogical3 with explicit app/type tags', async () => {
    const remote = fakeDrive();
    const file = await saveDriveTree(family());
    expect((await listDriveTrees()).map((f) => f.id)).toEqual([file.id]);
    const query = remote.calls.at(-1)!.url.searchParams.get('q')!;
    expect(query).toContain("mimeType = 'application/json'");
    expect(query).toContain("key='kind' and value='tree'");
    expect(query).toContain("key='app' and value='GENEalogical3'");
  });
  it('does not create a folder for an empty picker', async () => {
    const remote = fakeDrive();
    expect(await listDriveTrees()).toEqual([]);
    expect(remote.calls).toHaveLength(1);
    expect(remote.files.size).toBe(0);
  });
  it('paginates folder lookup and tree inventory, and propagates later page failures', async () => {
    const remote = fakeDrive();
    const file = await saveDriveTree(family([]));
    let folderPages = 0,
      treePages = 0;
    remote.hooks.before = async (call) => {
      if (call.url.pathname !== '/drive/v3/files') return;
      if (call.url.searchParams.get('orderBy') === 'createdTime' && folderPages++ === 0)
        return new Response(JSON.stringify({ files: [], nextPageToken: 'folder-next' }));
      if (call.url.searchParams.get('orderBy') === 'modifiedTime desc') {
        if (treePages++ === 0)
          return new Response(
            JSON.stringify({ files: [remote.files.get(file.id)], nextPageToken: 'page 2 +/&?' }),
          );
        expect(call.url.searchParams.get('pageToken')).toBe('page 2 +/&?');
        return new Response(JSON.stringify({ files: [] }));
      }
    };
    expect(await listDriveTrees()).toHaveLength(1);
    expect(folderPages).toBe(2);
    expect(treePages).toBe(2);
    treePages = 0;
    remote.hooks.before = async (call) => {
      if (call.url.searchParams.get('orderBy') === 'modifiedTime desc')
        return treePages++ === 0
          ? new Response(JSON.stringify({ nextPageToken: 'next' }))
          : new Response('', { status: 403 });
    };
    await expect(listDriveTrees()).rejects.toThrow(/403/);
  });
  it('preserves legacy portable reads without migrating a legacy backup on save', async () => {
    const tree = makeTree();
    const remote = fakeDrive();
    remote.files.set('legacy', {
      id: 'legacy',
      name: 'Legacy',
      modifiedTime: '',
      mimeType: 'application/json',
      parents: [],
      appProperties: { app: 'GENEalogical3', format: 'tree-v1' },
      content: new TextEncoder().encode(JSON.stringify(tree)),
    });
    expect((await openDriveTree('legacy')).tree).toEqual(tree);
    await expect(saveDriveTree(tree, 'legacy')).rejects.toThrow(/Save a copy/);
  });
});
