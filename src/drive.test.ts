import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makePerson, makeTree } from './model';

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function installAuthorization(response: {
  access_token?: string;
  expires_in?: number;
  error?: string;
}) {
  const authorizeDrive = vi.fn(async () => {
    if (response.error || !response.access_token)
      throw Error('Google Drive authorization was canceled or denied.');
  });
  vi.doMock('./driveAuth', () => ({
    driveConfigured: true,
    authorizeDrive,
    restoreDrive: vi.fn(),
    disconnectDrive: vi.fn(),
    driveAccessToken: vi.fn(async () => response.access_token || ''),
  }));
  return authorizeDrive;
}
describe('explicit Drive operations', () => {
  it('renews access and retries a rejected Drive request once', async () => {
    installAuthorization({ access_token: 'token' });
    const { driveAccessToken } = await import('./driveAuth');
    vi.mocked(driveAccessToken)
      .mockResolvedValueOnce('old-token')
      .mockResolvedValueOnce('renewed-token');
    const tree = makeTree('Family');
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(tree)));
    vi.stubGlobal('fetch', fetchMock);
    const drive = await import('./drive');
    expect(await drive.openDriveTree('file')).toEqual(tree);
    expect(driveAccessToken).toHaveBeenLastCalledWith(true);
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer old-token');
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer renewed-token');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('stops after a second Drive 401 and preserves renewal errors', async () => {
    installAuthorization({ access_token: 'token' });
    const fetchMock = vi.fn().mockImplementation(async () => new Response('', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    const drive = await import('./drive');
    await expect(drive.openDriveTree('file')).rejects.toThrow(/access expired/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const { driveAccessToken } = await import('./driveAuth');
    vi.mocked(driveAccessToken)
      .mockResolvedValueOnce('token')
      .mockRejectedValueOnce(Error('Google Drive authentication is not configured.'));
    await expect(drive.openDriveTree('file')).rejects.toThrow(/not configured/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it('rejects an invalid home reference before upload and normalizes legacy Drive files', async () => {
    installAuthorization({ access_token: 'token', expires_in: 3600 });
    const { homePersonId: _home, ...legacy } = makeTree('Legacy');
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ...legacy, version: 1 }), {
        status: 200,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const drive = await import('./drive');
    await expect(drive.saveDriveTree({ ...makeTree(), homePersonId: 'missing' })).rejects.toThrow(
      /home person/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
    await drive.authorizeDrive();
    expect(await drive.openDriveTree('legacy-file')).toEqual({
      ...legacy,
      version: 2,
      homePersonId: null,
    });
  });
  it('rejects invalid life dates before a Drive upload', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const drive = await import('./drive');
    const person = {
      ...makePerson(),
      born: { precision: 'year' as const, year: 1987 },
      died: { precision: 'year' as const, year: 1980 },
    };
    await expect(drive.saveDriveTree({ ...makeTree(), people: [person] })).rejects.toThrow(
      /before birth/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('requests drive.file and creates, lists, opens, and replaces a tree', async () => {
    const consent = installAuthorization({ access_token: 'token', expires_in: 3600 });
    const person = makePerson('Home');
    const tree = {
      ...makeTree('Test family'),
      people: [person],
      homePersonId: person.id,
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ files: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'folder-1' }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'file-1',
            name: 'Test family.genealogical3.json',
            modifiedTime: '2026-01-01T00:00:00Z',
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ files: [{ id: 'folder-1' }] })))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            files: [
              {
                id: 'file-1',
                name: 'Test family.genealogical3.json',
                modifiedTime: '2026-01-01T00:00:00Z',
              },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify(tree), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'file-1',
            name: 'Test family.genealogical3.json',
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);
    const drive = await import('./drive');
    await drive.authorizeDrive();
    expect(consent).toHaveBeenCalled();
    expect(await drive.saveDriveTree(tree)).toMatchObject({ id: 'file-1' });
    const folderQuery = new URL(String(fetchMock.mock.calls[0][0])).searchParams;
    expect(folderQuery.get('q')).toContain("name = 'genealogical3'");
    expect(folderQuery.get('q')).toContain("mimeType = 'application/vnd.google-apps.folder'");
    expect(folderQuery.get('q')).toContain("'root' in parents");
    expect(folderQuery.get('q')).toContain('trashed = false');
    expect(folderQuery.get('orderBy')).toBe('createdTime');
    expect(folderQuery.get('pageSize')).toBe('1');
    expect((fetchMock.mock.calls[1][1] as RequestInit).method).toBe('POST');
    expect(JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body))).toMatchObject({
      name: 'genealogical3',
      mimeType: 'application/vnd.google-apps.folder',
      parents: ['root'],
    });
    expect((fetchMock.mock.calls[2][1] as RequestInit).method).toBe('POST');
    expect(String((fetchMock.mock.calls[2][1] as RequestInit).body)).toContain('GENEalogical3');
    expect(String((fetchMock.mock.calls[2][1] as RequestInit).body)).toContain(
      '"parents":["folder-1"]',
    );
    expect(String((fetchMock.mock.calls[2][1] as RequestInit).body)).toContain(
      `"homePersonId":"${person.id}"`,
    );
    expect(await drive.listDriveTrees()).toHaveLength(1);
    expect(await drive.openDriveTree('file-1')).toEqual(tree);
    await drive.saveDriveTree(tree, 'file-1');
    expect((fetchMock.mock.calls[6][1] as RequestInit).method).toBe('PATCH');
    expect(String((fetchMock.mock.calls[6][1] as RequestInit).body)).not.toContain('"parents"');
    expect(fetchMock).toHaveBeenCalledTimes(7);
  });
  it('looks up the folder again for each new tree or copy and reuses the oldest match', async () => {
    installAuthorization({ access_token: 'token', expires_in: 3600 });
    const fetchMock = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
      if (new URL(url).pathname === '/drive/v3/files') {
        expect(options?.method).toBeUndefined();
        expect(new URL(url).searchParams.get('orderBy')).toBe('createdTime');
        return Promise.resolve(new Response(JSON.stringify({ files: [{ id: 'oldest-folder' }] })));
      }
      expect(options?.method).toBe('POST');
      expect(String(options?.body)).toContain('"parents":["oldest-folder"]');
      return Promise.resolve(
        new Response(JSON.stringify({ id: `file-${fetchMock.mock.calls.length}` })),
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    const drive = await import('./drive');
    await drive.authorizeDrive();
    const tree = makeTree('Original');
    const first = await drive.saveDriveTree(tree);
    const copy = await drive.saveDriveTree(tree);
    expect(first.id).not.toBe(copy.id);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
  it('updates an existing file directly without changing its location', async () => {
    installAuthorization({ access_token: 'token', expires_in: 3600 });
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ id: 'legacy-file' })));
    vi.stubGlobal('fetch', fetchMock);
    const drive = await import('./drive');
    await drive.authorizeDrive();
    await drive.saveDriveTree(makeTree(), 'legacy-file');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new URL(url).pathname).toBe('/upload/drive/v3/files/legacy-file');
    expect(options.method).toBe('PATCH');
    expect(String(options.body)).not.toContain('"parents"');
    expect(new URL(url).searchParams.has('addParents')).toBe(false);
    expect(new URL(url).searchParams.has('removeParents')).toBe(false);
  });
  it('lists only app trees directly in the upload folder while excluding folders', async () => {
    installAuthorization({ access_token: 'token', expires_in: 3600 });
    const files = [
      {
        id: 'folder-tree',
        name: 'Family.genealogical3.json',
        modifiedTime: '2026-01-01T00:00:00Z',
      },
      { id: 'new-file', name: 'New.genealogical3.json', modifiedTime: '2026-10-11T00:00:00Z' },
    ];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ files: [{ id: 'oldest-folder' }] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ files })));
    vi.stubGlobal('fetch', fetchMock);
    const drive = await import('./drive');
    await drive.authorizeDrive();
    expect(await drive.listDriveTrees()).toEqual(files);
    const folderQuery = new URL(String(fetchMock.mock.calls[0][0])).searchParams;
    expect(folderQuery.get('q')).toContain("name = 'genealogical3'");
    expect(folderQuery.get('q')).toContain("'root' in parents");
    expect(folderQuery.get('orderBy')).toBe('createdTime');
    const query = new URL(String(fetchMock.mock.calls[1][0])).searchParams.get('q');
    expect(query).toContain("mimeType != 'application/vnd.google-apps.folder'");
    expect(query).toContain("appProperties has { key='app' and value='GENEalogical3' }");
    expect(query).toContain("'oldest-folder' in parents");
    expect(query).toContain('trashed = false');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.every(([, options]) => !options?.method)).toBe(true);
  });
  it('returns an empty tree list without creating a missing folder', async () => {
    installAuthorization({ access_token: 'token', expires_in: 3600 });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ files: [] })));
    vi.stubGlobal('fetch', fetchMock);
    const drive = await import('./drive');
    await drive.authorizeDrive();
    expect(await drive.listDriveTrees()).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].method).toBeUndefined();
  });
  it.each([100, 2, 0, undefined])(
    'fetches every tree page when the first page contains %s files',
    async (firstPageSize) => {
      installAuthorization({ access_token: 'token', expires_in: 3600 });
      const firstPage = Array.from({ length: firstPageSize ?? 0 }, (_, index) => ({
        id: `file-${index}`,
        name: `Family ${index}.genealogical3.json`,
        modifiedTime: '2026-10-11T00:00:00Z',
      }));
      const older = {
        id: 'older',
        name: 'Older.genealogical3.json',
        modifiedTime: '2026-10-10T00:00:00Z',
      };
      const oldest = {
        id: 'oldest',
        name: 'Oldest.genealogical3.json',
        modifiedTime: '2026-10-09T00:00:00Z',
      };
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ files: [{ id: 'folder-1' }] })))
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              ...(firstPageSize === undefined ? {} : { files: firstPage }),
              nextPageToken: 'page 2 +/&?',
            }),
          ),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ files: [older], nextPageToken: 'page-3' })),
        )
        .mockResolvedValueOnce(new Response(JSON.stringify({ files: [oldest] })));
      vi.stubGlobal('fetch', fetchMock);
      const drive = await import('./drive');
      await drive.authorizeDrive();
      expect(await drive.listDriveTrees()).toEqual([...firstPage, older, oldest]);
      expect(fetchMock).toHaveBeenCalledTimes(4);
      const queries = fetchMock.mock.calls
        .slice(1)
        .map(([url]) => new URL(String(url)).searchParams);
      expect(queries.map((query) => query.get('pageToken'))).toEqual([
        null,
        'page 2 +/&?',
        'page-3',
      ]);
      for (const query of queries) {
        expect(query.get('q')).toBe(queries[0].get('q'));
        expect(query.get('q')).toContain("'folder-1' in parents");
        expect(query.get('pageSize')).toBe('100');
        expect(query.get('orderBy')).toBe('modifiedTime desc');
        expect(query.get('fields')).toBe('nextPageToken,files(id,name,modifiedTime)');
      }
    },
  );
  it('reports a later tree page failure instead of returning an incomplete list', async () => {
    installAuthorization({ access_token: 'token', expires_in: 3600 });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ files: [{ id: 'folder-1' }] })))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            files: [
              {
                id: 'file-1',
                name: 'Family.genealogical3.json',
                modifiedTime: '2026-10-11T00:00:00Z',
              },
            ],
            nextPageToken: 'page-2',
          }),
        ),
      )
      .mockResolvedValueOnce(new Response('', { status: 403 }));
    vi.stubGlobal('fetch', fetchMock);
    const drive = await import('./drive');
    await drive.authorizeDrive();
    await expect(drive.listDriveTrees()).rejects.toThrow(/Google Drive request failed \(403\)/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it('reports folder lookup failure without falling back to searching all of Drive', async () => {
    installAuthorization({ access_token: 'token', expires_in: 3600 });
    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 403 }));
    vi.stubGlobal('fetch', fetchMock);
    const drive = await import('./drive');
    await drive.authorizeDrive();
    await expect(drive.listDriveTrees()).rejects.toThrow(/Google Drive request failed \(403\)/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('continues an empty folder search page before deciding to create a folder', async () => {
    installAuthorization({ access_token: 'token', expires_in: 3600 });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ files: [], nextPageToken: 'next page' })),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ files: [{ id: 'folder-1' }] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'file-1' })));
    vi.stubGlobal('fetch', fetchMock);
    const drive = await import('./drive');
    await drive.authorizeDrive();
    await drive.saveDriveTree(makeTree());
    expect(new URL(String(fetchMock.mock.calls[1][0])).searchParams.get('pageToken')).toBe(
      'next page',
    );
    expect(String((fetchMock.mock.calls[2][1] as RequestInit).body)).toContain(
      '"parents":["folder-1"]',
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it.each(['lookup', 'creation'] as const)(
    'stops the upload when folder %s fails',
    async (stage) => {
      installAuthorization({ access_token: 'token', expires_in: 3600 });
      const fetchMock = vi.fn();
      if (stage === 'creation') {
        fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ files: [] })));
      }
      fetchMock.mockResolvedValueOnce(new Response('', { status: 403 }));
      vi.stubGlobal('fetch', fetchMock);
      const drive = await import('./drive');
      await drive.authorizeDrive();
      const tree = makeTree();
      const original = structuredClone(tree);
      await expect(drive.saveDriveTree(tree)).rejects.toThrow(
        /Google Drive request failed \(403\).*local tree is unchanged/,
      );
      expect(tree).toEqual(original);
      expect(fetchMock).toHaveBeenCalledTimes(stage === 'creation' ? 2 : 1);
      expect(fetchMock.mock.calls.every(([url]) => !String(url).includes('/upload/'))).toBe(true);
    },
  );
  it.each([undefined, '', 42])(
    'stops the upload when folder creation returns an invalid ID (%s)',
    async (id) => {
      installAuthorization({ access_token: 'token', expires_in: 3600 });
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ files: [] })))
        .mockResolvedValueOnce(new Response(JSON.stringify({ id })));
      vi.stubGlobal('fetch', fetchMock);
      const drive = await import('./drive');
      await drive.authorizeDrive();
      await expect(drive.saveDriveTree(makeTree())).rejects.toThrow(
        /folder identifier.*local tree is unchanged/,
      );
      expect(fetchMock).toHaveBeenCalledTimes(2);
    },
  );
  it('keeps local work independent of denied consent and network failures', async () => {
    installAuthorization({ error: 'access_denied' });
    const drive = await import('./drive');
    await expect(drive.authorizeDrive()).rejects.toThrow(/canceled or denied/);
    drive.disconnectDrive();
    vi.resetModules();
    installAuthorization({ access_token: 'token', expires_in: 3600 });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(Error('offline')));
    const onlineDrive = await import('./drive');
    await onlineDrive.authorizeDrive();
    await expect(onlineDrive.saveDriveTree(makeTree())).rejects.toThrow(/local tree is unchanged/);
  });
});
