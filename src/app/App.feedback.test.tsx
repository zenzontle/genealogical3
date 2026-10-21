// @vitest-environment jsdom
import { Fragment, useEffect, type ReactNode } from 'react';
import type { NodeChange } from '@xyflow/react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { driveSync } from '../lib/driveSync';
import { makePerson, makeTree, validateTree, type Tree } from '../lib/model';
import {
  removeWorkspaceStorage,
  duplicateSavedTree,
  getTree,
  listTrees,
  listDriveLinks,
  saveTree,
  storedTreeData,
  TreeChangedError,
  getDriveLink,
  saveDriveLink,
  type DriveLink,
} from '../lib/storage';
import { exportJson, exportPng, portraitData } from '../lib/media';
import type { PersonNode } from '../components/PersonCard';
import { partnerNodeId } from '../lib/partnerConnectors';
import { afterPaint } from '../lib/feedback';
import { mockDialogs } from '../test/dialogTestSetup';
import {
  authorizeDrive,
  disconnectDrive,
  restoreDrive,
  saveDriveTree,
  openDriveTree,
  listDriveTrees,
  deleteDriveBackup,
  type DriveSaveResult,
} from '../lib/drive';

const driveState = vi.hoisted(() => ({
  configured: false,
  connection: 'restoring',
  generation: 0,
  listeners: new Set<() => void>(),
}));
function setDriveConnection(connection: string) {
  driveState.connection = connection;
  driveState.listeners.forEach((listener) => listener());
}
type CanvasEvents = {
  onNodesChange: (changes: NodeChange<PersonNode>[]) => void;
  onConnect: (connection: {
    source: string;
    target: string;
    sourceHandle: string;
    targetHandle: string;
  }) => void;
  onMoveEnd: (_: unknown, viewport: Tree['viewport']) => void;
  onNodeDragStart: () => void;
  onNodeDragStop: (_: unknown, node: PersonNode, nodes: PersonNode[]) => void;
  onSelectionDragStart: () => void;
  onSelectionDragStop: (_: unknown, nodes: PersonNode[]) => void;
};
let canvasEvents: CanvasEvents;

const syncState = vi.hoisted(() => ({ views: {} }));
vi.mock('../lib/driveSync', () => ({
  driveSync: {
    subscribe: () => () => {},
    snapshot: () => syncState.views,
    start: () => () => {},
    noteEdit: vi.fn(),
    discardEdits: vi.fn(async () => {}),
    hasPending: () => false,
    flush: vi.fn(async () => {}),
    retry: vi.fn(async () => {}),
    setSyncEnabled: vi.fn(async () => {}),
    useDrive: vi.fn(),
    manualSave: vi.fn(async (id: string, progress: import('../lib/drive').ProgressCallback) => {
      const tree = await getTree(id);
      const link = await getDriveLink(id);
      const file = await saveDriveTree(tree!, link?.id, progress);
      try {
        await saveDriveLink({
          treeId: id,
          id: file.id,
          name: file.name,
          description: file.description,
          modifiedTime: file.modifiedTime,
          sync: {
            acknowledgedDataUpdatedAt: tree!.dataUpdatedAt,
            revision: file.revision,
            pending: false,
          },
        });
      } catch {
        throw Error(
          [
            `Saved to Google Drive as ${file.description || file.name}, but this browser could not remember the file link. Open its Google Drive card in Workspace next time.`,
            ...file.cleanupWarnings,
          ].join(' '),
        );
      }
      return file;
    }),
  },
}));
vi.mock('../lib/storage', async (original) => ({
  storedTreeData: (await original<typeof import('../lib/storage')>()).storedTreeData,
  TreeChangedError: (await original<typeof import('../lib/storage')>()).TreeChangedError,
  listTrees: vi.fn(),
  listDriveLinks: vi.fn(),
  getTree: vi.fn(),
  saveTree: vi.fn(),
  removeWorkspaceStorage: vi.fn(),
  getDriveLink: vi.fn(),
  deleteDriveLink: vi.fn(),
  saveDriveLink: vi.fn(),
  duplicateSavedTree: vi.fn(),
  updateLinkedTree: vi.fn(
    async (
      _id: string,
      update: Parameters<typeof import('../lib/storage').updateLinkedTree>[1],
    ) => {
      const next = update(undefined, undefined);
      if (next.link) await saveDriveLink(next.link);
      if (next.tree) await saveTree(next.tree);
    },
  ),
}));
vi.mock('../lib/drive', () => ({
  get driveConfigured() {
    return driveState.configured;
  },
  getDriveConnection: () => (driveState.configured ? driveState.connection : 'unconfigured'),
  getDriveGeneration: () => driveState.generation,
  subscribeDriveConnection: (listener: () => void) => {
    driveState.listeners.add(listener);
    return () => driveState.listeners.delete(listener);
  },
  authorizeDrive: vi.fn(),
  disconnectDrive: vi.fn(),
  restoreDrive: vi.fn(),
  listDriveTrees: vi.fn(),
  openDriveTree: vi.fn(),
  verifyDriveRestoreLocked: vi.fn(),
  saveDriveTree: vi.fn(),
  createDriveDeletion: (id: string) => ({
    id,
    generation: driveState.generation,
    deletedPortraitIds: [],
    documentDeleted: false,
    documentAttempted: false,
    folderAttempted: false,
    folderDeleted: false,
  }),
  deleteDriveBackup: vi.fn(),
  queueDriveOperation: async (_generation: number, run: () => Promise<unknown>) => run(),
}));
vi.mock('../lib/media', () => ({ exportJson: vi.fn(), exportPng: vi.fn(), portraitData: vi.fn() }));
vi.mock('../lib/feedback', async (original) => ({
  ...(await original<typeof import('../lib/feedback')>()),
  afterPaint: vi.fn(() => Promise.resolve()),
}));
vi.mock('../hooks/useConnectorProximity', () => ({ useConnectorProximity: vi.fn() }));
vi.mock('@xyflow/react', async (original) => ({
  ...(await original<typeof import('@xyflow/react')>()),
  ConnectionMode: { Loose: 'loose' },
  Background: () => null,
  Controls: () => null,
  ViewportPortal: Fragment,
  ReactFlow: ({
    nodes,
    onInit,
    children,
    ...events
  }: CanvasEvents & {
    nodes: PersonNode[];
    onInit: (instance: unknown) => void;
    children: ReactNode;
  }) => {
    canvasEvents = events;
    const onMoveEnd = events.onMoveEnd;
    useEffect(() => {
      onInit({
        getViewport: () => ({ x: 0, y: 0, zoom: 1 }),
        getZoom: () => 1,
        getNode: (id: string) => nodes.find((node) => node.id === id),
        setCenter: vi.fn(() => onMoveEnd(null, { x: 200, y: 300, zoom: 1.1 })),
        fitView: vi.fn(() => onMoveEnd(null, { x: 100, y: 100, zoom: 0.8 })),
      });
    }, [onInit, nodes, onMoveEnd]);
    return (
      <div className="react-flow__pane" data-testid="canvas-pane">
        {nodes
          .filter((node) => node.type === 'person')
          .map((node) => (
            <button
              key={node.id}
              data-x={node.position.x}
              data-y={node.position.y}
              onClick={() => node.data.onSelect(node.id)}
            >
              Select {node.data.person.name}
            </button>
          ))}
        {children}
      </div>
    );
  },
}));

const defaultManualSave = vi.mocked(driveSync.manualSave).getMockImplementation()!;
let original: Tree;
let records: Map<string, Tree>;
let links: Map<string, DriveLink>;
beforeEach(() => {
  vi.clearAllMocks();
  syncState.views = {};
  vi.mocked(driveSync.manualSave).mockReset().mockImplementation(defaultManualSave);
  vi.mocked(afterPaint).mockReset().mockResolvedValue(undefined);
  driveState.configured = false;
  driveState.connection = 'restoring';
  driveState.generation = 0;
  driveState.listeners.clear();
  links = new Map();
  vi.mocked(listDriveLinks)
    .mockReset()
    .mockImplementation(async () => [...links.values()]);
  vi.mocked(listDriveTrees).mockReset().mockResolvedValue([]);
  vi.mocked(restoreDrive)
    .mockReset()
    .mockImplementation(async () => {
      setDriveConnection('connected');
    });
  vi.mocked(authorizeDrive)
    .mockReset()
    .mockImplementation(async () => {
      setDriveConnection('connected');
    });
  vi.mocked(disconnectDrive)
    .mockReset()
    .mockImplementation(async () => {
      ++driveState.generation;
      setDriveConnection('disconnected');
    });
  vi.mocked(getDriveLink)
    .mockReset()
    .mockImplementation(async (id) => links.get(id));
  vi.mocked(saveDriveLink)
    .mockReset()
    .mockImplementation(async (link) => {
      links.set(link.treeId, link);
      return 'link';
    });
  mockDialogs();
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false })),
  );
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
  vi.mocked(getTree)
    .mockReset()
    .mockImplementation(async (id) => records.get(id));
  vi.mocked(saveTree).mockImplementation(async (tree) => {
    records.set(tree.id, tree);
    return tree.id;
  });
  vi.mocked(removeWorkspaceStorage)
    .mockReset()
    .mockImplementation(async ({ treeId, backupId }) => {
      if (treeId) {
        records.delete(treeId);
        links.delete(treeId);
      }
      if (backupId) for (const [id, link] of links) if (link.id === backupId) links.delete(id);
    });
  vi.mocked(deleteDriveBackup)
    .mockReset()
    .mockImplementation(async (progress, afterDelete) => {
      progress.documentDeleted = true;
      await afterDelete?.();
    });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const openOriginal = async () => {
  fireEvent.click(await screen.findByRole('button', { name: 'Open Family' }));
  await screen.findByRole('button', { name: 'Select Alex' });
};
const editorSnapshot = async () => {
  const count = vi.mocked(exportJson).mock.calls.length;
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Export JSON' })));
  expect(exportJson).toHaveBeenCalledTimes(count + 1);
  expect(screen.getByRole('button', { name: 'Export JSON' })).toHaveProperty('disabled', false);
  return vi.mocked(exportJson).mock.calls.at(-1)![0];
};

describe('card alignment while dragging', () => {
  it('shows snapped positions and guides, saves the release, and supports undo/redo', async () => {
    original.people[0].x = 100;
    original.people[0].y = 50;
    original.people[1].x = 400;
    original.people[1].y = 300;
    render(<App />);
    await openOriginal();
    const id = original.people[1].id;
    act(() => canvasEvents.onNodeDragStart());
    act(() =>
      canvasEvents.onNodesChange([
        { id, type: 'position', position: { x: 106, y: 300 }, dragging: true },
      ]),
    );
    expect(screen.getByRole('button', { name: 'Select Taylor' }).getAttribute('data-x')).toBe(
      '100',
    );
    expect(document.querySelectorAll('.alignment-guides line')).toHaveLength(1);
    expect((await editorSnapshot()).people[1].x).toBe(400);
    const released = { id, position: { x: 106, y: 300 } } as PersonNode;
    act(() => {
      canvasEvents.onNodesChange([
        { id, type: 'position', position: released.position, dragging: false },
      ]);
      canvasEvents.onNodeDragStop(null, released, [released]);
    });
    expect(document.querySelector('.alignment-guides')).toBeNull();
    expect(screen.getByRole('button', { name: 'Select Taylor' }).getAttribute('data-x')).toBe(
      '100',
    );
    expect((await editorSnapshot()).people[1]).toMatchObject({ x: 100, y: 300 });
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect((await editorSnapshot()).people).toEqual(original.people);
    expect(screen.getByRole('button', { name: 'Undo' })).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('button', { name: 'Redo' }));
    expect((await editorSnapshot()).people[1]).toMatchObject({ x: 100, y: 300 });
    fireEvent.click(screen.getByRole('button', { name: 'Back to trees' }));
    await screen.findByRole('button', { name: 'Open Family' });
    expect(records.get(original.id)?.people[1]).toMatchObject({ x: 100, y: 300 });
  });

  it('releases snapping outside the threshold and clears its guides', async () => {
    original.people[0].x = 100;
    original.people[1].x = 400;
    original.people[1].y = 300;
    render(<App />);
    await openOriginal();
    const id = original.people[1].id;
    act(() => canvasEvents.onNodeDragStart());
    for (const [x, expected] of [
      [106, 100],
      [112, 112],
    ]) {
      act(() =>
        canvasEvents.onNodesChange([
          { id, type: 'position', position: { x, y: 300 }, dragging: true },
        ]),
      );
      expect(screen.getByRole('button', { name: 'Select Taylor' }).getAttribute('data-x')).toBe(
        String(expected),
      );
    }
    expect(document.querySelector('.alignment-guides')).toBeNull();
  });

  it('snaps a card to a partner heart and preserves the alignment through release and undo/redo', async () => {
    original.people[0].x = 100;
    original.people[0].y = 50;
    original.people[1].x = 500;
    original.people[1].y = 50;
    const child = makePerson('Child', 800, 400);
    original.people.push(child);
    render(<App />);
    await openOriginal();
    const released = { id: child.id, position: { x: 306, y: 400 } } as PersonNode;
    act(() => canvasEvents.onNodeDragStart());
    act(() =>
      canvasEvents.onNodesChange([
        { id: child.id, type: 'position', position: released.position, dragging: true },
      ]),
    );
    expect(screen.getByRole('button', { name: 'Select Child' }).getAttribute('data-x')).toBe('300');
    expect(document.querySelector('.alignment-guides line')?.getAttribute('x1')).toBe('390');
    act(() => {
      canvasEvents.onNodesChange([
        { id: child.id, type: 'position', position: released.position, dragging: false },
      ]);
      canvasEvents.onNodeDragStop(null, released, [released]);
    });
    expect(document.querySelector('.alignment-guides')).toBeNull();
    expect((await editorSnapshot()).people[2]).toMatchObject({ x: 300, y: 400 });
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect((await editorSnapshot()).people).toEqual(original.people);
    fireEvent.click(screen.getByRole('button', { name: 'Redo' }));
    expect((await editorSnapshot()).people[2]).toMatchObject({ x: 300, y: 400 });
  });

  it('snaps a moving couple by its heart and saves both positions as one edit', async () => {
    original.people[0].x = 0;
    original.people[0].y = 300;
    original.people[1].x = 400;
    original.people[1].y = 300;
    original.people.push(makePerson('Target', 300, 0));
    render(<App />);
    await openOriginal();
    const moved = original.people.slice(0, 2).map(
      (person) =>
        ({
          id: person.id,
          position: { x: person.x + 106, y: person.y },
        }) as PersonNode,
    );
    act(() => canvasEvents.onSelectionDragStart());
    act(() =>
      canvasEvents.onNodesChange(
        moved.map((node) => ({
          id: node.id,
          type: 'position',
          position: node.position,
          dragging: true,
        })),
      ),
    );
    expect(screen.getByRole('button', { name: 'Select Alex' }).getAttribute('data-x')).toBe('100');
    expect(screen.getByRole('button', { name: 'Select Taylor' }).getAttribute('data-x')).toBe(
      '500',
    );
    expect(document.querySelector('.alignment-guides line')?.getAttribute('x1')).toBe('390');
    act(() => canvasEvents.onSelectionDragStop(null, moved));
    expect((await editorSnapshot()).people.map(({ x, y }) => [x, y])).toEqual([
      [100, 300],
      [500, 300],
      [300, 0],
    ]);
    expect(document.querySelector('.alignment-guides')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect((await editorSnapshot()).people).toEqual(original.people);
    expect(screen.getByRole('button', { name: 'Undo' })).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('button', { name: 'Redo' }));
    expect((await editorSnapshot()).people.map(({ x }) => x)).toEqual([100, 500, 300]);
  });

  it('snaps a selected group by one offset without aligning its members to one another', async () => {
    original.people[0].x = 0;
    original.people[0].y = 300;
    original.people[1].x = 200;
    original.people[1].y = 500;
    original.people.push(makePerson('Target', 100, 0));
    render(<App />);
    await openOriginal();
    const moved = original.people.slice(0, 2).map(
      (person) =>
        ({
          id: person.id,
          position: { x: person.x + 106, y: person.y },
        }) as PersonNode,
    );
    act(() => canvasEvents.onSelectionDragStart());
    act(() =>
      canvasEvents.onNodesChange(
        moved.map((node) => ({
          id: node.id,
          type: 'position',
          position: node.position,
          dragging: true,
        })),
      ),
    );
    expect(screen.getByRole('button', { name: 'Select Alex' }).getAttribute('data-x')).toBe('100');
    expect(screen.getByRole('button', { name: 'Select Taylor' }).getAttribute('data-x')).toBe(
      '300',
    );
    act(() => canvasEvents.onSelectionDragStop(null, moved));
    const saved = await editorSnapshot();
    expect(saved.people.map(({ x, y }) => [x, y])).toEqual([
      [100, 300],
      [300, 500],
      [100, 0],
    ]);
    expect(document.querySelector('.alignment-guides')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect((await editorSnapshot()).people).toEqual(original.people);
  });
});

describe('canvas text selection', () => {
  const selectSidebarText = () => {
    const text = screen.getByText('Stories take shape together.');
    const range = document.createRange();
    range.selectNodeContents(text);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    expect(selection.toString()).toBe(text.textContent);
    return selection;
  };

  afterEach(() => window.getSelection()?.removeAllRanges());

  it('clears sidebar text and prevents default before the Shift-left press reaches the pane', async () => {
    render(<App />);
    await openOriginal();
    const selection = selectSidebarText();
    const pane = screen.getByTestId('canvas-pane');
    const onPointerDown = vi.fn((event: Event) => ({
      defaultPrevented: event.defaultPrevented,
      rangeCount: selection.rangeCount,
    }));
    pane.addEventListener('pointerdown', onPointerDown);

    const event = new MouseEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      shiftKey: true,
      button: 0,
    });
    expect(fireEvent(pane, event)).toBe(false);
    expect(onPointerDown).toHaveBeenCalledOnce();
    expect(onPointerDown).toHaveReturnedWith({ defaultPrevented: true, rangeCount: 0 });
  });

  it.each([
    { shiftKey: false, button: 0 },
    { shiftKey: true, button: 1 },
    { shiftKey: true, button: 2 },
  ])('preserves text selection for a pane press with %o', async (modifiers) => {
    render(<App />);
    await openOriginal();
    const selection = selectSidebarText();
    const text = selection.toString();
    const event = new MouseEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      ...modifiers,
    });
    expect(fireEvent(screen.getByTestId('canvas-pane'), event)).toBe(true);
    expect(selection.toString()).toBe(text);
  });

  it('leaves Shift-left presses on sidebar text, cards, controls, and forms alone', async () => {
    render(<App />);
    await openOriginal();
    const selection = selectSidebarText();
    const text = selection.toString();
    for (const target of [
      screen.getByText('Stories take shape together.'),
      screen.getByRole('button', { name: 'Select Alex' }),
      screen.getByRole('button', { name: 'Center on home person' }),
    ]) {
      expect(
        fireEvent(
          target,
          new MouseEvent('pointerdown', {
            bubbles: true,
            cancelable: true,
            shiftKey: true,
            button: 0,
          }),
        ),
      ).toBe(true);
      expect(selection.toString()).toBe(text);
    }

    fireEvent.click(screen.getByRole('button', { name: 'Select Alex' }));
    const input = screen.getByLabelText('Nickname');
    const removeAllRanges = vi.spyOn(selection, 'removeAllRanges');
    expect(
      fireEvent(
        input,
        new MouseEvent('pointerdown', {
          bubbles: true,
          cancelable: true,
          shiftKey: true,
          button: 0,
        }),
      ),
    ).toBe(true);
    expect(removeAllRanges).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: 'Still editable' } });
    expect(input).toHaveProperty('value', 'Still editable');
  });
});

describe('operation toast integration', () => {
  it.each(['JSON', 'PNG'] as const)(
    'withholds %s progress toasts and shows failure, retry and timed completion',
    async (format) => {
      render(<App />);
      await openOriginal();
      let finishPaint!: () => void;
      vi.mocked(afterPaint).mockReturnValueOnce(
        new Promise((resolve) => {
          finishPaint = resolve;
        }),
      );
      if (format === 'JSON') {
        vi.mocked(exportJson).mockImplementationOnce(() => {
          throw Error('Export failed.');
        });
      } else {
        vi.mocked(exportPng)
          .mockRejectedValueOnce(Error('Export failed.'))
          .mockResolvedValue(undefined);
      }
      fireEvent.click(screen.getByRole('button', { name: `Export ${format}` }));
      expect(screen.queryByText(`Preparing ${format}…`)).toBeNull();
      expect(screen.queryByText(`${format} export completed.`)).toBeNull();
      for (const name of ['Export JSON', 'Export PNG', 'Download a backup']) {
        expect(screen.getByRole('button', { name })).toHaveProperty('disabled', true);
      }
      await act(async () => finishPaint());
      const error = await screen.findByText('Export failed.');
      expect(error.closest('.toast-stack')).toBeTruthy();
      expect(error.closest('[role="alert"]')).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Select Alex' }));
      fireEvent.change(screen.getByLabelText('Nickname'), {
        target: { value: 'Edited after failure' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
      const success = await screen.findByText(`${format} export completed.`);
      expect(success.closest('.toast-stack')).toBeTruthy();
      expect(success.closest('[role="status"]')).toBeTruthy();
      const exporter = format === 'JSON' ? exportJson : exportPng;
      expect(vi.mocked(exporter).mock.calls.at(-1)![0].people[0].nickname).toBe(
        'Edited after failure',
      );
      vi.useFakeTimers();
      // The toast timer was created before fake timers; use a new export to exercise the full duration.
      await act(async () =>
        fireEvent.click(screen.getByRole('button', { name: `Export ${format}` })),
      );
      await act(() => vi.advanceTimersByTimeAsync(4999));
      expect(screen.getByText(`${format} export completed.`)).toBeTruthy();
      await act(() => vi.advanceTimersByTimeAsync(1));
      expect(screen.queryByText(`${format} export completed.`)).toBeNull();
    },
  );

  it.each([true, false])(
    'keeps import progress and recovery in the toast area (empty library: %s)',
    async (empty) => {
      if (empty) records.clear();
      render(<App />);
      await screen.findByRole(empty ? 'heading' : 'button', {
        name: empty ? /Every family/ : 'Open Family',
      });
      const text = JSON.stringify(makeTree('Imported example'));
      let finishRead!: (text: string) => void;
      let finishSave!: () => void;
      let finishRefresh!: (trees: Tree[]) => void;
      const file = Object.assign(new File([text], 'tree.json', { type: 'application/json' }), {
        text: vi
          .fn()
          .mockReturnValueOnce(
            new Promise<string>((resolve) => {
              finishRead = resolve;
            }),
          )
          .mockResolvedValue(text),
      });
      fireEvent.change(screen.getByLabelText('Import JSON file'), { target: { files: [file] } });
      const reading = await screen.findByText('Reading file…');
      expect(reading.closest('.toast-stack')).toBeTruthy();
      expect(reading.closest('.toast')?.querySelector('button')).toBeNull();
      expect(
        screen.getByRole('button', { name: empty ? 'Import a tree' : 'Import' }),
      ).toHaveProperty('disabled', true);
      vi.mocked(saveTree).mockRejectedValueOnce(Error('Browser storage full.'));
      await act(async () => finishRead(text));
      const error = await screen.findByText('Browser storage full.');
      expect(error.closest('.toast-stack')).toBeTruthy();
      const importedId = vi.mocked(saveTree).mock.calls.at(-1)![0].id;
      vi.mocked(saveTree).mockImplementationOnce(
        (tree) =>
          new Promise<string>((resolve) => {
            finishSave = () => {
              records.set(tree.id, tree);
              resolve(tree.id);
            };
          }),
      );
      vi.mocked(listTrees).mockReturnValueOnce(
        new Promise<Tree[]>((resolve) => {
          finishRefresh = resolve;
        }),
      );
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
      expect((await screen.findByText('Saving tree…')).closest('.toast-stack')).toBeTruthy();
      expect(vi.mocked(saveTree).mock.calls.at(-1)![0].id).toBe(importedId);
      expect(file.text).toHaveBeenCalledOnce();
      await act(async () => finishSave());
      expect((await screen.findByText('Refreshing library…')).closest('.toast-stack')).toBeTruthy();
      await act(async () => finishRefresh([...records.values()]));
      const success = await screen.findByText('Imported Imported example (imported).');
      expect(success.closest('.toast-stack')).toBeTruthy();
      vi.useFakeTimers();
      await act(() => vi.advanceTimersByTimeAsync(10000));
      expect(screen.getByRole('button', { name: 'Open tree' })).toBeTruthy();
      vi.useRealTimers();
      expect(screen.getByRole('heading', { name: 'Your family trees' })).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Open tree' }));
      await screen.findByRole('button', { name: 'Export JSON' });
      expect(screen.queryByText('Imported Imported example (imported).')).toBeNull();
      expect(screen.getByTitle('Rename tree').textContent).toContain('Imported example (imported)');
    },
  );

  it('stacks a general notice with import errors and keeps choosing another file available', async () => {
    vi.mocked(duplicateSavedTree).mockRejectedValueOnce(Error('Could not duplicate this tree.'));
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Duplicate Family' }));
    const notice = await screen.findByText('Could not duplicate this tree.');
    const file = Object.assign(new File(['{}'], 'invalid.json', { type: 'application/json' }), {
      text: async () => '{}',
    });
    const input = screen.getByLabelText('Import JSON file');
    fireEvent.change(input, { target: { files: [file] } });
    await screen.findByRole('button', { name: 'Choose another file' });
    const stack = notice.closest('.toast-stack')!;
    expect(stack.querySelectorAll('.toast')).toHaveLength(2);
    expect(stack.querySelectorAll('[role="alert"]')).toHaveLength(2);
    vi.useFakeTimers();
    await act(() => vi.advanceTimersByTimeAsync(10000));
    expect(stack.querySelectorAll('.toast')).toHaveLength(2);
    const chooseFile = vi.spyOn(input, 'click');
    fireEvent.click(screen.getByRole('button', { name: 'Choose another file' }));
    expect(chooseFile).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss feedback' }));
    expect(stack.querySelectorAll('.toast')).toHaveLength(1);
    expect(screen.getByText('Could not duplicate this tree.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss message' }));
    expect(stack.querySelectorAll('.toast')).toHaveLength(0);
  });
});

describe('cross-tab editor replacements', () => {
  const driveVersion = (timestamp = original.dataUpdatedAt + 1): Tree => {
    const person = makePerson('Remote person');
    return {
      ...original,
      name: 'Drive family',
      people: [person],
      relations: [],
      homePersonId: person.id,
      dataUpdatedAt: timestamp,
    };
  };
  it('clears a cross-tab unlink even if an older association refresh finishes later, allowing a new backup', async () => {
    driveState.configured = true;
    const oldLink = { treeId: original.id, id: 'deleted-backup', name: 'Family', modifiedTime: '' };
    links.set(original.id, oldLink);
    render(<App />);
    await openOriginal();
    let finishOlderRefresh!: (value: DriveLink[]) => void;
    const refreshes = vi.mocked(listDriveLinks).mock.calls.length;
    vi.mocked(listDriveLinks).mockReturnValueOnce(
      new Promise<DriveLink[]>((resolve) => {
        finishOlderRefresh = resolve;
      }),
    );
    act(() => window.dispatchEvent(new Event('tree-storage-changed')));
    await waitFor(() => expect(listDriveLinks).toHaveBeenCalledTimes(refreshes + 1));
    links.delete(original.id);
    await act(async () => window.dispatchEvent(new Event('tree-storage-refreshed')));
    await act(async () => finishOlderRefresh([oldLink]));
    const save = vi.mocked(driveSync.manualSave).getMockImplementation()!;
    vi.mocked(driveSync.manualSave).mockImplementationOnce(
      async (id, progress, reviewed, expectedBackupId) => {
        if (expectedBackupId && links.get(id)?.id !== expectedBackupId)
          throw Error('The Drive association changed.');
        return save(id, progress, reviewed, expectedBackupId);
      },
    );
    const file = {
      id: 'new-backup',
      name: 'New backup',
      modifiedTime: '',
      revision: 'new-revision',
      cleanupWarnings: [],
    };
    vi.mocked(saveDriveTree).mockResolvedValueOnce(file);
    fireEvent.click(screen.getByRole('button', { name: 'Save to Drive' }));
    await screen.findByText('Saved to Google Drive as New backup.');
    expect(driveSync.manualSave).toHaveBeenLastCalledWith(
      original.id,
      expect.any(Function),
      undefined,
      null,
    );
    expect(links.get(original.id)?.id).toBe(file.id);
    expect(screen.getByRole('button', { name: 'Select Alex' })).toBeTruthy();
  });
  it.each(['Workspace', 'another editor'] as const)(
    'renames an externally replaced inactive tree from %s using its freshly read version',
    async (location) => {
      const other = { ...original, id: 'other', name: 'Other family' };
      records.set(other.id, other);
      render(<App />);
      await openOriginal();
      fireEvent.click(screen.getByRole('button', { name: 'Back to trees' }));
      await screen.findByRole('heading', { name: 'Your family trees' });
      if (location === 'another editor') {
        fireEvent.click(screen.getByRole('button', { name: 'Open Other family' }));
        await screen.findByRole('button', { name: 'Select Alex' });
      }
      const replacement = driveVersion();
      records.set(original.id, replacement);
      await act(async () => window.dispatchEvent(new Event('tree-storage-refreshed')));
      if (location === 'another editor') {
        fireEvent.click(screen.getByRole('button', { name: 'Back to trees' }));
        await screen.findByRole('heading', { name: 'Your family trees' });
      }
      vi.mocked(saveTree).mockImplementation(async (value, expected) => {
        if (expected && storedTreeData(expected) !== storedTreeData(records.get(value.id)!))
          throw new TreeChangedError();
        records.set(value.id, value);
        return value.id;
      });
      fireEvent.click(await screen.findByRole('button', { name: 'Rename Drive family' }));
      fireEvent.change(screen.getByLabelText('Tree name'), {
        target: { value: 'Renamed Drive family' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Save name' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(records.get(original.id)?.name).toBe('Renamed Drive family');
      expect(records.get(original.id)?.people).toEqual(replacement.people);
      expect(saveTree).toHaveBeenLastCalledWith(
        expect.objectContaining({ id: original.id, name: 'Renamed Drive family' }),
        replacement,
      );
    },
  );
  it.each(['new timestamp', 'same timestamp'] as const)(
    'blocks persistence during a cross-tab replacement with %s and reopens the stored version',
    async (timestamp) => {
      render(<App />);
      await openOriginal();
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      act(() => canvasEvents.onMoveEnd(null, { x: 10, y: 20, zoom: 1.5 }));
      const replacement = driveVersion(
        timestamp === 'same timestamp' ? original.dataUpdatedAt : undefined,
      );
      records.set(original.id, replacement);
      let finishRead!: (tree: Tree) => void;
      vi.mocked(getTree).mockReturnValueOnce(
        new Promise<Tree>((resolve) => {
          finishRead = resolve;
        }),
      );
      act(() => window.dispatchEvent(new Event('tree-storage-refreshed')));
      act(() => window.dispatchEvent(new Event('pagehide')));
      await act(() => vi.advanceTimersByTimeAsync(450));
      expect(saveTree).not.toHaveBeenCalled();
      await act(async () => finishRead(replacement));
      expect(screen.getByRole('heading', { name: 'Your family trees' })).toBeTruthy();
      expect(records.get(original.id)).toEqual(replacement);
      expect(driveSync.discardEdits).toHaveBeenCalledWith(original.id);
      vi.useRealTimers();
      fireEvent.click(await screen.findByRole('button', { name: 'Open Drive family' }));
      await screen.findByRole('button', { name: 'Select Remote person' });
      expect(await editorSnapshot()).toEqual(replacement);
      expect(screen.getByRole('button', { name: 'Undo' })).toHaveProperty('disabled', true);
      act(() => canvasEvents.onMoveEnd(null, { x: 40, y: 50, zoom: 1.2 }));
      fireEvent.click(screen.getByRole('button', { name: 'Back to trees' }));
      await screen.findByRole('heading', { name: 'Your family trees' });
      expect(records.get(original.id)).toEqual({
        ...replacement,
        updatedAt: expect.any(Number),
        viewport: { x: 40, y: 50, zoom: 1.2 },
      });
    },
  );
  it('cancels an older data snapshot queued behind a completed local write', async () => {
    render(<App />);
    await openOriginal();
    fireEvent.click(screen.getByRole('button', { name: 'Select Alex' }));
    let finishSave!: () => void;
    vi.mocked(saveTree).mockImplementationOnce(async (value) => {
      records.set(value.id, value);
      await new Promise<void>((resolve) => {
        finishSave = resolve;
      });
      return value.id;
    });
    fireEvent.change(screen.getByLabelText('Nickname'), { target: { value: 'First edit' } });
    await waitFor(() => expect(saveTree).toHaveBeenCalledOnce());
    fireEvent.change(screen.getByLabelText('Nickname'), { target: { value: 'Queued edit' } });
    const replacement = driveVersion();
    records.set(original.id, replacement);
    await act(async () => window.dispatchEvent(new Event('tree-storage-refreshed')));
    await act(async () => finishSave());
    expect(saveTree).toHaveBeenCalledOnce();
    expect(records.get(original.id)).toEqual(replacement);
    expect(screen.getByRole('heading', { name: 'Your family trees' })).toBeTruthy();
  });
  it('preserves editor state and pending navigation for unrelated storage changes', async () => {
    render(<App />);
    await openOriginal();
    fireEvent.click(screen.getByRole('button', { name: 'Select Alex' }));
    fireEvent.change(screen.getByLabelText('Nickname'), { target: { value: 'Local edit' } });
    await waitFor(() => expect(records.get(original.id)?.people[0].nickname).toBe('Local edit'));
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    act(() => canvasEvents.onMoveEnd(null, { x: 12, y: 34, zoom: 1.1 }));
    await act(async () => window.dispatchEvent(new Event('tree-storage-refreshed')));
    expect(screen.queryByRole('heading', { name: 'Your family trees' })).toBeNull();
    expect(screen.getByLabelText('Nickname')).toHaveProperty('value', 'Local edit');
    expect(screen.getByRole('button', { name: 'Undo' })).toHaveProperty('disabled', false);
    await act(() => vi.advanceTimersByTimeAsync(450));
    expect(records.get(original.id)?.viewport).toEqual({ x: 12, y: 34, zoom: 1.1 });
    expect(records.get(original.id)?.people[0].nickname).toBe('Local edit');
    expect(driveSync.discardEdits).not.toHaveBeenCalled();
  });
  it('keeps the first save of a new draft independent of unrelated cross-tab changes', async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'New tree' }));
    await screen.findByRole('button', { name: 'Add person' });
    let finishSave!: () => void;
    vi.mocked(saveTree).mockImplementationOnce(async (value) => {
      await new Promise<void>((resolve) => {
        finishSave = resolve;
      });
      records.set(value.id, value);
      return value.id;
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add person' }));
    await waitFor(() => expect(saveTree).toHaveBeenCalledOnce());
    await act(async () => window.dispatchEvent(new Event('tree-storage-refreshed')));
    expect(screen.getByRole('button', { name: 'Add person' })).toBeTruthy();
    await act(async () => finishSave());
    expect(driveSync.discardEdits).not.toHaveBeenCalled();
    expect(
      [...records.values()].find((value) => value.name === 'My family tree')?.people,
    ).toHaveLength(1);
  });
  it('keeps navigation to Workspace safe while a cross-tab read is pending', async () => {
    const other = { ...original, id: 'other', name: 'Other family' };
    records.set(other.id, other);
    render(<App />);
    await openOriginal();
    const replacement = driveVersion();
    records.set(original.id, replacement);
    let finishRead!: (tree: Tree) => void;
    vi.mocked(getTree).mockReturnValueOnce(
      new Promise<Tree>((resolve) => {
        finishRead = resolve;
      }),
    );
    act(() => window.dispatchEvent(new Event('tree-storage-refreshed')));
    fireEvent.click(screen.getByRole('button', { name: 'Back to trees' }));
    await act(async () => finishRead(replacement));
    fireEvent.click(await screen.findByRole('button', { name: 'Open Other family' }));
    await screen.findByRole('button', { name: 'Select Alex' });
    expect((await editorSnapshot()).id).toBe(other.id);
    expect(records.get(original.id)).toEqual(replacement);
  });
  it('prevents stale persistence if reading the cross-tab update fails', async () => {
    render(<App />);
    await openOriginal();
    const replacement = driveVersion();
    records.set(original.id, replacement);
    vi.mocked(getTree).mockRejectedValueOnce(Error('Storage unavailable'));
    await act(async () => window.dispatchEvent(new Event('tree-storage-refreshed')));
    await act(async () => window.dispatchEvent(new Event('pagehide')));
    expect(saveTree).not.toHaveBeenCalled();
    expect(records.get(original.id)).toEqual(replacement);
    expect(screen.getByRole('heading', { name: 'Your family trees' })).toBeTruthy();
  });
});

describe('local feedback integration', () => {
  it('rejects exhausted edits and person creation while preserving navigation, history and valid backups', async () => {
    original.dataUpdatedAt = Number.MAX_SAFE_INTEGER;
    render(<App />);
    await openOriginal();
    fireEvent.click(screen.getByRole('button', { name: 'Select Alex' }));
    fireEvent.change(screen.getByLabelText('Nickname'), { target: { value: 'Rejected' } });
    expect(screen.getByRole('alert').textContent).toContain('timestamp has reached its limit');
    expect(await editorSnapshot()).toEqual(original);
    expect(screen.getByRole('button', { name: 'Undo' })).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('button', { name: 'Add person' }));
    expect(await editorSnapshot()).toEqual(original);
    act(() => canvasEvents.onSelectionDragStart());
    const moved = original.people.map(
      (person) => ({ id: person.id, position: { x: 100, y: 100 } }) as PersonNode,
    );
    act(() => canvasEvents.onSelectionDragStop(null, moved));
    expect(await editorSnapshot()).toEqual(original);
    expect(saveTree).not.toHaveBeenCalled();
    act(() => canvasEvents.onMoveEnd(null, { x: 100, y: 100, zoom: 0.5 }));
    const navigated = await editorSnapshot();
    expect(validateTree(JSON.parse(JSON.stringify(navigated)))).toEqual(navigated);
    expect(navigated.dataUpdatedAt).toBe(Number.MAX_SAFE_INTEGER);
    fireEvent.click(screen.getByRole('button', { name: 'Back to trees' }));
    await screen.findByRole('button', { name: 'Open Family' });
    expect(records.get(original.id)).toEqual(navigated);
  });

  it.each(['Undo', 'Redo'] as const)(
    'preserves the history stacks when exhausted %s is rejected',
    async (action) => {
      original.dataUpdatedAt = Number.MAX_SAFE_INTEGER - (action === 'Undo' ? 1 : 2);
      render(<App />);
      await openOriginal();
      fireEvent.click(screen.getByRole('button', { name: 'Select Alex' }));
      fireEvent.change(screen.getByLabelText('Nickname'), { target: { value: 'Last edit' } });
      if (action === 'Redo') fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
      const lastValid = await editorSnapshot();
      expect(lastValid.dataUpdatedAt).toBe(Number.MAX_SAFE_INTEGER);
      fireEvent.click(screen.getByRole('button', { name: action }));
      expect(screen.getByRole('alert').textContent).toContain('timestamp has reached its limit');
      expect(await editorSnapshot()).toEqual(lastValid);
      expect(screen.getByRole('button', { name: action })).toHaveProperty('disabled', false);
      expect(
        screen.getByRole('button', { name: action === 'Undo' ? 'Redo' : 'Undo' }),
      ).toHaveProperty('disabled', true);
      fireEvent.change(screen.getByLabelText('Nickname'), { target: { value: 'Rejected edit' } });
      expect(await editorSnapshot()).toEqual(lastValid);
      expect(screen.getByRole('button', { name: action })).toHaveProperty('disabled', false);
    },
  );

  it.each(['editor', 'library'] as const)(
    'rejects exhausted %s renames before persisting',
    async (location) => {
      original.dataUpdatedAt = Number.MAX_SAFE_INTEGER;
      render(<App />);
      if (location === 'editor') {
        await openOriginal();
        fireEvent.click(screen.getByTitle('Rename tree'));
      } else fireEvent.click(await screen.findByRole('button', { name: 'Rename Family' }));
      fireEvent.change(screen.getByLabelText('Tree name'), { target: { value: 'Rejected name' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save name' }));
      await screen.findByText(/timestamp has reached its limit/);
      expect(saveTree).not.toHaveBeenCalled();
      expect(records.get(original.id)).toEqual(original);
      expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    },
  );

  it.each([false, true])(
    'connects a child from a heart in one undoable edit (reversed=%s)',
    async (reversed) => {
      const child = makePerson('Child', 100, 300);
      original.people.push(child);
      render(<App />);
      await openOriginal();
      const heart = partnerNodeId('partner');
      act(() =>
        canvasEvents.onConnect({
          source: reversed ? child.id : heart,
          target: reversed ? heart : child.id,
          sourceHandle: reversed ? 'top' : 'child',
          targetHandle: reversed ? 'child' : 'top',
        }),
      );
      const connected = await editorSnapshot();
      expect(connected.relations.filter((r) => r.type === 'parent')).toEqual(
        original.people.slice(0, 2).map((p) => ({
          id: expect.any(String),
          type: 'parent',
          parentId: p.id,
          childId: child.id,
          kind: 'unspecified',
        })),
      );
      fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
      expect((await editorSnapshot()).relations).toEqual(original.relations);
      fireEvent.click(screen.getByRole('button', { name: 'Redo' }));
      expect((await editorSnapshot()).relations).toEqual(connected.relations);
    },
  );

  it('rejects a heart connection atomically when the second parent would create a cycle', async () => {
    const child = makePerson('Ancestor', 100, 300);
    original.people.push(child);
    original.relations.push({
      id: 'ancestor',
      type: 'parent',
      parentId: child.id,
      childId: original.people[1].id,
      kind: 'unspecified',
    });
    render(<App />);
    await openOriginal();
    act(() =>
      canvasEvents.onConnect({
        source: partnerNodeId('partner'),
        target: child.id,
        sourceHandle: 'child',
        targetHandle: 'top',
      }),
    );
    await screen.findByText('That connection would create an ancestry cycle.');
    expect((await editorSnapshot()).relations).toEqual(original.relations);
    expect(screen.getByRole('button', { name: 'Undo' })).toHaveProperty('disabled', true);
  });

  it('tracks adding people and relationships, including the first edit of a draft', async () => {
    render(<App />);
    await openOriginal();
    vi.spyOn(Date, 'now').mockReturnValue(original.dataUpdatedAt);
    act(() =>
      canvasEvents.onConnect({
        source: original.people[0].id,
        target: original.people[1].id,
        sourceHandle: 'bottom',
        targetHandle: 'top',
      }),
    );
    expect((await editorSnapshot()).dataUpdatedAt).toBe(original.dataUpdatedAt + 1);
    fireEvent.click(screen.getByRole('button', { name: 'Add person' }));
    const added = await editorSnapshot();
    expect(added.people).toHaveLength(3);
    expect(added.dataUpdatedAt).toBe(original.dataUpdatedAt + 2);
    fireEvent.click(screen.getByRole('button', { name: 'Back to trees' }));
    const create = await screen.findByRole('button', { name: 'New tree' });
    await act(async () => fireEvent.click(create));
    await screen.findByText('Make a change to start saving');
    const draft = await editorSnapshot();
    expect(draft.updatedAt).toBe(draft.dataUpdatedAt);
    fireEvent.click(screen.getByRole('button', { name: 'Add first person' }));
    const edited = await editorSnapshot();
    expect(edited.dataUpdatedAt).toBe(draft.dataUpdatedAt + 1);
    fireEvent.click(screen.getByRole('button', { name: 'Back to trees' }));
    await screen.findByRole('button', { name: 'Open My family tree' });
    expect(records.get(draft.id)).toEqual(edited);
  });

  it('advances meaningful person details and preserves repeated values', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(original.dataUpdatedAt);
    render(<App />);
    await openOriginal();
    fireEvent.click(screen.getByRole('button', { name: 'Select Alex' }));
    let expected = original.dataUpdatedAt;
    const expectEdit = async (edit: () => void) => {
      edit();
      expect((await editorSnapshot()).dataUpdatedAt).toBe(++expected);
    };
    await expectEdit(() =>
      fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Alexander' } }),
    );
    await expectEdit(() =>
      fireEvent.change(screen.getByLabelText('Last name'), { target: { value: 'Family' } }),
    );
    await expectEdit(() =>
      fireEvent.change(screen.getByLabelText('Nickname'), { target: { value: 'Al' } }),
    );
    await expectEdit(() =>
      fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'A story' } }),
    );
    await expectEdit(() => fireEvent.click(screen.getByRole('button', { name: 'Male' })));
    await expectEdit(() =>
      fireEvent.change(screen.getByRole('combobox', { name: 'Status' }), {
        target: { value: 'living' },
      }),
    );
    await expectEdit(() =>
      fireEvent.change(screen.getByRole('combobox', { name: 'Status' }), { target: { value: '' } }),
    );
    fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Alexander' } });
    fireEvent.change(screen.getByLabelText('Nickname'), { target: { value: 'Al' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Status' }), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Born', { exact: true }), {
      target: { value: 'unknown' },
    });
    expect((await editorSnapshot()).dataUpdatedAt).toBe(expected);
  });

  it('views a stored photo without editing data or creating undo entries', async () => {
    original.people[0].portrait = 'data:image/jpeg;base64,stored-photo';
    render(<App />);
    await openOriginal();
    fireEvent.click(screen.getByRole('button', { name: 'Select Alex' }));
    const before = await editorSnapshot();
    const saves = vi.mocked(saveTree).mock.calls.length;
    const edits = vi.mocked(driveSync.noteEdit).mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'View photo' }));
    expect(screen.getByRole('dialog', { name: 'Photo of Alex' })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Photo of Alex' }).getAttribute('src')).toBe(
      original.people[0].portrait,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
    expect(await editorSnapshot()).toEqual(before);
    expect(saveTree).toHaveBeenCalledTimes(saves);
    expect(driveSync.noteEdit).toHaveBeenCalledTimes(edits);
    expect(screen.getByRole('button', { name: 'Undo' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'Redo' })).toHaveProperty('disabled', true);
    expect(portraitData).not.toHaveBeenCalled();
  });

  it('tracks home, relationships and portraits and preserves repeated values', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(original.dataUpdatedAt);
    render(<App />);
    await openOriginal();
    fireEvent.click(screen.getByRole('button', { name: 'Select Alex' }));
    let expected = original.dataUpdatedAt;
    const expectEdit = async (edit: () => void) => {
      edit();
      expect((await editorSnapshot()).dataUpdatedAt).toBe(++expected);
    };
    await expectEdit(() =>
      fireEvent.click(screen.getByRole('button', { name: 'Clear home person' })),
    );
    await expectEdit(() =>
      fireEvent.click(screen.getByRole('button', { name: 'Set as home person' })),
    );
    fireEvent.click(screen.getByText('Relationships', { selector: 'h3' }));
    await expectEdit(() =>
      fireEvent.change(screen.getByLabelText('Partner status with Taylor'), {
        target: { value: 'former' },
      }),
    );
    fireEvent.change(screen.getByLabelText('Partner status with Taylor'), {
      target: { value: 'former' },
    });
    fireEvent.change(screen.getByLabelText('Union type with Taylor'), {
      target: { value: 'married' },
    });
    fireEvent.change(screen.getByLabelText('Relationship of Taylor to Alex'), {
      target: { value: 'partner' },
    });
    expect((await editorSnapshot()).dataUpdatedAt).toBe(expected);
    vi.mocked(portraitData).mockResolvedValue('data:image/jpeg;base64,photo');
    const upload = async () => {
      fireEvent.change(screen.getByLabelText('Choose portrait'), {
        target: { files: [new File(['photo'], 'photo.jpg', { type: 'image/jpeg' })] },
      });
      await screen.findByText('Photo updated.');
    };
    await upload();
    expect(screen.getByText('Photo updated.').closest('.toast-stack')?.id).toBe('operation-toasts');
    expect((await editorSnapshot()).dataUpdatedAt).toBe(++expected);
    fireEvent.click(screen.getByRole('button', { name: 'View photo' }));
    await upload();
    fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
    expect((await editorSnapshot()).dataUpdatedAt).toBe(expected);
    fireEvent.click(screen.getByRole('button', { name: 'View photo' }));
    await expectEdit(() => fireEvent.click(screen.getByRole('button', { name: 'Remove photo' })));
    await expectEdit(() =>
      fireEvent.click(screen.getByRole('button', { name: 'Remove relationship with Taylor' })),
    );
  });

  it('keeps invalid date drafts and identical committed dates out of timestamp tracking', async () => {
    original.people[0].born = { precision: 'year', year: 1980 };
    render(<App />);
    await openOriginal();
    fireEvent.click(screen.getByRole('button', { name: 'Select Alex' }));
    fireEvent.change(screen.getByLabelText('Born year'), { target: { value: '' } });
    expect(screen.getByText('Date edits not saved')).toBeTruthy();
    expect((await editorSnapshot()).dataUpdatedAt).toBe(original.dataUpdatedAt);
    fireEvent.change(screen.getByLabelText('Born year'), { target: { value: '1980' } });
    expect((await editorSnapshot()).dataUpdatedAt).toBe(original.dataUpdatedAt);
    expect(saveTree).not.toHaveBeenCalled();
    vi.spyOn(Date, 'now').mockReturnValue(original.dataUpdatedAt - 100);
    fireEvent.change(screen.getByLabelText('Born year'), { target: { value: '1981' } });
    expect((await editorSnapshot()).dataUpdatedAt).toBe(original.dataUpdatedAt + 1);
  });

  it('counts a completed group drag once and advances undo/redo from the current clock', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(original.dataUpdatedAt);
    render(<App />);
    await openOriginal();
    const moved = original.people.map(
      (person) =>
        ({ id: person.id, position: { x: person.x + 80, y: person.y + 40 } }) as PersonNode,
    );
    act(() => canvasEvents.onSelectionDragStart());
    act(() => canvasEvents.onMoveEnd(null, { x: 999, y: 999, zoom: 0.5 }));
    expect((await editorSnapshot()).dataUpdatedAt).toBe(original.dataUpdatedAt);
    act(() => canvasEvents.onSelectionDragStop(null, moved));
    expect((await editorSnapshot()).dataUpdatedAt).toBe(original.dataUpdatedAt + 1);
    act(() => canvasEvents.onNodeDragStop(null, moved[0], moved));
    expect((await editorSnapshot()).dataUpdatedAt).toBe(original.dataUpdatedAt + 1);
    clock.mockReturnValue(original.dataUpdatedAt - 500);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    const undone = await editorSnapshot();
    expect(undone.people).toEqual(original.people);
    expect(undone.dataUpdatedAt).toBe(original.dataUpdatedAt + 2);
    fireEvent.click(screen.getByRole('button', { name: 'Redo' }));
    const redone = await editorSnapshot();
    expect(redone.people.map((p) => [p.x, p.y])).toEqual([
      [80, 40],
      [80, 40],
    ]);
    expect(redone.dataUpdatedAt).toBe(original.dataUpdatedAt + 3);
    fireEvent.click(screen.getByRole('button', { name: 'Back to trees' }));
    await screen.findByRole('button', { name: 'Open Family' });
    expect(records.get(original.id)?.dataUpdatedAt).toBe(redone.dataUpdatedAt);
  });

  it('preserves data timestamps during navigation, panels, selection and ordinary saves', async () => {
    render(<App />);
    await openOriginal();
    expect(saveTree).not.toHaveBeenCalled();
    vi.spyOn(Date, 'now').mockReturnValue(original.updatedAt + 1000);
    act(() => canvasEvents.onMoveEnd(null, { x: 10, y: 20, zoom: 1 }));
    act(() => canvasEvents.onMoveEnd(null, { x: 10, y: 20, zoom: 0.5 }));
    fireEvent.click(screen.getByRole('button', { name: 'Fit tree' }));
    fireEvent.click(screen.getByRole('button', { name: 'Center on home person' }));
    fireEvent.click(screen.getByRole('button', { name: 'Select Taylor' }));
    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    const snapshot = await editorSnapshot();
    expect(snapshot.dataUpdatedAt).toBe(original.dataUpdatedAt);
    expect(snapshot.updatedAt).toBe(original.updatedAt + 1000);
    expect(screen.getByRole('button', { name: 'Undo' })).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('button', { name: 'Back to trees' }));
    await screen.findByRole('button', { name: 'Open Family' });
    expect(records.get(original.id)).toEqual(snapshot);
  });

  it('does not persist an untouched draft after viewport changes or an unchanged rename', async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'New tree' }));
    await screen.findByText('Make a change to start saving');
    const draft = await editorSnapshot();
    act(() => canvasEvents.onMoveEnd(null, { x: 10, y: 20, zoom: 0.5 }));
    fireEvent.click(screen.getByRole('button', { name: 'Fit tree' }));
    fireEvent.click(screen.getByTitle('Rename tree'));
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect((await editorSnapshot()).dataUpdatedAt).toBe(draft.dataUpdatedAt);
    fireEvent.click(screen.getByRole('button', { name: 'Back to trees' }));
    await screen.findByRole('button', { name: 'Open Family' });
    expect(saveTree).not.toHaveBeenCalled();
    expect(records.size).toBe(1);
  });

  it.each(['editor', 'library'] as const)(
    'uses matching persisted and in-memory timestamps for %s renames',
    async (location) => {
      const clock = vi.spyOn(Date, 'now').mockReturnValue(original.dataUpdatedAt);
      render(<App />);
      if (location === 'editor') {
        await openOriginal();
        fireEvent.click(screen.getByTitle('Rename tree'));
      } else fireEvent.click(await screen.findByRole('button', { name: 'Rename Family' }));
      fireEvent.change(screen.getByLabelText('Tree name'), { target: { value: 'Renamed' } });
      // Any accidental second timestamp capture would make memory disagree with storage.
      vi.mocked(saveTree).mockImplementationOnce(async (tree) => {
        records.set(tree.id, tree);
        clock.mockReturnValue(original.dataUpdatedAt + 1000);
        return tree.id;
      });
      fireEvent.click(screen.getByRole('button', { name: 'Save name' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(records.get(original.id)).toMatchObject({
        name: 'Renamed',
        updatedAt: original.dataUpdatedAt,
        dataUpdatedAt: original.dataUpdatedAt + 1,
      });
      if (location === 'library') {
        fireEvent.click(await screen.findByRole('button', { name: 'Open Renamed' }));
        await screen.findByRole('button', { name: 'Select Alex' });
      }
      expect(await editorSnapshot()).toEqual(records.get(original.id));
      fireEvent.click(screen.getByTitle('Rename tree'));
      fireEvent.click(screen.getByRole('button', { name: 'Save name' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect((await editorSnapshot()).dataUpdatedAt).toBe(original.dataUpdatedAt + 1);
    },
  );

  it('restores Drive before enabling saves and continues a pending save after authorization', async () => {
    driveState.configured = true;
    let restore!: () => void;
    vi.mocked(restoreDrive).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          restore = () => {
            setDriveConnection('connected');
            resolve();
          };
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
      revision: 'saved-revision',
      cleanupWarnings: [],
    });
    fireEvent.click(save);
    expect(saveDriveTree).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Select Alex' })).toBeTruthy();
    await waitFor(() => expect(authorizeDrive).toHaveBeenCalled());
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
    fireEvent.click(screen.getByRole('button', { name: 'Back to trees' }));
    await screen.findByRole('button', { name: 'Disconnect Drive' });
    vi.mocked(disconnectDrive).mockImplementationOnce(async () => {
      ++driveState.generation;
      setDriveConnection('error');
      throw Error('Disconnect failed. Please retry.');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect Drive' }));
    await screen.findByText('Disconnect failed. Please retry.');
    expect(screen.queryByText(/Forgot Google Drive access/)).toBeNull();
    expect(screen.queryByText('Disconnecting Google Drive…')).toBeNull();
    expect(screen.getByRole('button', { name: 'Disconnect Drive' })).toHaveProperty(
      'disabled',
      false,
    );
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
    expect(screen.getByRole('button', { name: 'Open Family' })).toBeTruthy();
    expect(disconnectDrive).toHaveBeenCalledTimes(2);
    expect(restoreDrive).toHaveBeenCalledOnce();
    expect(authorizeDrive).not.toHaveBeenCalled();
  });
  it('cancels tree deletion without changes and retains the tile after a failed delete', async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Family' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(removeWorkspaceStorage).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Delete Family' }));
    vi.mocked(removeWorkspaceStorage).mockRejectedValueOnce(Error('Deletion failed.'));
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
      vi.spyOn(Date, 'now').mockReturnValue(original.dataUpdatedAt);
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
      await act(() => vi.advanceTimersByTimeAsync(0));
      expect(records.get(original.id)?.name).toBe('Renamed family');
      expect(records.get(original.id)?.people[0].portrait).toBe(portrait);
      expect(records.get(original.id)?.dataUpdatedAt).toBe(original.dataUpdatedAt + 2);
      expect(screen.getByText('Saved locally')).toBeTruthy();
      expect(await editorSnapshot()).toEqual(records.get(original.id));

      fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
      expect(screen.getByTitle('Rename tree').textContent).toContain('Family');
      expect(screen.getByAltText('Portrait')).toHaveProperty('src', portrait);
      fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
      expect(screen.queryByAltText('Portrait')).toBeNull();
      expect(screen.getByRole('button', { name: 'Undo' })).toHaveProperty('disabled', true);
    },
  );

  it('deletes a home person and relationships, then restores both with Undo', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(original.dataUpdatedAt);
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
    expect((await editorSnapshot()).dataUpdatedAt).toBe(original.dataUpdatedAt + 1);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await screen.findByRole('button', { name: 'Select Alex' });
    expect(screen.getByRole('button', { name: 'Center on home person' })).toHaveProperty(
      'disabled',
      false,
    );
    expect(screen.getByText('2 people · 1 connections')).toBeTruthy();
    expect((await editorSnapshot()).dataUpdatedAt).toBe(original.dataUpdatedAt + 2);
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
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: 'Start a family tree' }),
      ),
    );
  });

  it.each(['success', 'rollback-pending', 'rollback-suppressed'] as const)(
    'preserves delayed layout edits when local deletion ends with %s',
    async (outcome) => {
      render(<App />);
      await openOriginal();
      const finishDrag = canvasEvents.onSelectionDragStop;
      const moved: PersonNode[] = original.people.map((person) => ({
        id: person.id,
        type: 'person',
        position: { x: person.x + 80, y: person.y + 40 },
        data: {
          person,
          selected: false,
          homeName: null,
          isHome: false,
          onSelect: vi.fn(),
          onDelete: vi.fn(),
        },
      }));
      fireEvent.click(screen.getByRole('button', { name: 'Back to trees' }));
      await screen.findByRole('button', { name: 'Delete Family' });
      let finishDelete!: () => void;
      vi.mocked(removeWorkspaceStorage).mockImplementationOnce(
        () =>
          new Promise((resolve, reject) => {
            finishDelete = () => {
              if (outcome === 'success') {
                records.delete(original.id);
                resolve();
              } else reject(Error('Deletion rolled back.'));
            };
          }),
      );
      fireEvent.click(screen.getByRole('button', { name: 'Delete Family' }));
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
      await waitFor(() => expect(removeWorkspaceStorage).toHaveBeenCalledOnce());
      const writes = vi.mocked(saveTree).mock.calls.length;
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      act(() => finishDrag(null, moved));
      if (outcome !== 'rollback-pending') await act(() => vi.advanceTimersByTimeAsync(450));
      await act(async () => finishDelete());
      if (outcome !== 'success') {
        expect(records.get(original.id)?.people[0].x).toBe(moved[0].position.x);
        expect(saveTree).toHaveBeenCalledTimes(writes + 1);
        expect(screen.getByRole('alert').textContent).toContain('Deletion rolled back.');
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Open Family' })));
        expect((await editorSnapshot()).people[0].x).toBe(moved[0].position.x);
        return;
      }
      await act(() => vi.advanceTimersByTimeAsync(450));
      expect(saveTree).toHaveBeenCalledTimes(writes);
      expect(records.has(original.id)).toBe(false);
      expect(screen.queryByRole('button', { name: 'Open Family' })).toBeNull();
    },
  );

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
    await screen.findByText('PNG export completed.');
    expect(vi.mocked(exportPng).mock.calls[1][0].people[0].nickname).toBe('Updated nickname');
    expect(vi.mocked(exportPng).mock.calls[1][0].people[0].portrait).toBe(
      'data:image/jpeg;base64,photo',
    );
  });
});

// Drive integration exercises snapshot ownership and the persistent incomplete-copy guard.
describe('per-tree Drive sync controls inside the editor', () => {
  it('hides desktop and mobile Drive saves when the deployment has no Drive configuration', async () => {
    render(<App />);
    await openOriginal();

    expect(screen.queryByRole('button', { name: 'Save to Drive' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Drive' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Export JSON' })).toHaveProperty('disabled', false);
    expect(screen.getByRole('button', { name: 'Export PNG' })).toHaveProperty('disabled', false);
    expect(restoreDrive).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    'persists switches while connected=%s and gates desktop/mobile saves',
    async (connected) => {
      driveState.configured = true;
      vi.mocked(restoreDrive).mockImplementationOnce(async () =>
        setDriveConnection(connected ? 'connected' : 'disconnected'),
      );
      links.set(original.id, {
        treeId: original.id,
        id: 'backup',
        name: 'Family.json',
        modifiedTime: '',
        syncEnabled: false,
      });
      vi.mocked(driveSync.setSyncEnabled).mockImplementation(async (id, enabled) => {
        links.set(id, { ...links.get(id)!, syncEnabled: enabled });
        window.dispatchEvent(new Event('tree-storage-changed'));
      });
      render(<App />);
      await screen.findByText('Drive sync off');
      expect(screen.queryByRole('switch')).toBeNull();
      expect(driveSync.setSyncEnabled).not.toHaveBeenCalled();
      await openOriginal();
      const editorSwitch = screen.getByRole('switch', { name: 'Google Drive sync for Family' });
      expect(editorSwitch.getAttribute('aria-checked')).toBe('false');
      expect(editorSwitch).toHaveProperty('disabled', false);
      await act(async () => fireEvent.click(editorSwitch));
      await waitFor(() => expect(editorSwitch.getAttribute('aria-checked')).toBe('true'));
      expect(driveSync.setSyncEnabled).toHaveBeenCalledWith(original.id, true);
      await act(async () => fireEvent.click(editorSwitch));
      await screen.findByText('Drive sync off');
      for (const name of ['Save to Drive', 'Drive']) {
        const save = screen.getByRole('button', { name });
        expect(save).toHaveProperty('disabled', true);
        fireEvent.click(save);
      }
      expect(driveSync.manualSave).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: 'Export JSON' })).toHaveProperty('disabled', false);
      await act(async () => fireEvent.click(editorSwitch));
      await waitFor(() => expect(editorSwitch.getAttribute('aria-checked')).toBe('true'));
      if (connected) {
        expect(screen.getByRole('button', { name: 'Save to Drive' })).toHaveProperty(
          'disabled',
          false,
        );
        expect(screen.getByRole('button', { name: 'Drive' })).toHaveProperty('disabled', false);
      }
      expect(links.get(original.id)?.id).toBe('backup');
      await act(async () => fireEvent.click(editorSwitch));
      await screen.findByText('Drive sync off');
      fireEvent.click(screen.getByRole('button', { name: 'Back to trees' }));
      await screen.findByRole('button', { name: 'Open Family' });
      expect(screen.queryByRole('switch')).toBeNull();
      expect(screen.getByText('Drive sync off')).toBeTruthy();
      if (!connected) {
        expect(await screen.findByRole('button', { name: 'Connect Drive' })).toHaveProperty(
          'disabled',
          false,
        );
      }
    },
  );

  it.each(['success', 'failure'])(
    'blocks desktop/mobile saves during a pending switch off ending in %s',
    async (outcome) => {
      driveState.configured = true;
      const link: DriveLink = {
        treeId: original.id,
        id: 'backup',
        name: 'Family.json',
        modifiedTime: '',
        syncEnabled: true,
      };
      links.set(original.id, link);
      let finish!: () => void;
      vi.mocked(driveSync.setSyncEnabled).mockImplementationOnce(
        () =>
          new Promise<void>((resolve, reject) => {
            syncState.views = {
              [original.id]: { status: 'synced', pending: false, link, syncChange: false },
            };
            finish = () => {
              const committed = outcome === 'success' ? { ...link, syncEnabled: false } : link;
              links.set(original.id, committed);
              syncState.views = {
                [original.id]: {
                  status: outcome === 'success' ? 'disabled' : 'synced',
                  pending: false,
                  link: committed,
                },
              };
              if (outcome === 'success') resolve();
              else reject(Error('Preference could not be saved'));
            };
          }),
      );
      const { rerender } = render(<App />);
      await openOriginal();
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Save to Drive' })).toHaveProperty(
          'disabled',
          false,
        ),
      );
      fireEvent.click(screen.getByRole('switch', { name: 'Google Drive sync for Family' }));
      rerender(<App />);
      expect(screen.getByText('Turning off…')).toBeTruthy();
      expect(links.get(original.id)?.syncEnabled).toBe(true);
      for (const name of ['Save to Drive', 'Drive']) {
        const save = screen.getByRole('button', { name });
        expect(save).toHaveProperty('disabled', true);
        fireEvent.click(save);
      }
      expect(authorizeDrive).not.toHaveBeenCalled();
      expect(driveSync.manualSave).not.toHaveBeenCalled();
      await act(async () => finish());
      rerender(<App />);
      for (const name of ['Save to Drive', 'Drive'])
        expect(screen.getByRole('button', { name })).toHaveProperty(
          'disabled',
          outcome === 'success',
        );
      if (outcome === 'failure')
        expect(screen.getByText('Preference could not be saved')).toBeTruthy();
      else expect(screen.getByText('Drive sync off')).toBeTruthy();
    },
  );

  it('keeps a failed editor switch enabled and reports persistence errors', async () => {
    links.set(original.id, {
      treeId: original.id,
      id: 'backup',
      name: 'Family.json',
      modifiedTime: '',
    });
    vi.mocked(driveSync.setSyncEnabled).mockRejectedValueOnce(
      Error('Preference could not be saved'),
    );
    render(<App />);
    await openOriginal();
    const toggle = await screen.findByRole('switch', { name: 'Google Drive sync for Family' });
    await act(async () => fireEvent.click(toggle));
    expect(await screen.findByText('Preference could not be saved')).toBeTruthy();
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(screen.queryByText('Drive sync off')).toBeNull();
  });
});

describe('Drive portrait feedback and associations', () => {
  it.each([false, true])(
    'identifies the saved backup by its readable name when link persistence fails: %s',
    async (linkFails) => {
      driveState.configured = true;
      const file = {
        id: 'remote-1',
        name: 'remote-1.json',
        description: 'García family',
        modifiedTime: '',
        revision: 'saved-revision',
        cleanupWarnings: ['Photo cleanup could not be completed.'],
      };
      vi.mocked(saveDriveTree).mockResolvedValueOnce(file);
      if (linkFails) vi.mocked(saveDriveLink).mockRejectedValueOnce(Error('Storage unavailable'));
      render(<App />);
      await openOriginal();
      fireEvent.click(screen.getByRole('button', { name: 'Save to Drive' }));
      const notice = linkFails
        ? 'Saved to Google Drive as García family, but this browser could not remember the file link. Open its Google Drive card in Workspace next time.'
        : 'Saved to Google Drive as García family.';
      await screen.findByText(`${notice} Photo cleanup could not be completed.`);
      expect(links.has(original.id)).toBe(!linkFails);
      expect(screen.queryByText(/Saved to Google Drive as remote-1/)).toBeNull();
    },
  );
  it.each([
    { name: 'remote-1.json', description: 'Saved family', label: 'Saved family' },
    { name: 'Old family.genealogical3.json', description: undefined, label: 'Old family' },
  ])(
    'routes a manual save to its linked file $label without the obsolete overwrite prompt',
    async ({ name, description, label }) => {
      driveState.configured = true;
      const backup = { id: 'remote-1', name, description, modifiedTime: '' };
      links.set(original.id, { treeId: original.id, ...backup });
      const confirm = vi.spyOn(window, 'confirm');
      vi.mocked(saveDriveTree).mockResolvedValueOnce({
        ...backup,
        revision: 'saved-revision',
        cleanupWarnings: [],
      });
      render(<App />);
      await openOriginal();
      fireEvent.click(screen.getByRole('button', { name: 'Save to Drive' }));
      await screen.findByText(`Saved to Google Drive as ${label}.`);
      expect(saveDriveTree).toHaveBeenCalledWith(original, backup.id, expect.any(Function));
      expect(confirm).not.toHaveBeenCalled();
    },
  );
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
    await waitFor(() => expect(authorizeDrive).toHaveBeenCalled());
    await act(async () => authorize());
    await screen.findByText('Uploading photos: 1 of 2');
    expect(saveDriveTree).toHaveBeenCalledWith(original, 'original-drive', expect.any(Function));
    // Edits to the active tree do not change the already captured snapshot.
    await act(async () =>
      finish({
        id: 'original-drive',
        name: 'Original.json',
        modifiedTime: '',
        revision: 'saved-revision',
        cleanupWarnings: ['Photo cleanup could not be completed.'],
      }),
    );
    await screen.findByText(/Saved to Google Drive as Original.json.*Photo cleanup/);
    expect(saveDriveLink).toHaveBeenCalledWith(
      expect.objectContaining({ treeId: original.id, id: 'original-drive' }),
    );
    expect(screen.getByText('Drive not linked')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Select Morgan' })).toBeTruthy();
  });

  it('persists incomplete restore warnings through reload and directs recovery to Workspace duplication', async () => {
    driveState.configured = true;
    const file = {
      id: 'source-drive',
      name: 'Family.json',
      description: 'Saved family',
      modifiedTime: '',
    };
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
    await screen.findByRole('button', { name: 'Open Family' });
    fireEvent.click(await screen.findByRole('button', { name: 'Open Saved family' }));
    await screen.findByText(/Incomplete Drive copy: portraits could not be restored for Alex/);
    const copyId = [...links.keys()][0];
    expect(copyId).not.toBe(original.id);
    expect(records.get(copyId)?.dataUpdatedAt).toBe(original.dataUpdatedAt);
    expect(links.get(copyId)?.restoreWarnings).toEqual(warnings);
    expect(links.get(copyId)?.description).toBe('Saved family');
    cleanup();
    render(<App />);
    const opens = await screen.findAllByRole('button', { name: 'Open Family' });
    fireEvent.click(opens[0]);
    await screen.findByText(/Incomplete Drive copy: portraits could not be restored for Alex/);
    const before = vi.mocked(saveDriveTree).mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Save to Drive' }));
    await screen.findByText(/This local copy has missing portraits/);
    expect(saveDriveTree).toHaveBeenCalledTimes(before);
    expect(screen.queryByRole('button', { name: /Save a copy/ })).toBeNull();
    expect(screen.getByText(/Duplicate it in Workspace/)).toBeTruthy();
    expect(links.get(copyId)?.id).toBe(file.id);
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
    fireEvent.click(await screen.findByRole('button', { name: 'Open Family.json' }));
    await screen.findByText('Storage unavailable');
    expect(records.size).toBe(1);
    expect(saveTree).not.toHaveBeenCalled();
  });
});

describe('combined Drive Workspace integration', () => {
  const file = { id: 'backup', name: 'Backup.genealogical3.json', modifiedTime: '2026-10-10' };
  it.each([
    ['download', 'local'],
    ['download', 'new'],
    ['storage', 'home'],
    ['opening', 'local'],
    ['download', 'rename'],
    ['download', 'delete'],
    ['download', 'duplicate'],
    ['storage', 'rename'],
    ['storage', 'delete'],
    ['storage', 'duplicate'],
    ['opening', 'rename'],
    ['opening', 'delete'],
    ['opening', 'duplicate'],
  ] as const)(
    'keeps newer %s-stage navigation to %s when a restore completes',
    async (stage, destination) => {
      driveState.configured = true;
      vi.mocked(listDriveTrees).mockResolvedValue([file]);
      const backup = { ...makeTree('Backup revision'), people: [makePerson('Backup person')] };
      const result = { tree: backup, restoreWarnings: [] };
      let finish!: () => void;
      if (stage === 'download') {
        vi.mocked(openDriveTree).mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              finish = () => resolve(result);
            }),
        );
      } else {
        vi.mocked(openDriveTree).mockResolvedValueOnce(result);
        if (stage === 'storage') {
          vi.mocked(saveTree).mockImplementationOnce(
            (tree) =>
              new Promise((resolve) => {
                finish = () => {
                  records.set(tree.id, tree);
                  resolve(tree.id);
                };
              }),
          );
        } else {
          vi.mocked(getTree).mockImplementationOnce(
            (id) =>
              new Promise((resolve) => {
                finish = () => resolve(records.get(id));
              }),
          );
        }
      }
      render(<App />);
      fireEvent.click(await screen.findByRole('button', { name: 'Open Backup' }));
      await waitFor(() => expect(finish).toBeTypeOf('function'));
      if (destination === 'new') {
        fireEvent.click(screen.getByRole('button', { name: 'New tree' }));
        await screen.findByText('My family tree');
      } else if (destination === 'rename' || destination === 'delete') {
        fireEvent.click(
          screen.getByRole('button', {
            name: `${destination === 'rename' ? 'Rename' : 'Delete'} Family`,
          }),
        );
        await screen.findByRole('dialog', {
          name: destination === 'rename' ? 'Rename tree' : 'Delete tree?',
        });
      } else if (destination === 'duplicate') {
        const copy = { ...original, id: 'local-copy', name: 'Family copy' };
        vi.mocked(duplicateSavedTree).mockImplementationOnce(async () => {
          records.set(copy.id, copy);
          return copy;
        });
        fireEvent.click(screen.getByRole('button', { name: 'Duplicate Family' }));
        await screen.findByRole('button', { name: 'Open Family copy' });
      } else {
        await openOriginal();
        if (destination === 'home') {
          fireEvent.click(screen.getByRole('button', { name: 'Back to trees' }));
          await screen.findByRole('button', { name: 'Open Family' });
        }
      }
      await act(async () => finish());
      expect(screen.queryByRole('button', { name: 'Select Backup person' })).toBeNull();
      if (
        destination === 'home' ||
        destination === 'rename' ||
        destination === 'delete' ||
        destination === 'duplicate'
      )
        expect(screen.getByRole('heading', { name: 'Your family trees' })).toBeTruthy();
      else
        expect(screen.getByTitle('Rename tree').textContent).toContain(
          destination === 'new' ? 'My family tree' : 'Family',
        );
      if (destination === 'rename' || destination === 'delete')
        expect(
          screen.getByRole('dialog', {
            name: destination === 'rename' ? 'Rename tree' : 'Delete tree?',
          }),
        ).toBeTruthy();
      if (destination === 'duplicate')
        expect(screen.getByRole('button', { name: 'Open Family copy' })).toBeTruthy();
      if (stage === 'download') {
        expect(saveTree).not.toHaveBeenCalled();
        expect(saveDriveLink).not.toHaveBeenCalled();
      }
      expect(records.get(original.id)).toEqual(original);
    },
  );
  it('discovers metadata without documents, local writes, uploads or interactive authorization', async () => {
    driveState.configured = true;
    vi.mocked(listDriveTrees).mockResolvedValue([file]);
    render(<App />);
    await screen.findByRole('button', { name: 'Open Backup' });
    expect(screen.getByRole('button', { name: 'Open Family' })).toBeTruthy();
    expect(openDriveTree).not.toHaveBeenCalled();
    expect(saveTree).not.toHaveBeenCalled();
    expect(saveDriveLink).not.toHaveBeenCalled();
    expect(saveDriveTree).not.toHaveBeenCalled();
    expect(authorizeDrive).not.toHaveBeenCalled();
  });
  it('resumes local edits, then downloads a protected working copy after local deletion', async () => {
    driveState.configured = true;
    links.set(original.id, { treeId: original.id, ...file });
    vi.mocked(listDriveTrees).mockResolvedValue([file]);
    render(<App />);
    await screen.findByRole('img', { name: 'Backed up in Google Drive' });
    expect(screen.queryByRole('button', { name: 'Open Backup' })).toBeNull();
    await openOriginal();
    expect(openDriveTree).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Back to trees' }));
    const backup = {
      ...original,
      name: 'Backup revision',
      people: [makePerson('Backup person')],
      relations: [],
      homePersonId: null,
    };
    const warnings = [{ personId: backup.people[0].id, name: 'Backup person' }];
    vi.mocked(openDriveTree).mockResolvedValueOnce({ tree: backup, restoreWarnings: warnings });
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Family' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Open Backup' }));
    await screen.findByRole('button', { name: 'Select Backup person' });
    expect(records.has(original.id)).toBe(false);
    const copy = [...records.values()].find((tree) => tree.id !== original.id)!;
    expect(copy.name).toBe('Backup revision');
    expect(links.get(copy.id)?.restoreWarnings).toEqual(warnings);
    expect(openDriveTree).toHaveBeenCalledWith(file.id, expect.any(Function));
    fireEvent.click(screen.getByRole('button', { name: 'Back to trees' }));
    await screen.findByRole('button', { name: 'Open Backup revision' });
    expect(screen.queryByRole('button', { name: 'Open Family' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Open Backup' })).toBeNull();
  });
  it('reveals a Drive-only backup when its local copy is deleted', async () => {
    driveState.configured = true;
    links.set(original.id, { treeId: original.id, ...file });
    vi.mocked(listDriveTrees).mockResolvedValue([file]);
    render(<App />);
    await screen.findByRole('img', { name: 'Backed up in Google Drive' });
    fireEvent.click(screen.getByRole('button', { name: 'Delete Family' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await screen.findByRole('button', { name: 'Open Backup' });
    expect(records.has(original.id)).toBe(false);
    expect(saveDriveTree).not.toHaveBeenCalled();
  });
  it('keeps local work available during listing failures and retries only metadata', async () => {
    driveState.configured = true;
    vi.mocked(listDriveTrees)
      .mockRejectedValueOnce(Error('Drive listing unavailable'))
      .mockResolvedValueOnce([file]);
    render(<App />);
    await screen.findByText('Drive listing unavailable');
    expect(screen.getByRole('button', { name: 'Open Family' })).toHaveProperty('disabled', false);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByRole('button', { name: 'Open Backup' });
    expect(openDriveTree).not.toHaveBeenCalled();
  });
  it('ignores a downloaded restore after a cross-tab disconnect without writing a local copy', async () => {
    driveState.configured = true;
    vi.mocked(listDriveTrees).mockResolvedValue([file]);
    let finish!: (result: Awaited<ReturnType<typeof openDriveTree>>) => void;
    vi.mocked(openDriveTree).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open Backup' }));
    await waitFor(() => expect(openDriveTree).toHaveBeenCalledOnce());
    await act(async () => {
      ++driveState.generation;
      setDriveConnection('disconnected');
      finish({ tree: original, restoreWarnings: [] });
    });
    expect(saveDriveLink).not.toHaveBeenCalled();
    expect(saveTree).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Open Family' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Open Backup' })).toBeNull();
  });
  it('retains the original local tree when saving a restored tree fails', async () => {
    driveState.configured = true;
    vi.mocked(listDriveTrees).mockResolvedValue([file]);
    vi.mocked(openDriveTree).mockResolvedValueOnce({ tree: original, restoreWarnings: [] });
    vi.mocked(saveTree).mockRejectedValueOnce(Error('Local storage full'));
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open Backup' }));
    await screen.findByText('Local storage full');
    expect(records.size).toBe(1);
    expect(records.get(original.id)).toEqual(original);
    expect(screen.getByRole('button', { name: 'Open Backup' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Select Alex' })).toBeNull();
  });
  it('refreshes Drive metadata after a successful explicit save', async () => {
    driveState.configured = true;
    render(<App />);
    await openOriginal();
    const before = vi.mocked(listDriveTrees).mock.calls.length;
    vi.mocked(saveDriveTree).mockResolvedValueOnce({
      ...file,
      description: 'Readable backup',
      revision: 'saved-revision',
      cleanupWarnings: [],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save to Drive' }));
    await screen.findByText('Saved to Google Drive as Readable backup.');
    await waitFor(() => expect(listDriveTrees).toHaveBeenCalledTimes(before + 1));
    expect(links.get(original.id)?.id).toBe(file.id);
    expect(links.get(original.id)?.description).toBe('Readable backup');
  });
});

describe('Workspace deletion integration', () => {
  const backup = { id: 'shared', name: 'Backup.genealogical3.json', modifiedTime: '2026-10-10' };
  function linkedCopies() {
    driveState.configured = true;
    const other = { ...original, id: 'other-local', name: 'Other local' };
    records.set(other.id, other);
    for (const tree of [original, other]) links.set(tree.id, { treeId: tree.id, ...backup });
    vi.mocked(listDriveTrees).mockResolvedValue([backup]);
    return other;
  }
  it.each(['local', 'drive', 'both'] as const)(
    'applies %s scope to shared backups while retaining other local copies',
    async (scope) => {
      const other = linkedCopies();
      render(<App />);
      fireEvent.click(await screen.findByRole('button', { name: 'Delete Family' }));
      fireEvent.click(
        screen.getByRole('radio', {
          name: { local: 'Local only', drive: 'Drive only', both: 'Both' }[scope],
        }),
      );
      expect(screen.getByRole('dialog').textContent?.includes('files you added manually')).toBe(
        scope !== 'local',
      );
      expect(screen.queryByRole('checkbox')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(records.has(original.id)).toBe(scope === 'drive');
      expect(records.get(other.id)).toEqual(other);
      expect(links.has(original.id)).toBe(false);
      expect(links.has(other.id)).toBe(scope === 'local');
      expect(deleteDriveBackup).toHaveBeenCalledTimes(scope === 'local' ? 0 : 1);
      expect(screen.queryByRole('button', { name: 'Open Backup' })).toBeNull();
      expect(screen.getByRole('button', { name: 'Open Other local' })).toBeTruthy();
      if (scope !== 'local')
        expect(screen.queryAllByRole('img', { name: 'Backed up in Google Drive' })).toHaveLength(0);
    },
  );
  it('removes a Drive-only card and prevents a stale listing from restoring it', async () => {
    driveState.configured = true;
    vi.mocked(listDriveTrees).mockResolvedValue([backup]);
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Backup from Drive' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(removeWorkspaceStorage).toHaveBeenCalledWith({ treeId: undefined, backupId: backup.id });
    expect(records.get(original.id)).toEqual(original);
    expect(screen.queryByRole('button', { name: 'Open Backup' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Open Family' })).toBeTruthy();
  });
  it('preserves local data after partial Drive failure and retains progress through Cancel and reopen', async () => {
    linkedCopies();
    vi.mocked(deleteDriveBackup).mockImplementationOnce(async (progress) => {
      progress.deletedPortraitIds.push('portrait-1');
      throw Error('1 portrait file permanently deleted. Retry to finish cleanup.');
    });
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Family' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Both' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await screen.findByText(/1 portrait file permanently deleted/);
    expect(removeWorkspaceStorage).not.toHaveBeenCalled();
    expect(records.has(original.id)).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete Family' }));
    expect(screen.getByRole('radio', { name: 'Both' })).toHaveProperty('checked', true);
    expect(screen.getByRole('group')).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(vi.mocked(deleteDriveBackup).mock.calls[1][0].deletedPortraitIds).toEqual([
      'portrait-1',
    ]);
    expect(records.has(original.id)).toBe(false);
  });
  it('retries browser cleanup after Drive success even after disconnect without another Drive deletion', async () => {
    linkedCopies();
    vi.mocked(removeWorkspaceStorage).mockRejectedValueOnce(Error('Quota failure'));
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Family' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Both' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await screen.findByText(/browser cleanup failed/);
    expect(records.has(original.id)).toBe(true);
    await act(async () => {
      ++driveState.generation;
      setDriveConnection('disconnected');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete Family' }));
    const before = vi.mocked(deleteDriveBackup).mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(deleteDriveBackup).toHaveBeenCalledTimes(before + 1);
    expect(vi.mocked(deleteDriveBackup).mock.calls.at(-1)?.[0].documentDeleted).toBe(true);
    expect(records.has(original.id)).toBe(false);
  });
  it('holds local data until Drive finishes and prevents duplicate pending submissions', async () => {
    linkedCopies();
    let finish!: () => void;
    vi.mocked(deleteDriveBackup).mockImplementationOnce(
      (progress, afterDelete) =>
        new Promise((resolve) => {
          finish = () => {
            progress.documentDeleted = true;
            void afterDelete?.().then(resolve);
          };
        }),
    );
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Family' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Both' }));
    const form = screen.getByRole('dialog').querySelector('form')!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    await waitFor(() => expect(deleteDriveBackup).toHaveBeenCalledOnce());
    expect(removeWorkspaceStorage).not.toHaveBeenCalled();
    expect(records.has(original.id)).toBe(true);
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveProperty('disabled', true);
    await act(async () => finish());
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(records.has(original.id)).toBe(false);
  });
});

describe('Drive connection entry points', () => {
  it.each([false, true])('offers Connect Drive with local trees present: %s', async (hasLocal) => {
    driveState.configured = true;
    if (!hasLocal) records.clear();
    vi.mocked(restoreDrive).mockImplementationOnce(async () => setDriveConnection('disconnected'));
    vi.mocked(listDriveTrees).mockResolvedValue([
      { id: 'backup', name: 'Remote.genealogical3.json', modifiedTime: '2026-10-10' },
    ]);
    render(<App />);
    if (hasLocal) await screen.findByRole('button', { name: 'Open Family' });
    else await screen.findByRole('button', { name: /Start a family tree/ });
    const connect = await screen.findByRole('button', { name: 'Connect Drive' });
    await waitFor(() => expect(connect).toHaveProperty('disabled', false));
    expect(authorizeDrive).not.toHaveBeenCalled();
    fireEvent.click(connect);
    await screen.findByRole('button', { name: 'Open Remote' });
    expect(screen.getByRole('button', { name: 'Disconnect Drive' })).toBeTruthy();
    expect(authorizeDrive).toHaveBeenCalledOnce();
    expect(openDriveTree).not.toHaveBeenCalled();
  });
  it('clears remote cards on disconnect while retaining local cards and associations', async () => {
    driveState.configured = true;
    const linked = { id: 'linked', name: 'Linked.genealogical3.json', modifiedTime: '2026-10-10' };
    links.set(original.id, { treeId: original.id, ...linked });
    vi.mocked(listDriveTrees).mockResolvedValue([
      linked,
      { ...linked, id: 'remote', name: 'Remote.genealogical3.json' },
    ]);
    render(<App />);
    await screen.findByRole('button', { name: 'Open Remote' });
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect Drive' }));
    await screen.findByRole('button', { name: 'Connect Drive' });
    expect(screen.queryByRole('button', { name: 'Open Remote' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Open Family' })).toHaveProperty('disabled', false);
    expect(links.get(original.id)?.id).toBe('linked');
    fireEvent.click(screen.getByRole('button', { name: 'Delete Family' }));
    expect(screen.getByRole('radio', { name: 'Drive only' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('radio', { name: 'Local only' })).toHaveProperty('disabled', false);
  });
});
