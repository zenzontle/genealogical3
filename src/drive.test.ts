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

function installGoogle(response: { access_token?: string; expires_in?: number; error?: string }) {
  const requestAccessToken = vi.fn();
  vi.stubGlobal('window', {
    google: {
      accounts: {
        oauth2: {
          initTokenClient: ({
            callback,
            scope,
          }: {
            scope: string;
            callback: (result: {
              access_token?: string;
              expires_in?: number;
              error?: string;
            }) => void;
          }) => {
            expect(scope).toBe('https://www.googleapis.com/auth/drive.file');
            requestAccessToken.mockImplementation(() => callback(response));
            return { requestAccessToken };
          },
        },
      },
    },
  });
  return requestAccessToken;
}

describe('explicit Drive operations', () => {
  it('rejects an invalid home reference before upload and normalizes legacy Drive files', async () => {
    installGoogle({ access_token: 'token', expires_in: 3600 });
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
    const consent = installGoogle({ access_token: 'token', expires_in: 3600 });
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
    installGoogle({ access_token: 'token', expires_in: 3600 });
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
    installGoogle({ access_token: 'token', expires_in: 3600 });
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
    installGoogle({ access_token: 'token', expires_in: 3600 });
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
    installGoogle({ access_token: 'token', expires_in: 3600 });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ files: [] })));
    vi.stubGlobal('fetch', fetchMock);
    const drive = await import('./drive');
    await drive.authorizeDrive();
    expect(await drive.listDriveTrees()).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].method).toBeUndefined();
  });
  it('reports folder lookup failure without falling back to searching all of Drive', async () => {
    installGoogle({ access_token: 'token', expires_in: 3600 });
    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 403 }));
    vi.stubGlobal('fetch', fetchMock);
    const drive = await import('./drive');
    await drive.authorizeDrive();
    await expect(drive.listDriveTrees()).rejects.toThrow(/Google Drive request failed \(403\)/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('continues an empty folder search page before deciding to create a folder', async () => {
    installGoogle({ access_token: 'token', expires_in: 3600 });
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
      installGoogle({ access_token: 'token', expires_in: 3600 });
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
      installGoogle({ access_token: 'token', expires_in: 3600 });
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
    installGoogle({ error: 'access_denied' });
    const drive = await import('./drive');
    await expect(drive.authorizeDrive()).rejects.toThrow(/canceled or denied/);
    drive.disconnectDrive();
    vi.resetModules();
    installGoogle({ access_token: 'token', expires_in: 3600 });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(Error('offline')));
    const onlineDrive = await import('./drive');
    await onlineDrive.authorizeDrive();
    await expect(onlineDrive.saveDriveTree(makeTree())).rejects.toThrow(/local tree is unchanged/);
  });
});
