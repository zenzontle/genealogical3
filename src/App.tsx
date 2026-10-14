import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { driveSync } from './driveSync';
import { useDriveSync } from './useDriveSync';
import { DriveSyncStatus } from './DriveSyncStatus';
import { DriveConflictDialog } from './DriveConflictDialog';
import {
  ReactFlow,
  Background,
  ConnectionMode,
  Controls,
  type Connection,
  type Edge,
  type ReactFlowInstance,
  useNodesState,
} from '@xyflow/react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  CircleHelp,
  Download,
  FileImage,
  Heart,
  Home,
  Menu,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Redo2,
  Undo2,
  X,
} from 'lucide-react';
import { PersonCard, type PersonNode } from './PersonCard';
import { BrandMark } from './BrandMark';
import { PersonEditor, type ConnectMode } from './PersonEditor';
import { RelationshipEditor } from './RelationshipEditor';
import { HomeScreen } from './HomeScreen';
import { DriveActionsDialog } from './DriveActionsDialog';
import { useDriveWorkspace } from './useDriveWorkspace';
import { HeaderPersonSearch } from './HeaderPersonSearch';
import { TreeActionDialog, type TreeAction } from './TreeActionDialog';
import { WorkspaceDeletionDialog } from './WorkspaceDeletionDialog';
import { useWorkspaceDeletion } from './useWorkspaceDeletion';
import { driveTreeName, type WorkspaceEntry } from './workspaceEntries';
import { OperationFeedback } from './OperationFeedback';
import { useTreeImport } from './useTreeImport';
import { useTreeExport } from './useTreeExport';
import { RelationshipEdge } from './RelationshipEdge';
import { FamilyEdge } from './FamilyEdge';
import { relationshipEdges } from './relationshipEdges';
import { calculateKinships, type KinshipResult } from './kinship';
import { movePeopleToPositions, personPositionAtViewCenter } from './canvasPosition';
import { useConnectorProximity } from './useConnectorProximity';
import {
  addRelation,
  lifeDatesError,
  makePerson,
  makeTree,
  personCardSize,
  removePerson,
  setHomePerson,
  relationFromConnection,
  updateRelation,
  updatePerson,
  timestampDataChange,
  uid,
  type HandleSide,
  type LifeDates,
  type Relation,
  type Tree,
} from './model';
import {
  duplicateSavedTree,
  getDriveLink,
  getTree,
  listTrees,
  listDriveLinks,
  type DriveLink,
  saveTree,
  storedTreeData,
  TreeChangedError,
  updateLinkedTree,
} from './storage';
import {
  authorizeDrive,
  disconnectDrive,
  driveConfigured,
  getDriveConnection,
  getDriveGeneration,
  openDriveTree,
  queueDriveOperation,
  verifyDriveRestoreLocked,
  type DriveFile,
  type RestoreWarning,
  type PhotoProgress,
} from './drive';

const nodeTypes = { person: PersonCard };
const edgeTypes = { relationship: RelationshipEdge, family: FamilyEdge };
const cloneTree = (tree: Tree): Tree => structuredClone(tree);
type SaveState = 'draft' | 'saved' | 'saving' | 'error';
type TreeChange = 'data' | 'navigation';
type CommitOptions = {
  record?: boolean;
  persist?: boolean;
  // Renames persist before committing; reuse the exact timestamps that were written.
  timestamps?: Pick<Tree, 'updatedAt' | 'dataUpdatedAt'>;
};

export default function App() {
  const [screen, setScreen] = useState<'home' | 'editor'>('home');
  const [library, setLibrary] = useState<Tree[]>([]);
  const [libraryState, setLibraryState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [duplicatingTreeId, setDuplicatingTreeId] = useState<string | null>(null);
  const duplicateBusy = useRef(false);
  const [tree, setTree] = useState<Tree | null>(null);
  const people = tree?.people;
  const relations = tree?.relations;
  const homePersonId = tree?.homePersonId ?? null;
  const kinships = useMemo(
    () =>
      people && relations
        ? calculateKinships({ people, relations, homePersonId })
        : new Map<string, KinshipResult>(),
    [people, relations, homePersonId],
  );
  const home = tree?.people.find((p) => p.id === tree.homePersonId) || null;
  const [dateDrafts, setDateDrafts] = useState<Record<string, LifeDates>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedRelationId, setSelectedRelationId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [notice, setNotice] = useState('');
  const [treeAction, setTreeAction] = useState<TreeAction | null>(null);
  const [driveFile, setDriveFile] = useState<DriveFile | null>(null);
  const [restoreWarnings, setRestoreWarnings] = useState<RestoreWarning[]>([]);
  const [photoProgress, setPhotoProgress] = useState<PhotoProgress | null>(null);
  const driveOperationBusy = useRef(false);
  const [conflictTreeId, setConflictTreeId] = useState<string | null>(null);
  const [driveLinks, setDriveLinks] = useState<DriveLink[]>([]);
  const driveWorkspace = useDriveWorkspace(screen === 'home');
  const driveReady = driveWorkspace.ready;
  const [driveBusy, setDriveBusy] = useState(false);
  const [driveActionsOpen, setDriveActionsOpen] = useState(false);
  const [pendingCenter, setPendingCenter] = useState<{ treeId: string; personId: string } | null>(
    null,
  );
  const [connectMode, setConnectMode] = useState<ConnectMode>(null);
  const [mobilePanel, setMobilePanel] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarRevealedBySelection, setSidebarRevealedBySelection] = useState(false);
  const [nodes, setNodes, onNodesChange] = useNodesState<PersonNode>([]);
  const history = useRef<Tree[]>([]),
    future = useRef<Tree[]>([]),
    navigation = useRef(0),
    treeRef = useRef<Tree | null>(null),
    draftTree = useRef(false),
    saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    saveCounter = useRef(0),
    libraryRefresh = useRef(0),
    saveQueue = useRef<Promise<unknown>>(Promise.resolve()),
    storageRefresh = useRef<Promise<void>>(Promise.resolve()),
    persistedTrees = useRef(new Map<string, Tree>()),
    saveEpochs = useRef(new Map<string, number>()),
    fileInput = useRef<HTMLInputElement>(null),
    flowRef = useRef<ReactFlowInstance<PersonNode> | null>(null),
    canvasRef = useRef<HTMLDivElement>(null),
    fitViewOnOpen = useRef(false),
    movingRef = useRef(false);
  const removingLocal = useRef(new Set<string>());
  const removedLocal = useRef(new Set<string>());
  const deletion = useWorkspaceDeletion({
    operationBusy: driveOperationBusy,
    onBusy: setDriveBusy,
    onDriveDeleted: driveWorkspace.removeFile,
    beforeLocalRemoval: async (id) => {
      removingLocal.current.add(id);
      if (treeRef.current?.id === id) {
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = null;
        ++saveCounter.current;
      }
      await saveQueue.current.catch(() => undefined);
      return async () => {
        removingLocal.current.delete(id);
        // A rollback must persist edits whose autosaves were suppressed during deletion.
        if (!removedLocal.current.has(id) && treeRef.current?.id === id) await saveNow();
      };
    },
    onRemoved: (treeId, backupId) => {
      if (treeId) removedLocal.current.add(treeId);
      setLibrary((previous) => previous.filter((item) => item.id !== treeId));
      setDriveLinks((previous) =>
        previous.filter((link) => link.treeId !== treeId && link.id !== backupId),
      );
      if (treeRef.current?.id === treeId) {
        treeRef.current = null;
        setTree(null);
        setScreen('home');
      }
      if (backupId && driveFile?.id === backupId) {
        setDriveFile(null);
        setRestoreWarnings([]);
      }
      if (backupId) void driveWorkspace.refresh();
    },
  });
  useConnectorProximity(canvasRef, screen === 'editor');
  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      ++saveCounter.current;
    },
    [],
  );
  const exports = useTreeExport(screen === 'editor' ? tree?.id : undefined, () => treeRef.current);
  const imports = useTreeImport(
    (copy) =>
      setLibrary((previous) =>
        [copy, ...previous.filter((item) => item.id !== copy.id)].sort(
          (a, b) => b.updatedAt - a.updatedAt,
        ),
      ),
    async () => {
      setLibrary((await listTrees()).sort((a, b) => b.updatedAt - a.updatedAt));
      setLibraryState('ready');
    },
  );
  const showError = useCallback((error: unknown) => {
    setNotice(error instanceof Error ? error.message : 'Something went wrong.');
  }, []);
  const refreshLibrary = useCallback(async () => {
    const request = ++libraryRefresh.current;
    try {
      const trees = await listTrees();
      if (request !== libraryRefresh.current) return false;
      // Keep local trees usable even if reading their associations fails.
      setLibrary(trees.sort((a, b) => b.updatedAt - a.updatedAt));
      setLibraryState('ready');
      const links = await listDriveLinks();
      if (request !== libraryRefresh.current) return false;
      setDriveLinks(links);
      const active = treeRef.current;
      if (active && !draftTree.current) {
        const link = links.find((item) => item.treeId === active.id);
        setDriveFile(link || null);
        setRestoreWarnings(link?.restoreWarnings || []);
      }
      return true;
    } catch (error) {
      if (request !== libraryRefresh.current) return false;
      setLibraryState((previous) => (previous === 'ready' ? previous : 'error'));
      showError(error);
      return false;
    }
  }, [showError]);
  useEffect(() => {
    const refreshFromAnotherTab = () => {
      void refreshLibrary();
      const active = treeRef.current;
      if (!active || draftTree.current || !persistedTrees.current.has(active.id)) return;
      const request = navigation.current;
      const epoch = saveEpochs.current.get(active.id) || 0;
      const invalidate = (message: string) => {
        if ((saveEpochs.current.get(active.id) || 0) !== epoch) return;
        saveEpochs.current.set(active.id, epoch + 1);
        if (treeRef.current?.id !== active.id) return;
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = null;
        ++saveCounter.current;
        if (request === navigation.current) ++navigation.current;
        treeRef.current = null;
        void driveSync.discardEdits(active.id).catch(showError);
        history.current = [];
        future.current = [];
        setTree(null);
        setTreeAction(null);
        setConflictTreeId(null);
        setPendingCenter(null);
        setSelectedId(null);
        setSelectedRelationId(null);
        setScreen('home');
        setNotice(message);
      };
      // Hold saves until the stored version is checked, then reject stale queued snapshots.
      storageRefresh.current = storageRefresh.current.then(async () => {
        try {
          const latest = await getTree(active.id);
          const baseline = persistedTrees.current.get(active.id) || active;
          if (latest && storedTreeData(latest) === storedTreeData(baseline)) return;
          invalidate(
            'This tree changed in another tab. Reopen it from Workspace to load the current version.',
          );
        } catch (error) {
          invalidate(
            'Could not check this tree for changes from another tab. Reopen it from Workspace before editing.',
          );
          showError(error);
        }
      });
    };
    refreshLibrary();
    window.addEventListener('tree-storage-changed', refreshLibrary);
    window.addEventListener('tree-storage-refreshed', refreshFromAnotherTab);
    return () => {
      window.removeEventListener('tree-storage-changed', refreshLibrary);
      window.removeEventListener('tree-storage-refreshed', refreshFromAnotherTab);
    };
  }, [refreshLibrary, showError]);
  const queueSave = useCallback((value: Tree, expected?: Tree) => {
    const epoch = saveEpochs.current.get(value.id) || 0;
    const queued = saveQueue.current
      .catch(() => undefined)
      .then(async () => {
        let checked: Promise<void>;
        do {
          checked = storageRefresh.current;
          await checked;
        } while (checked !== storageRefresh.current);
        if ((saveEpochs.current.get(value.id) || 0) !== epoch) throw new TreeChangedError();
        if (removingLocal.current.has(value.id) || removedLocal.current.has(value.id)) return;
        const saved = await saveTree(value, expected ?? persistedTrees.current.get(value.id));
        if ((saveEpochs.current.get(value.id) || 0) === epoch)
          persistedTrees.current.set(value.id, value);
        return saved;
      });
    saveQueue.current = queued;
    return queued;
  }, []);
  const persistOnClose = useCallback(async () => {
    if (!treeRef.current || draftTree.current) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = null;
    await queueSave(treeRef.current);
  }, [queueSave]);
  const syncViews = useDriveSync(persistOnClose, showError);
  const commit = useCallback(
    (
      next: Tree,
      change: TreeChange,
      { record = true, persist = true, timestamps }: CommitOptions = {},
    ) => {
      const previous = treeRef.current;
      if (!previous || next === previous) return;
      const stamped = timestamps
        ? { ...next, updatedAt: timestamps.updatedAt, dataUpdatedAt: timestamps.dataUpdatedAt }
        : change === 'data'
          ? timestampDataChange(next, previous)
          : {
              ...next,
              updatedAt: persist ? Date.now() : next.updatedAt,
              dataUpdatedAt: previous.dataUpdatedAt,
            };
      if (record) {
        history.current.push(cloneTree(previous));
        if (history.current.length > 50) history.current.shift();
        future.current = [];
      }
      const updated = {
        ...stamped,
        version: 2 as const,
      };
      treeRef.current = updated;
      setTree(updated);
      // Viewport updates do not turn an untouched new tree into a saved tree.
      if (change === 'data') draftTree.current = false;
      if (change === 'data') driveSync.noteEdit(updated.id, updated.dataUpdatedAt);
      if (draftTree.current) return;
      if (!persist) {
        setSaveState('saved');
        return;
      }
      setSaveState('saving');
      if (saveTimer.current) clearTimeout(saveTimer.current);
      const count = ++saveCounter.current;
      const persistUpdate = async () => {
        saveTimer.current = null;
        try {
          await queueSave(updated);
          if (count === saveCounter.current) {
            setSaveState('saved');
            refreshLibrary();
          }
        } catch (error) {
          if (count === saveCounter.current) {
            setSaveState('error');
            showError(error);
          }
        }
      };
      // Persist data edits promptly; navigation must never postpone pending data.
      if (change === 'data') void persistUpdate();
      else saveTimer.current = setTimeout(persistUpdate, 450);
    },
    [queueSave, refreshLibrary, showError],
  );
  const openTree = async (id: string, draft?: Tree) => {
    const request = ++navigation.current;
    try {
      if (saveTimer.current && treeRef.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
        await queueSave(treeRef.current);
      }
      await saveQueue.current.catch((error: unknown) => {
        if (!(error instanceof TreeChangedError)) throw error;
      });
      const found = draft || (await getTree(id));
      if (!found) throw Error('This tree was not found.');
      const link = draft ? undefined : await getDriveLink(id);
      if (request !== navigation.current) return false;
      if (!draft) persistedTrees.current.set(found.id, found);
      history.current = [];
      future.current = [];
      treeRef.current = found;
      draftTree.current = !!draft;
      fitViewOnOpen.current =
        found.people.length > 0 &&
        (window.innerWidth < 700 || (found.viewport.x === 0 && found.viewport.y === 0));
      setTree(found);
      setNodes([]);
      setDateDrafts({});
      setSelectedId(null);
      setSelectedRelationId(null);
      setPendingCenter(null);
      setDriveFile(
        link
          ? {
              id: link.id,
              name: link.name,
              description: link.description,
              modifiedTime: link.modifiedTime,
            }
          : null,
      );
      setRestoreWarnings(link?.restoreWarnings || []);
      setScreen('editor');
      setSaveState(draft ? 'draft' : 'saved');
      setNotice('');
      return true;
    } catch (error) {
      if (request === navigation.current) showError(error);
      return false;
    }
  };
  const createTree = async () => {
    const newTree = makeTree('My family tree');
    await openTree(newTree.id, newTree);
  };
  const apply = useCallback(
    (update: (current: Tree) => Tree, record = true) => {
      if (!treeRef.current) return false;
      try {
        commit(update(treeRef.current), 'data', { record });
        setNotice('');
        return true;
      } catch (error) {
        showError(error);
        return false;
      }
    },
    [commit, showError],
  );
  const editLifeDates = (personId: string, changes: Partial<LifeDates>) => {
    const current = treeRef.current?.people.find((p) => p.id === personId);
    if (!current) return;
    const dates = {
      ...(dateDrafts[personId] || {
        born: current.born,
        died: current.died,
        lifeStatus: current.lifeStatus,
      }),
      ...changes,
    };
    setDateDrafts((previous) => {
      const next = { ...previous };
      if (lifeDatesError(dates)) next[personId] = dates;
      else delete next[personId];
      return next;
    });
    if (!lifeDatesError(dates)) apply((t) => updatePerson(t, { ...current, ...dates }));
  };
  const addPerson = (relative?: Exclude<ConnectMode, null>) => {
    const current = treeRef.current;
    if (!current) return;
    const selected = relative ? current.people.find((p) => p.id === selectedId) : undefined;
    const shift = (current.people.length % 4) * 30;
    const size = canvasRef.current?.getBoundingClientRect();
    if (!size || !flowRef.current) return;
    const center = personPositionAtViewCenter(flowRef.current.getViewport(), size);
    const x = selected ? selected.x + (relative === 'partner' ? 350 : shift) : center.x;
    const y = selected
      ? selected.y + (relative === 'parent' ? -220 : relative === 'child' ? 220 : 0)
      : center.y;
    const person = makePerson('', x, y);
    let next = { ...current, people: [...current.people, person] };
    if (selected && relative)
      next = addRelation(
        next,
        relative === 'partner'
          ? {
              id: uid(),
              type: 'partner',
              personA: selected.id,
              personB: person.id,
              status: 'unspecified',
              union: 'unspecified',
            }
          : {
              id: uid(),
              type: 'parent',
              parentId: relative === 'parent' ? person.id : selected.id,
              childId: relative === 'child' ? person.id : selected.id,
              kind: 'unspecified',
            },
      );
    try {
      commit(next, 'data');
    } catch (error) {
      showError(error);
      return;
    }
    selectPerson(person.id);
    if (relative)
      requestAnimationFrame(() =>
        flowRef.current?.setCenter(
          person.x + personCardSize.width / 2,
          person.y + personCardSize.height / 2,
          {
            zoom: Math.min(flowRef.current?.getZoom() || 1, 1.1),
            duration: 350,
          },
        ),
      );
  };
  const deletePerson = useCallback((id: string) => {
    const current = treeRef.current;
    const person = current?.people.find((p) => p.id === id);
    if (!current || !person) return;
    setTreeAction({
      kind: 'delete-person',
      treeId: current.id,
      personId: id,
      name: person.name,
      isHome: current.homePersonId === id,
    });
  }, []);
  const connect = (connection: Connection) => {
    const a = connection.source,
      b = connection.target;
    if (!a || !b || !connection.sourceHandle || !connection.targetHandle) return;
    const sh = connection.sourceHandle.replace('-target', ''),
      th = connection.targetHandle.replace('-target', '');
    const relation = relationFromConnection(a, b, sh as HandleSide, th as HandleSide);
    apply((t) => addRelation(t, relation));
  };
  const connectFromPanel = (targetId: string) => {
    if (!selectedId || !connectMode) return;
    const r: Relation =
      connectMode === 'partner'
        ? {
            id: uid(),
            type: 'partner',
            personA: selectedId,
            personB: targetId,
            status: 'unspecified',
            union: 'unspecified',
          }
        : {
            id: uid(),
            type: 'parent',
            parentId: connectMode === 'parent' ? targetId : selectedId,
            childId: connectMode === 'child' ? targetId : selectedId,
            kind: 'unspecified',
          };
    apply((t) => addRelation(t, r));
    setConnectMode(null);
  };
  const undo = () => {
    const previous = history.current.at(-1),
      current = treeRef.current;
    if (!previous || !current) return;
    try {
      commit(previous, 'data', { record: false });
      history.current.pop();
      future.current.push(cloneTree(current));
      setDateDrafts({});
    } catch (error) {
      showError(error);
    }
  };
  const redo = () => {
    const next = future.current.at(-1),
      current = treeRef.current;
    if (!next || !current) return;
    try {
      commit(next, 'data', { record: false });
      future.current.pop();
      history.current.push(cloneTree(current));
      setDateDrafts({});
    } catch (error) {
      showError(error);
    }
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (document.querySelector('.local-dialog[open]')) return;
      if (!(e.ctrlKey || e.metaKey) || !['z', 'y'].includes(e.key.toLowerCase())) return;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement).tagName)) return;
      if (e.target instanceof Element && e.target.closest('.person-search')) return;
      e.preventDefault();
      if (e.key.toLowerCase() === 'z' && !e.shiftKey) undo();
      else redo();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });
  useEffect(() => {
    if (!tree) return;
    setNodes((currentNodes) => {
      const existing = new Map(currentNodes.map((node) => [node.id, node]));
      return tree.people.map((p) => ({
        ...existing.get(p.id),
        id: p.id,
        type: 'person',
        selected: existing.get(p.id)?.selected ?? selectedId === p.id,
        position: movingRef.current
          ? existing.get(p.id)?.position || { x: p.x, y: p.y }
          : { x: p.x, y: p.y },
        data: {
          person: p,
          homeName: home ? home.name || 'Unnamed person' : null,
          isHome: tree.homePersonId === p.id,
          kinship: kinships.get(p.id),
          selected: selectedId === p.id,
          onDelete: deletePerson,
          onSelect: (id: string) => {
            setSelectedId(id);
            setSelectedRelationId(null);
            setSidebarRevealedBySelection(true);
          },
        },
        draggable: true,
      }));
    });
  }, [tree, kinships, home, selectedId, setNodes, deletePerson]);
  const selectPerson = useCallback(
    (id: string) => {
      setNodes((current) =>
        current.map((node) => ({
          ...node,
          selected: node.id === id,
        })),
      );
      setSelectedId(id);
      setSelectedRelationId(null);
      setSidebarRevealedBySelection(true);
    },
    [setNodes],
  );
  const edges = useMemo<Edge[]>(() => {
    if (!tree) return [];
    const positions = new Map(nodes.map((node) => [node.id, node.position]));
    const sizes = new Map(
      nodes.flatMap((node) =>
        node.measured?.width && node.measured.height
          ? [[node.id, { width: node.measured.width, height: node.measured.height }] as const]
          : [],
      ),
    );
    return relationshipEdges(tree, positions, selectedRelationId, selectPerson, sizes);
  }, [tree, nodes, selectedRelationId, selectPerson]);
  const selected = tree?.people.find((p) => p.id === selectedId) || null;
  const selectedRelation = tree?.relations.find((r) => r.id === selectedRelationId) || null;
  // Selection temporarily reveals details without changing the toggle preference.
  const revealSidebar = sidebarRevealedBySelection && !!(selected || selectedRelation);
  const sidebarIsCollapsed = sidebarCollapsed && !revealSidebar;
  const mobilePanelIsOpen = mobilePanel || revealSidebar;
  const centerPerson = useCallback((id: string) => {
    const person = treeRef.current?.people.find((value) => value.id === id);
    const flow = flowRef.current;
    if (!person || !flow) return;
    const node = flow.getNode(id);
    const position = node?.position || person;
    void flow.setCenter(
      position.x + (node?.measured?.width || personCardSize.width) / 2,
      position.y + (node?.measured?.height || personCardSize.height) / 2,
      {
        zoom: 1,
        duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 350,
      },
    );
  }, []);
  useEffect(() => {
    if (!pendingCenter) return;
    // Let React Flow measure the canvas after selection expands the sidebar.
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        if (treeRef.current?.id === pendingCenter.treeId) centerPerson(pendingCenter.personId);
        setPendingCenter(null);
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [pendingCenter, centerPerson]);
  const jumpToPerson = (id: string) => {
    const current = treeRef.current;
    if (!current?.people.some((person) => person.id === id)) return;
    setConnectMode(null);
    selectPerson(id);
    setPendingCenter({ treeId: current.id, personId: id });
  };
  const saveNow = async (requirePersistence = false) => {
    if (!treeRef.current || draftTree.current) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = null;
    const count = ++saveCounter.current;
    try {
      await queueSave(treeRef.current);
      if (count === saveCounter.current) {
        setSaveState('saved');
        refreshLibrary();
      }
    } catch (error) {
      setSaveState('error');
      showError(error);
      if (requirePersistence) throw error;
    }
  };
  const doDrive = async () => {
    if (!driveReady || driveOperationBusy.current || !treeRef.current) return;
    const snapshot = cloneTree(treeRef.current);
    const expectedBackupId = syncViews[snapshot.id]?.link.id ?? driveFile?.id ?? null;
    if (restoreWarnings.length) {
      setNotice(
        'This local copy has missing portraits. Duplicate it in Workspace for safekeeping, delete the linked local copy, and reopen the remaining Drive card to download again.',
      );
      return;
    }
    driveOperationBusy.current = true;
    setDriveBusy(true);
    setPhotoProgress(null);
    try {
      draftTree.current = false;
      // Start authorization in the click gesture so first-time consent can open its popup.
      await Promise.all([authorizeDrive(), saveNow(true)]);
      const file = await driveSync.manualSave(
        snapshot.id,
        setPhotoProgress,
        undefined,
        expectedBackupId,
      );
      if (file) {
        if (treeRef.current?.id === snapshot.id) {
          setDriveFile(file);
          setRestoreWarnings([]);
        }
        setNotice(
          [
            `Saved to Google Drive as ${driveTreeName(file.name, file.description)}.`,
            ...file.cleanupWarnings,
          ].join(' '),
        );
      } else if (driveSync.snapshot()[snapshot.id]?.conflict) setConflictTreeId(snapshot.id);
      else if (driveSync.snapshot()[snapshot.id]?.status === 'synced')
        setNotice('Your Drive backup is up to date.');
      await refreshLibrary();
      void driveWorkspace.refresh();
    } catch (error) {
      showError(error);
    } finally {
      driveOperationBusy.current = false;
      setDriveBusy(false);
      setPhotoProgress(null);
    }
  };
  const loadDrive = async (file: DriveFile) => {
    if (driveOperationBusy.current) return;
    const origin = navigation.current;
    driveOperationBusy.current = true;
    setDriveBusy(true);
    setPhotoProgress(null);
    try {
      await authorizeDrive();
      const generation = getDriveGeneration();
      const result = await openDriveTree(file.id, setPhotoProgress);
      if (origin !== navigation.current) return;
      if (generation !== getDriveGeneration() || getDriveConnection() !== 'connected')
        throw Error('Google Drive connection changed. Open the Workspace card again to retry.');
      const imported = result.tree;
      const copy = {
        ...imported,
        id: uid(),
        name: imported.name,
        updatedAt: Date.now(),
      };
      await queueDriveOperation(generation, async () => {
        await verifyDriveRestoreLocked(file.id, generation, result);
        // Keep tree contents, safety flags and association in one locked atomic commit.
        await updateLinkedTree(copy.id, () => {
          if (generation !== getDriveGeneration() || getDriveConnection() !== 'connected')
            throw Error('Google Drive connection changed. Open the Workspace card again to retry.');
          return {
            tree: copy,
            link: {
              treeId: copy.id,
              id: file.id,
              name: file.name,
              description: file.description,
              modifiedTime: file.modifiedTime,
              restoreWarnings: result.restoreWarnings,
              sync: {
                acknowledgedDataUpdatedAt: copy.dataUpdatedAt,
                revision: result.revision,
                pending: false,
              },
            },
          };
        });
      });
      await refreshLibrary();
      if (origin !== navigation.current) return;
      if (!(await openTree(copy.id))) return;
      setDriveFile(file);
      setRestoreWarnings(result.restoreWarnings);
      setNotice(
        result.restoreWarnings.length
          ? 'Opened an incomplete local working copy. See the missing-portrait warning.'
          : 'Opened a local working copy. Future data edits sync to Drive automatically.',
      );
    } catch (error) {
      if (origin === navigation.current) showError(error);
    } finally {
      driveOperationBusy.current = false;
      setDriveBusy(false);
      setPhotoProgress(null);
    }
  };
  const forgetDrive = async () => {
    if (driveOperationBusy.current) return;
    setDriveBusy(true);
    try {
      await disconnectDrive();
      setDriveActionsOpen(false);
      setNotice('Forgot Google Drive access in this browser. Your local tree is still saved.');
    } catch (error) {
      showError(error);
    } finally {
      setDriveBusy(false);
    }
  };
  const rename = (item: Tree) => {
    ++navigation.current;
    setTreeAction({ kind: 'rename', treeId: item.id, name: item.name });
  };
  const duplicate = async (item: Tree) => {
    if (duplicateBusy.current) return;
    ++navigation.current;
    duplicateBusy.current = true;
    setDuplicatingTreeId(item.id);
    try {
      const copy = await duplicateSavedTree(item.id);
      // Keep the persisted copy visible even if the subsequent library read fails.
      setLibrary((previous) => [copy, ...previous].sort((a, b) => b.updatedAt - a.updatedAt));
      if (await refreshLibrary()) setNotice(`Created ${copy.name}.`);
    } catch (error) {
      showError(error);
    } finally {
      duplicateBusy.current = false;
      setDuplicatingTreeId(null);
    }
  };
  const removeTree = (entry: WorkspaceEntry) => {
    ++navigation.current;
    deletion.open(entry);
  };
  const submitTreeAction = async (name: string) => {
    const action = treeAction;
    if (!action) return;
    if (action.kind === 'delete-person') {
      const current = treeRef.current;
      if (
        !current ||
        current.id !== action.treeId ||
        !current.people.some((person) => person.id === action.personId)
      )
        throw Error('This person was not found in the current tree.');
      commit(removePerson(current, action.personId), 'data');
      setDateDrafts((previous) => {
        const next = { ...previous };
        delete next[action.personId];
        return next;
      });
      setSelectedId(null);
      setSelectedRelationId(null);
      return;
    }
    const active = treeRef.current?.id === action.treeId;
    if (active) {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = null;
      ++saveCounter.current;
    }
    // A queued autosave must finish before a rename or deletion can replace its result.
    await saveQueue.current.catch(() => undefined);
    if (action.kind === 'rename') {
      const currentIsActive = treeRef.current?.id === action.treeId;
      const current = currentIsActive ? treeRef.current : await getTree(action.treeId);
      if (!current) throw Error('This tree was not found.');
      if (name !== current.name) {
        let updated = timestampDataChange({ ...current, name }, current);
        try {
          await queueSave(updated, currentIsActive ? undefined : current);
        } catch (error) {
          if (treeRef.current?.id === action.treeId) setSaveState('error');
          throw error;
        }
        const latest = treeRef.current;
        if (latest?.id === action.treeId) {
          // Preserve edits that finished during the write and replace their stale autosave.
          const changedWhileSaving = latest !== current;
          if (changedWhileSaving) updated = timestampDataChange({ ...latest, name }, latest);
          commit(updated, 'data', { persist: changedWhileSaving, timestamps: updated });
        }
        setLibrary((previous) =>
          [updated, ...previous.filter((item) => item.id !== updated.id)].sort(
            (a, b) => b.updatedAt - a.updatedAt,
          ),
        );
      } else if (treeRef.current?.id === action.treeId && !draftTree.current) {
        try {
          await queueSave(current);
        } catch (error) {
          setSaveState('error');
          throw error;
        }
        setSaveState('saved');
      }
      return;
    }
  };
  const leaveEditor = async () => {
    ++navigation.current;
    await saveNow();
    setPendingCenter(null);
    setScreen('home');
    setSelectedId(null);
    setMobilePanel(false);
  };
  const saveMovedNodes = (movedNodes: PersonNode[]) => {
    movingRef.current = false;
    const current = treeRef.current;
    if (!current) return;
    const next = movePeopleToPositions(current, movedNodes);
    if (next === current || apply(() => next)) return;
    // A rejected layout edit must also restore the cards rendered during the drag.
    const positions = new Map(current.people.map((p) => [p.id, { x: p.x, y: p.y }]));
    setNodes((nodes) =>
      nodes.map((node) => ({
        ...node,
        position: positions.get(node.id) || node.position,
      })),
    );
  };
  const onViewportEnd = (_: unknown, viewport: { x: number; y: number; zoom: number }) => {
    if (movingRef.current) return;
    const current = treeRef.current;
    if (!current) return;
    if (
      Math.abs(current.viewport.x - viewport.x) +
        Math.abs(current.viewport.y - viewport.y) +
        Math.abs(current.viewport.zoom - viewport.zoom) <
      0.01
    )
      return;
    commit({ ...current, viewport }, 'navigation', { record: false });
  };
  const hasInvalidDateDraft = tree?.people.some((p) => !!lifeDatesError(dateDrafts[p.id] || p));
  const downloadJson = () => exports.run('JSON');
  const localStatus =
    hasInvalidDateDraft && saveState !== 'error'
      ? 'Date edits not saved'
      : saveState === 'saved'
        ? 'Saved locally'
        : saveState === 'draft'
          ? 'Make a change to start saving'
          : saveState === 'saving'
            ? 'Saving locally…'
            : 'Local save failed · export JSON';
  return (
    <>
      <input
        ref={fileInput}
        className="sr-only"
        type="file"
        aria-label="Import JSON file"
        accept="application/json,.json"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void imports.run(f);
          e.currentTarget.value = '';
        }}
      />
      {screen === 'home' ? (
        <HomeScreen
          library={library}
          libraryState={libraryState}
          driveLinks={driveLinks}
          syncViews={syncViews}
          onReviewConflict={setConflictTreeId}
          onRetrySync={(id) => void driveSync.retry(id).catch(showError)}
          driveFiles={driveWorkspace.files}
          driveLoading={driveWorkspace.loading}
          driveError={driveWorkspace.error}
          driveConnected={driveWorkspace.connection === 'connected'}
          onRetryDrive={() => void driveWorkspace.retry()}
          onRestoreDrive={loadDrive}
          driveControls={
            driveConfigured && (
              <div className="workspace-drive-controls">
                <span role="status">
                  {driveWorkspace.connection === 'connected'
                    ? 'Google Drive connected'
                    : driveWorkspace.connection === 'restoring'
                      ? 'Restoring Google Drive connection…'
                      : driveWorkspace.connection === 'connecting'
                        ? 'Connecting Google Drive…'
                        : driveWorkspace.connection === 'disconnecting'
                          ? 'Disconnecting Google Drive…'
                          : 'Google Drive disconnected'}
                </span>
                {driveWorkspace.connection === 'connected' ? (
                  <button className="button outline" disabled={driveBusy} onClick={forgetDrive}>
                    Disconnect Drive
                  </button>
                ) : (
                  <button
                    className="button outline"
                    disabled={driveBusy || !driveReady}
                    onClick={() => void driveWorkspace.connect()}
                  >
                    Connect Drive
                  </button>
                )}
              </div>
            )
          }
          importBusy={imports.feedback.status === 'pending'}
          driveBusy={driveBusy}
          onRetryLibrary={() => {
            setLibraryState('loading');
            setNotice('');
            void refreshLibrary();
          }}
          duplicatingTreeId={duplicatingTreeId}
          onDuplicateTree={duplicate}
          onCreateTree={createTree}
          onImportTree={() => fileInput.current?.click()}
          onOpenTree={openTree}
          onRenameTree={rename}
          onRemoveTree={removeTree}
        />
      ) : (
        <div className="app-shell">
          <header className="editor-header">
            <div className="editor-header-left">
              <button
                className="icon-button back-button"
                aria-label="Back to trees"
                onClick={leaveEditor}
              >
                <ArrowLeft size={20} />
              </button>
              <BrandMark small />
              <div className="tree-heading">
                <button
                  className="tree-title"
                  onClick={() => tree && rename(tree)}
                  title="Rename tree"
                >
                  <span className="tree-title-name">{tree?.name}</span>
                  <ChevronDown size={14} />
                </button>
                <div
                  className={`save-status ${hasInvalidDateDraft ? 'error' : saveState}`}
                  role="status"
                >
                  {saveState === 'saved' && !hasInvalidDateDraft && <Check size={12} />}{' '}
                  {localStatus}
                </div>
              </div>
            </div>
            <div className="editor-header-actions">
              {tree && (
                <HeaderPersonSearch key={tree.id} people={tree.people} onJump={jumpToPerson} />
              )}
              <button
                className="button header-button"
                disabled={exports.feedback.status === 'pending'}
                aria-label="Export JSON"
                onClick={downloadJson}
                title="Download editable backup"
              >
                <Download size={16} />
                <span>JSON</span>
              </button>
              <button
                className="button header-button"
                disabled={exports.feedback.status === 'pending'}
                aria-label="Export PNG"
                onClick={() => exports.run('PNG')}
                title="Download image"
              >
                <FileImage size={16} />
                <span>PNG</span>
              </button>
              <div className="drive-menu">
                <button
                  className="button header-button"
                  disabled={driveBusy || !driveReady || !driveConfigured}
                  title={
                    driveConfigured
                      ? 'Google Drive options'
                      : 'Set VITE_GOOGLE_CLIENT_ID to enable Google Drive'
                  }
                  onClick={() => void doDrive()}
                  aria-disabled={restoreWarnings.length > 0}
                >
                  Save to Drive
                </button>
                <button
                  className="button mobile-drive-button"
                  onClick={() => setDriveActionsOpen(true)}
                >
                  Drive
                </button>
                {!driveConfigured && (
                  <button
                    className="icon-button drive-config-help"
                    aria-label="Why Google Drive is unavailable"
                    onClick={() => setDriveActionsOpen(true)}
                  >
                    <CircleHelp size={17} />
                  </button>
                )}
              </div>
              <button
                className="icon-button sidebar-toggle"
                aria-label={sidebarIsCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                title={sidebarIsCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                aria-expanded={!sidebarIsCollapsed}
                aria-controls="details-panel"
                onClick={() => {
                  setSidebarCollapsed(!sidebarIsCollapsed);
                  setSidebarRevealedBySelection(false);
                }}
              >
                {sidebarIsCollapsed ? (
                  <PanelRightOpen size={19} aria-hidden="true" />
                ) : (
                  <PanelRightClose size={19} aria-hidden="true" />
                )}
              </button>
              <button
                className="icon-button mobile-menu"
                aria-label={mobilePanelIsOpen ? 'Close details' : 'Open details'}
                title={mobilePanelIsOpen ? 'Close details' : 'Open details'}
                aria-expanded={mobilePanelIsOpen}
                aria-controls="details-panel"
                onClick={() => {
                  setMobilePanel(!mobilePanelIsOpen);
                  setSidebarRevealedBySelection(false);
                }}
              >
                {mobilePanelIsOpen ? <X size={19} /> : <Menu size={19} />}
              </button>
            </div>
          </header>
          <div className="editor-drive-status">
            <DriveSyncStatus
              view={tree ? syncViews[tree.id] : undefined}
              onReview={() => setConflictTreeId(tree?.id || null)}
              onRetry={() => {
                if (tree) void driveSync.retry(tree.id).catch(showError);
              }}
            />
          </div>
          {restoreWarnings.length > 0 && (
            <div className="export-feedback" role="alert">
              <p>
                Incomplete Drive copy: portraits could not be restored for{' '}
                {restoreWarnings.map((warning) => warning.name || warning.personId).join(', ')}.{' '}
                Overwriting the original backup is blocked. Duplicate local edits for safekeeping,
                delete the linked local copy, and reopen the remaining Drive card to download again,
                then choose Save to Drive on a Workspace duplicate if you want a separate backup.
              </p>
            </div>
          )}
          <div className={`editor-layout ${sidebarIsCollapsed ? 'sidebar-collapsed' : ''}`}>
            <div className="canvas-wrap" ref={canvasRef}>
              <div className="canvas-topbar">
                <div className="canvas-label">
                  <span className="canvas-label-dot" /> FAMILY CANVAS
                  {home && (
                    <span className="canvas-home" title={`Home: ${home.name || 'Unnamed person'}`}>
                      <Home size={13} aria-hidden="true" />
                      <span>Home: {home.name || 'Unnamed person'}</span>
                    </span>
                  )}
                </div>
                <div className="canvas-tools">
                  <button
                    className="icon-button"
                    onClick={undo}
                    disabled={!history.current.length}
                    title="Undo"
                    aria-label="Undo"
                  >
                    <Undo2 size={18} />
                  </button>
                  <button
                    className="icon-button"
                    onClick={redo}
                    disabled={!future.current.length}
                    title="Redo"
                    aria-label="Redo"
                  >
                    <Redo2 size={18} />
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    disabled={!home}
                    aria-label="Center on home person"
                    aria-describedby={!home ? 'center-home-help' : undefined}
                    title={
                      home
                        ? `Center on ${home.name || 'home person'}`
                        : 'Set a home person in person details to center on them'
                    }
                    onClick={() => {
                      const id = treeRef.current?.homePersonId;
                      if (id) centerPerson(id);
                    }}
                  >
                    <Home size={18} aria-hidden="true" />
                  </button>
                  {!home && (
                    <span id="center-home-help" className="sr-only">
                      Set a home person in person details to center on them.
                    </span>
                  )}
                  <button
                    className="button subtle"
                    onClick={() =>
                      flowRef.current?.fitView({
                        padding: 0.25,
                        maxZoom: 1.1,
                        duration: 500,
                      })
                    }
                  >
                    Fit tree
                  </button>
                </div>
              </div>
              {tree && (
                <ReactFlow
                  nodes={nodes}
                  edges={edges}
                  nodeTypes={nodeTypes}
                  edgeTypes={edgeTypes}
                  colorMode="dark"
                  connectionMode={ConnectionMode.Loose}
                  onNodesChange={onNodesChange}
                  onConnect={connect}
                  onNodeDragStart={() => {
                    movingRef.current = true;
                  }}
                  onNodeDragStop={(_, node, movedNodes) =>
                    saveMovedNodes(movedNodes.length ? movedNodes : [node])
                  }
                  onSelectionDragStart={() => {
                    movingRef.current = true;
                  }}
                  onSelectionDragStop={(_, movedNodes) => saveMovedNodes(movedNodes)}
                  onMoveEnd={onViewportEnd}
                  onInit={(instance) => {
                    flowRef.current = instance;
                  }}
                  onEdgeClick={(_, edge) => {
                    if (edge.type === 'family') {
                      if (!edge.data?.childId) return;
                      selectPerson(String(edge.data.childId));
                      return;
                    }
                    setSelectedRelationId(edge.id);
                    setSelectedId(null);
                    setSidebarRevealedBySelection(true);
                  }}
                  onPaneClick={() => {
                    setSelectedId(null);
                    setSelectedRelationId(null);
                  }}
                  defaultViewport={tree.viewport}
                  minZoom={0.05}
                  maxZoom={2}
                  fitView={fitViewOnOpen.current}
                  fitViewOptions={{ padding: 0.25, maxZoom: 1.1 }}
                  nodesDraggable
                  elementsSelectable
                  multiSelectionKeyCode={['Shift', 'Meta', 'Control']}
                  selectionOnDrag={false}
                  deleteKeyCode={null}
                  proOptions={{ hideAttribution: false }}
                >
                  <Background color="var(--border)" gap={24} size={1} />
                  <Controls position="bottom-left" showInteractive={false} />
                </ReactFlow>
              )}
              {!tree?.people.length && (
                <div className="canvas-empty">
                  <div className="empty-symbol">✳</div>
                  <h2>Start with someone you know.</h2>
                  <p>
                    Every family tree begins with one person. You can always add more branches
                    later.
                  </p>
                  <button className="button primary" onClick={() => addPerson()}>
                    Add first person <ArrowRight size={16} />
                  </button>
                </div>
              )}
              <button className="floating-add" data-dialog-fallback onClick={() => addPerson()}>
                <Plus size={19} /> Add person
              </button>
              <div className="canvas-tip">
                <CircleHelp size={15} /> Drag cards to arrange · connect handles to link relatives
              </div>
            </div>
            <aside
              id="details-panel"
              aria-label="Tree details"
              className={`details-panel ${mobilePanelIsOpen ? 'open' : ''}`}
            >
              {selected ? (
                <PersonEditor
                  key={`${tree!.id}-${selected.id}`}
                  person={selected}
                  home={home}
                  kinship={kinships.get(selected.id)}
                  onSetHome={(id) => apply((t) => setHomePerson(t, id))}
                  dates={dateDrafts[selected.id] || selected}
                  onDatesChange={(changes) => editLifeDates(selected.id, changes)}
                  relations={tree!.relations}
                  people={tree!.people}
                  onChange={(p) => apply((t) => updatePerson(t, p))}
                  onPortraitChange={(portrait) => {
                    const current = treeRef.current;
                    if (current?.id !== tree!.id || selectedId !== selected.id) return;
                    apply((t) => {
                      const person = t.people.find((p) => p.id === selected.id);
                      return person ? updatePerson(t, { ...person, portrait }) : t;
                    });
                  }}
                  onDelete={() => deletePerson(selected.id)}
                  onAddRelative={addPerson}
                  connectMode={connectMode}
                  setConnectMode={setConnectMode}
                  onConnectTo={connectFromPanel}
                  onRemoveRelation={(id) =>
                    apply((t) => ({
                      ...t,
                      relations: t.relations.filter((r) => r.id !== id),
                    }))
                  }
                  onUpdateRelation={(relation) => apply((t) => updateRelation(t, relation))}
                  onClose={() => {
                    setSelectedId(null);
                  }}
                />
              ) : selectedRelation ? (
                <RelationshipEditor
                  relation={selectedRelation}
                  people={tree!.people}
                  onChange={(relation) => apply((t) => updateRelation(t, relation))}
                  onDelete={() => {
                    apply((t) => ({
                      ...t,
                      relations: t.relations.filter((r) => r.id !== selectedRelation.id),
                    }));
                    setSelectedRelationId(null);
                  }}
                  onClose={() => setSelectedRelationId(null)}
                />
              ) : (
                <div className="panel-welcome">
                  <div className="panel-welcome-icon">
                    <Heart size={26} />
                  </div>
                  <p className="eyebrow">YOUR FAMILY TREE</p>
                  <h2>Stories take shape together.</h2>
                  <p>Select a person to add details, photos, and relationships.</p>
                  <button className="button primary" onClick={() => addPerson()}>
                    <Plus size={16} /> Add a person
                  </button>
                  <div className="panel-hint">
                    <span>TIP</span> Top and bottom handles connect parents and children. Side
                    handles connect partners. Other connections can be assigned a relationship
                    later.
                  </div>
                </div>
              )}
            </aside>
          </div>
          <div className="editor-footer">
            <span>
              {saveState === 'draft' ? 'Temporary tree' : 'Stored in this browser'} ·{' '}
              <button disabled={exports.feedback.status === 'pending'} onClick={downloadJson}>
                Download a backup
              </button>
            </span>
            <span>
              {tree?.people.length || 0} people · {tree?.relations.length || 0} connections
            </span>
          </div>
        </div>
      )}
      {conflictTreeId && syncViews[conflictTreeId]?.conflict && (
        <DriveConflictDialog
          name={library.find((item) => item.id === conflictTreeId)?.name || 'Family tree'}
          conflict={syncViews[conflictTreeId].conflict!}
          onClose={() => setConflictTreeId(null)}
          onResolve={async (action, reviewed) => {
            await saveNow(true);
            if (action === 'local') {
              const result = await driveSync.manualSave(conflictTreeId, undefined, reviewed);
              await refreshLibrary();
              return !!result;
            }
            const replacement = await driveSync.useDrive(conflictTreeId, reviewed);
            if (replacement && treeRef.current?.id === replacement.id) {
              treeRef.current = replacement;
              await openTree(replacement.id);
            }
            await refreshLibrary();
            return !!replacement;
          }}
        />
      )}
      {treeAction && (
        <TreeActionDialog
          action={treeAction}
          onSubmit={submitTreeAction}
          onClose={() => setTreeAction(null)}
        />
      )}
      {deletion.action && (
        <WorkspaceDeletionDialog
          action={deletion.action}
          driveConnected={driveWorkspace.connection === 'connected'}
          onSubmit={deletion.submit}
          onClose={deletion.close}
        />
      )}
      <div className="toast-stack">
        {notice && (
          <div className="toast" role="alert">
            <span>{notice}</span>
            <button aria-label="Dismiss message" onClick={() => setNotice('')}>
              <X size={16} />
            </button>
          </div>
        )}
        <OperationFeedback
          presentation="toast"
          autoDismissMs={5000}
          state={exports.feedback.status === 'pending' ? { status: 'idle' } : exports.feedback}
          onDismiss={exports.dismiss}
          action={
            exports.feedback.status === 'error'
              ? { label: 'Retry', onClick: exports.retry }
              : undefined
          }
        />
        <OperationFeedback
          presentation="toast"
          state={imports.feedback}
          onDismiss={imports.dismiss}
          action={
            imports.feedback.status === 'success' && imports.importedId
              ? {
                  label: 'Open tree',
                  onClick: () => {
                    void openTree(imports.importedId!);
                    imports.dismiss();
                  },
                }
              : imports.feedback.status === 'error'
                ? {
                    label: imports.canRetry ? 'Retry' : 'Choose another file',
                    onClick: () =>
                      imports.canRetry ? void imports.run() : fileInput.current?.click(),
                  }
                : undefined
          }
        />
      </div>
      {driveBusy && !deletion.action && (
        <div className="export-feedback" role="status" aria-live="polite">
          {photoProgress
            ? `${photoProgress.direction === 'upload' ? 'Uploading' : 'Downloading'} photos: ${photoProgress.completed} of ${photoProgress.total}`
            : 'Connecting to Google Drive…'}
        </div>
      )}
      {driveActionsOpen && (
        <DriveActionsDialog
          configured={driveConfigured}
          canDisconnect={
            driveWorkspace.connection === 'connected' || driveWorkspace.connection === 'error'
          }
          busy={driveBusy || !driveReady}
          onAction={doDrive}
          onDisconnect={forgetDrive}
          onClose={() => setDriveActionsOpen(false)}
        />
      )}
    </>
  );
}
