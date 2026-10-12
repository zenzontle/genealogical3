// @vitest-environment jsdom
import { useEffect, useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { makePerson, makeTree, type Tree } from './model';
import { deleteTree, getTree, listTrees, saveTree, getDriveLink, saveDriveLink } from './storage';
import { exportPng, portraitData } from './media';
import type { PersonNode } from './PersonCard';
import { mockDialogs } from './dialogTestSetup';
import {
  authorizeDrive,
  disconnectDrive,
  restoreDrive,
  saveDriveTree,
  openDriveTree,
  listDriveTrees,
  type DriveSaveResult,
} from './drive';

const driveState = vi.hoisted(() => ({ configured: false }));

vi.mock('./storage', () => ({
  listTrees: vi.fn(),
  getTree: vi.fn(),
  saveTree: vi.fn(),
  deleteTree: vi.fn(),
  getDriveLink: vi.fn(),
  deleteDriveLink: vi.fn(),
  saveDriveLink: vi.fn(),
  duplicateSavedTree: vi.fn(),
}));
vi.mock('./drive', () => ({
  get driveConfigured() {
    return driveState.configured;
  },
  authorizeDrive: vi.fn(),
  disconnectDrive: vi.fn(),
  restoreDrive: vi.fn(),
  listDriveTrees: vi.fn(),
  openDriveTree: vi.fn(),
  saveDriveTree: vi.fn(),
}));
vi.mock('./media', () => ({ exportJson: vi.fn(), exportPng: vi.fn(), portraitData: vi.fn() }));
vi.mock('./useConnectorProximity', () => ({ useConnectorProximity: vi.fn() }));
vi.mock('@xyflow/react', async (original) => ({
  ...(await original<typeof import('@xyflow/react')>()),
  ConnectionMode: { Loose: 'loose' },
  Background: () => null,
  Controls: () => null,
  ReactFlow: ({ nodes, onInit }: { nodes: PersonNode[]; onInit: (instance: unknown) => void }) => {
    useEffect(() => {
      onInit({
        getViewport: () => ({ x: 0, y: 0, zoom: 1 }),
        setCenter: vi.fn(),
        fitView: vi.fn(),
      });
    }, [onInit]);
    return (
      <div>
        {nodes.map((node) => (
          <button key={node.id} onClick={() => node.data.onSelect(node.id)}>
            Select {node.data.person.name}
          </button>
        ))}
      </div>
    );
  },
  useNodesState: (initial: PersonNode[]) => {
    const [nodes, setNodes] = useState(initial);
    return [nodes, setNodes, vi.fn()];
  },
}));

let original: Tree;
let records: Map<string, Tree>;
beforeEach(() => {
  vi.clearAllMocks();
  driveState.configured = false;
  vi.mocked(restoreDrive).mockResolvedValue(undefined);
  vi.mocked(authorizeDrive).mockResolvedValue(undefined);
  vi.mocked(disconnectDrive).mockResolvedValue(undefined);
  vi.mocked(getDriveLink).mockReset().mockResolvedValue(undefined);
  vi.mocked(saveDriveLink).mockReset().mockResolvedValue('link');
  mockDialogs();
  const alex = makePerson('Alex'),
    taylor = makePerson('Taylor');
  original = {
    ...makeTree('Family'),
    people: [alex, taylor],
    homePersonId: alex.id,
    relations: [
      {
        id: 'partner',
        type: 'partner',
        personA: alex.id,
        personB: taylor.id,
        status: 'current',
        union: 'married',
      },
    ],
  };
  records = new Map([[original.id, original]]);
  vi.mocked(listTrees).mockImplementation(async () => [...records.values()]);
  vi.mocked(getTree).mockImplementation(async (id) => records.get(id));
  vi.mocked(saveTree).mockImplementation(async (tree) => {
    records.set(tree.id, tree);
    return tree.id;
  });
  vi.mocked(deleteTree).mockImplementation(async (id) => {
    records.delete(id);
    return undefined;
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const openOriginal = async () => {
  fireEvent.click(await screen.findByRole('button', { name: 'Open Family' }));
  await screen.findByRole('button', { name: 'Select Alex' });
};

describe('local feedback integration', () => {
  it('restores Drive before enabling saves and continues a pending save after authorization', async () => {
    driveState.configured = true;
    let restore!: () => void;
    vi.mocked(restoreDrive).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          restore = resolve;
        }),
    );
    render(<App />);
    await openOriginal();
    const save = screen.getByRole('button', { name: 'Save to Drive' });
    expect(save).toHaveProperty('disabled', true);
    await act(async () => restore());
    let authorize!: () => void;
    vi.mocked(authorizeDrive).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          authorize = resolve;
        }),
    );
    vi.mocked(saveDriveTree).mockResolvedValueOnce({
      id: 'file',
      name: 'Family.json',
      modifiedTime: '2026-10-11',
      cleanupWarnings: [],
    });
    fireEvent.click(save);
    expect(saveDriveTree).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Select Alex' })).toBeTruthy();
    await act(async () => authorize());
    await screen.findByText('Saved to Google Drive as Family.json.');
    expect(saveDriveTree).toHaveBeenCalledWith(original, undefined, expect.any(Function));
  });

  it('reports disconnect only after server success and keeps failures retryable', async () => {
    driveState.configured = true;
    render(<App />);
    await openOriginal();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save to Drive' })).toHaveProperty(
        'disabled',
        false,
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Drive' }));
    vi.mocked(disconnectDrive).mockRejectedValueOnce(Error('Disconnect failed. Please retry.'));
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect Drive' }));
    await screen.findByText('Disconnect failed. Please retry.');
    expect(screen.queryByText(/Forgot Google Drive access/)).toBeNull();
    let confirm!: () => void;
    vi.mocked(disconnectDrive).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          confirm = resolve;
        }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect Drive' }));
    expect(screen.queryByText(/Forgot Google Drive access/)).toBeNull();
    await act(async () => confirm());
    await screen.findByText(
      'Forgot Google Drive access in this browser. Your local tree is still saved.',
    );
    expect(screen.getByRole('button', { name: 'Select Alex' })).toBeTruthy();
  });
  it('cancels tree deletion without changes and retains the tile after a failed delete', async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Family' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(deleteTree).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Delete Family' }));
    vi.mocked(deleteTree).mockRejectedValueOnce(Error('Deletion failed.'));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await screen.findByText('Deletion failed.');
    expect(records.has(original.id)).toBe(true);
    expect(screen.getByRole('button', { name: 'Open Family' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(records.has(original.id)).toBe(false);
  });
  it('stays in the library after import and opens the imported tree only when requested', async () => {
    render(<App />);
    await screen.findByRole('button', { name: 'Open Family' });
    const text = JSON.stringify(makeTree('Imported example'));
    const file = Object.assign(new File([text], 'tree.json', { type: 'application/json' }), {
      text: async () => text,
    });
    fireEvent.change(screen.getByLabelText('Import JSON file'), { target: { files: [file] } });
    await screen.findByText('Imported Imported example (imported).');
    expect(screen.getByRole('heading', { name: 'Your family trees' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open tree' }));
    await screen.findByRole('button', { name: 'Export JSON' });
    expect(screen.queryByRole('heading', { name: 'Your family trees' })).toBeNull();
  });

  it('keeps rename failure retryable and gives a successful editor rename one undo step', async () => {
    render(<App />);
    await openOriginal();
    fireEvent.click(screen.getByTitle('Rename tree'));
    fireEvent.change(screen.getByLabelText('Tree name'), {
      target: { value: '  Renamed family  ' },
    });
    vi.mocked(saveTree).mockRejectedValueOnce(Error('Storage unavailable.'));
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }));
    await screen.findByText('Storage unavailable.');
    expect(screen.getByLabelText('Tree name')).toHaveProperty('value', '  Renamed family  ');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByTitle('Rename tree').textContent).toContain('Renamed family');
    expect(records.get(original.id)?.name).toBe('Renamed family');
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.getByTitle('Rename tree').textContent).toContain('Family');
    expect(screen.getByRole('button', { name: 'Undo' })).toHaveProperty('disabled', true);
  });

  it.each([false, true])(
    'preserves a portrait that finishes during rename persistence (autosave queued: %s)',
    async (autosaveQueued) => {
      render(<App />);
      await openOriginal();
      fireEvent.click(screen.getByRole('button', { name: 'Select Alex' }));
      let finishPortrait!: (portrait: string) => void;
      vi.mocked(portraitData).mockImplementationOnce(
        () =>
          new Promise<string>((resolve) => {
            finishPortrait = resolve;
          }),
      );
      fireEvent.change(screen.getByLabelText('Choose portrait'), {
        target: { files: [new File(['photo'], 'photo.png', { type: 'image/png' })] },
      });
      await waitFor(() => expect(portraitData).toHaveBeenCalledOnce());

      let finishRename!: () => void;
      vi.mocked(saveTree).mockImplementationOnce(
        (tree) =>
          new Promise<string>((resolve) => {
            finishRename = () => {
              records.set(tree.id, tree);
              resolve(tree.id);
            };
          }),
      );
      fireEvent.click(screen.getByTitle('Rename tree'));
      fireEvent.change(screen.getByLabelText('Tree name'), { target: { value: 'Renamed family' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save name' }));
      await waitFor(() => expect(saveTree).toHaveBeenCalledOnce());

      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const portrait = 'data:image/jpeg;base64,new-photo';
      await act(async () => finishPortrait(portrait));
      if (autosaveQueued) await act(() => vi.advanceTimersByTimeAsync(450));
      await act(async () => finishRename());

      expect(screen.queryByRole('dialog')).toBeNull();
      expect(screen.getByTitle('Rename tree').textContent).toContain('Renamed family');
      expect(screen.getByAltText('Portrait')).toHaveProperty('src', portrait);
      expect(screen.getByText('Saving locally…')).toBeTruthy();
      await act(() => vi.advanceTimersByTimeAsync(450));
      expect(records.get(original.id)?.name).toBe('Renamed family');
      expect(records.get(original.id)?.people[0].portrait).toBe(portrait);
      expect(screen.getByText('Saved locally')).toBeTruthy();

      fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
      expect(screen.getByTitle('Rename tree').textContent).toContain('Family');
      expect(screen.getByAltText('Portrait')).toHaveProperty('src', portrait);
      fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
      expect(screen.queryByAltText('Portrait')).toBeNull();
      expect(screen.getByRole('button', { name: 'Undo' })).toHaveProperty('disabled', true);
    },
  );

  it('deletes a home person and relationships, then restores both with Undo', async () => {
    render(<App />);
    await openOriginal();
    fireEvent.click(screen.getByRole('button', { name: 'Select Alex' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete person' }));
    expect(screen.getByRole('dialog').textContent).toContain('clears the home person designation');
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.queryByRole('button', { name: 'Select Alex' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Center on home person' })).toHaveProperty(
      'disabled',
      true,
    );
    expect(screen.getByText('1 people · 0 connections')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await screen.findByRole('button', { name: 'Select Alex' });
    expect(screen.getByRole('button', { name: 'Center on home person' })).toHaveProperty(
      'disabled',
      false,
    );
    expect(screen.getByText('2 people · 1 connections')).toBeTruthy();
  });

  it('finishes pending writes before returning to the library and deleting the last tree', async () => {
    render(<App />);
    await openOriginal();
    fireEvent.click(screen.getByRole('button', { name: 'Select Alex' }));
    let resolve!: () => void;
    vi.mocked(saveTree).mockImplementationOnce(
      (tree) =>
        new Promise<string>((done) => {
          resolve = () => {
            records.set(tree.id, tree);
            done(tree.id);
          };
        }),
    );
    fireEvent.change(screen.getByLabelText('Nickname'), { target: { value: 'A' } });
    await waitFor(() => expect(saveTree).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'Back to trees' }));
    // Going home queues a second save behind the first write.
    await waitFor(() => expect(screen.getByText('Saving locally…')).toBeTruthy());
    await act(async () => resolve());
    await screen.findByRole('button', { name: 'Delete Family' });
    fireEvent.click(screen.getByRole('button', { name: 'Delete Family' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(records.has(original.id)).toBe(false);
    expect(screen.queryByRole('button', { name: 'Open Family' })).toBeNull();
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Start a family tree' }),
    );
  });

  it('preserves edits made while a portrait processes and shows export retry controls', async () => {
    render(<App />);
    await openOriginal();
    fireEvent.click(screen.getByRole('button', { name: 'Select Alex' }));
    let resolve!: (portrait: string) => void;
    vi.mocked(portraitData).mockImplementation(
      () =>
        new Promise<string>((done) => {
          resolve = done;
        }),
    );
    fireEvent.change(screen.getByLabelText('Choose portrait'), {
      target: { files: [new File(['photo'], 'photo.png', { type: 'image/png' })] },
    });
    await waitFor(() => expect(portraitData).toHaveBeenCalledOnce());
    fireEvent.change(screen.getByLabelText('Nickname'), { target: { value: 'Updated nickname' } });
    await act(async () => resolve('data:image/jpeg;base64,photo'));
    expect(screen.getByLabelText('Nickname')).toHaveProperty('value', 'Updated nickname');
    vi.mocked(exportPng)
      .mockRejectedValueOnce(Error('Could not render the PNG.'))
      .mockResolvedValue(undefined);
    fireEvent.click(screen.getByRole('button', { name: 'Export PNG' }));
    expect(screen.getByRole('button', { name: 'Export JSON' })).toHaveProperty('disabled', true);
    await screen.findByText('Could not render the PNG.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByText('PNG download started.');
    expect(vi.mocked(exportPng).mock.calls[1][0].people[0].nickname).toBe('Updated nickname');
    expect(vi.mocked(exportPng).mock.calls[1][0].people[0].portrait).toBe(
      'data:image/jpeg;base64,photo',
    );
  });
});

// Drive integration exercises snapshot ownership and the persistent incomplete-copy guard.
describe('Drive portrait feedback and associations', () => {
  it('associates a pending save with its captured tree after switching during authorization and transfer', async () => {
    driveState.configured = true;
    const other = { ...makeTree('Other family'), people: [makePerson('Morgan')] };
    records.set(other.id, other);
    let authorize!: () => void;
    let finish!: (result: DriveSaveResult) => void;
    vi.mocked(authorizeDrive).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          authorize = resolve;
        }),
    );
    vi.mocked(saveDriveTree).mockImplementationOnce((_tree, _id, progress) => {
      progress?.({ direction: 'upload', completed: 1, total: 2 });
      return new Promise<DriveSaveResult>((resolve) => {
        finish = resolve;
      });
    });
    vi.mocked(getDriveLink).mockImplementation(async (id) => ({
      treeId: id,
      id: id === original.id ? 'original-drive' : 'other-drive',
      name: `${id}.json`,
      modifiedTime: '',
    }));
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<App />);
    await openOriginal();
    fireEvent.click(screen.getByRole('button', { name: 'Save to Drive' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back to trees' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Open Other family' }));
    await screen.findByRole('button', { name: 'Select Morgan' });
    await act(async () => authorize());
    await screen.findByText('Uploading photos: 1 of 2');
    expect(saveDriveTree).toHaveBeenCalledWith(original, 'original-drive', expect.any(Function));
    // Edits to the active tree do not change the already captured snapshot.
    await act(async () =>
      finish({
        id: 'original-drive',
        name: 'Original.json',
        modifiedTime: '',
        cleanupWarnings: ['Photo cleanup could not be completed.'],
      }),
    );
    await screen.findByText(/Saved to Google Drive as Original.json.*Photo cleanup/);
    expect(saveDriveLink).toHaveBeenCalledWith(
      expect.objectContaining({ treeId: original.id, id: 'original-drive' }),
    );
    expect(screen.getByText('Drive not saved')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Select Morgan' })).toBeTruthy();
  });

  it('persists incomplete restore warnings through reload, blocks overwrite, and confirms an independent copy', async () => {
    driveState.configured = true;
    const file = { id: 'source-drive', name: 'Family.json', modifiedTime: '' };
    const warnings = [{ personId: original.people[0].id, name: 'Alex' }];
    const links = new Map<string, Awaited<ReturnType<typeof getDriveLink>>>();
    vi.mocked(getDriveLink).mockImplementation(async (id) => links.get(id));
    vi.mocked(saveDriveLink).mockImplementation(async (link) => {
      links.set(link.treeId, link);
      return link.treeId;
    });
    vi.mocked(listDriveTrees).mockResolvedValueOnce([file]);
    vi.mocked(openDriveTree).mockResolvedValueOnce({ tree: original, restoreWarnings: warnings });
    render(<App />);
    await openOriginal();
    fireEvent.click(screen.getByRole('button', { name: 'Open from Google Drive' }));
    fireEvent.click(await screen.findByRole('button', { name: /Family.json/ }));
    await screen.findByText(/Incomplete Drive copy: portraits could not be restored for Alex/);
    const copyId = [...links.keys()][0];
    expect(copyId).not.toBe(original.id);
    expect(links.get(copyId)?.restoreWarnings).toEqual(warnings);
    cleanup();
    render(<App />);
    const opens = await screen.findAllByRole('button', { name: 'Open Family' });
    fireEvent.click(opens[0]);
    await screen.findByText(/Incomplete Drive copy: portraits could not be restored for Alex/);
    const before = vi.mocked(saveDriveTree).mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Save to Drive' }));
    await screen.findByText(/This local copy has missing portraits/);
    expect(saveDriveTree).toHaveBeenCalledTimes(before);
    const confirm = vi
      .spyOn(window, 'confirm')
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    fireEvent.click(screen.getByRole('button', { name: 'Save a copy to Google Drive' }));
    expect(confirm).toHaveBeenCalledWith(
      expect.stringContaining('Missing portraits will be omitted'),
    );
    expect(saveDriveTree).toHaveBeenCalledTimes(before);
    vi.mocked(saveDriveTree).mockResolvedValueOnce({
      ...file,
      id: 'independent-drive',
      cleanupWarnings: [],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save a copy to Google Drive' }));
    await screen.findByText('Saved to Google Drive as Family.json.');
    expect(vi.mocked(saveDriveTree).mock.calls.at(-1)?.[1]).toBeUndefined();
    expect(links.get(copyId)?.id).toBe('independent-drive');
    expect(links.get(copyId)?.restoreWarnings).toEqual([]);
    expect(screen.queryByText(/Incomplete Drive copy:/)).toBeNull();
  });

  it('does not persist an unprotected local copy when its incomplete association cannot be stored', async () => {
    driveState.configured = true;
    const file = { id: 'source-drive', name: 'Family.json', modifiedTime: '' };
    vi.mocked(listDriveTrees).mockResolvedValueOnce([file]);
    vi.mocked(openDriveTree).mockResolvedValueOnce({
      tree: original,
      restoreWarnings: [{ personId: original.people[0].id, name: 'Alex' }],
    });
    vi.mocked(saveDriveLink).mockRejectedValueOnce(Error('Storage unavailable'));
    render(<App />);
    await openOriginal();
    fireEvent.click(screen.getByRole('button', { name: 'Open from Google Drive' }));
    fireEvent.click(await screen.findByRole('button', { name: /Family.json/ }));
    await screen.findByText('Storage unavailable');
    expect(records.size).toBe(1);
    expect(saveTree).not.toHaveBeenCalled();
  });
});
