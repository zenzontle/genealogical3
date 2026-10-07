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
          }: {
            callback: (result: {
              access_token?: string;
              expires_in?: number;
              error?: string;
            }) => void;
          }) => {
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
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe('POST');
    expect(String((fetchMock.mock.calls[0][1] as RequestInit).body)).toContain('GENEalogical3');
    expect(String((fetchMock.mock.calls[0][1] as RequestInit).body)).toContain(
      `"homePersonId":"${person.id}"`,
    );
    expect(await drive.listDriveTrees()).toHaveLength(1);
    expect(await drive.openDriveTree('file-1')).toEqual(tree);
    await drive.saveDriveTree(tree, 'file-1');
    expect((fetchMock.mock.calls[3][1] as RequestInit).method).toBe('PATCH');
  });
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
