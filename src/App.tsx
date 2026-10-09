import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  Search,
  Undo2,
  X,
} from 'lucide-react';
import { PersonCard, type PersonNode } from './PersonCard';
import { BrandMark } from './BrandMark';
import { PersonEditor, type ConnectMode } from './PersonEditor';
import { RelationshipEditor } from './RelationshipEditor';
import { HomeScreen } from './HomeScreen';
import { DriveActionsDialog } from './DriveActionsDialog';
import { DriveTreeDialog } from './DriveTreeDialog';
import { HeaderPersonSearch } from './HeaderPersonSearch';
import { TreeActionDialog, type TreeAction } from './TreeActionDialog';
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
  personLifeStatus,
  removePerson,
  setHomePerson,
  relationFromConnection,
  updateRelation,
  uid,
  type HandleSide,
  type LifeDates,
  type Relation,
  type Tree,
} from './model';
import {
  deleteDriveLink,
  deleteTree,
  duplicateSavedTree,
  getDriveLink,
  getTree,
  listTrees,
  saveDriveLink,
  saveTree,
} from './storage';
import {
  authorizeDrive,
  disconnectDrive,
  driveConfigured,
  listDriveTrees,
  openDriveTree,
  saveDriveTree,
  type DriveFile,
} from './drive';

const nodeTypes = { person: PersonCard };
const edgeTypes = { relationship: RelationshipEdge, family: FamilyEdge };
const cloneTree = (tree: Tree): Tree => structuredClone(tree);
type SaveState = 'draft' | 'saved' | 'saving' | 'error';

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
  const [driveSavedAt, setDriveSavedAt] = useState('');
  const [driveFiles, setDriveFiles] = useState<DriveFile[] | null>(null);
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
    treeRef = useRef<Tree | null>(null),
    draftTree = useRef(false),
    saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    saveCounter = useRef(0),
    saveQueue = useRef<Promise<unknown>>(Promise.resolve()),
    fileInput = useRef<HTMLInputElement>(null),
    flowRef = useRef<ReactFlowInstance<PersonNode> | null>(null),
    canvasRef = useRef<HTMLDivElement>(null),
    fitViewOnOpen = useRef(false),
    movingRef = useRef(false);
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
    try {
      setLibrary((await listTrees()).sort((a, b) => b.updatedAt - a.updatedAt));
      setLibraryState('ready');
      return true;
    } catch (error) {
      setLibraryState((previous) => (previous === 'ready' ? previous : 'error'));
      showError(error);
      return false;
    }
  }, [showError]);
  useEffect(() => {
    refreshLibrary();
  }, [refreshLibrary]);
  const queueSave = useCallback((value: Tree) => {
    const queued = saveQueue.current.catch(() => undefined).then(() => saveTree(value));
    saveQueue.current = queued;
    return queued;
  }, []);
  const commit = useCallback(
    (next: Tree, record = true, persist = true) => {
      const previous = treeRef.current;
      if (next === previous) return;
      if (record && previous) {
        history.current.push(cloneTree(previous));
        if (history.current.length > 50) history.current.shift();
        future.current = [];
      }
      const updated = {
        ...next,
        version: 2 as const,
        updatedAt: persist ? Date.now() : next.updatedAt,
      };
      treeRef.current = updated;
      setTree(updated);
      // Viewport updates do not turn an untouched new tree into a saved tree.
      if (record) draftTree.current = false;
      if (draftTree.current) return;
      if (!persist) {
        setSaveState('saved');
        return;
      }
      setSaveState('saving');
      if (saveTimer.current) clearTimeout(saveTimer.current);
      const count = ++saveCounter.current;
      saveTimer.current = setTimeout(async () => {
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
      }, 450);
    },
    [queueSave, refreshLibrary, showError],
  );
  const openTree = async (id: string, draft?: Tree) => {
    try {
      if (saveTimer.current && treeRef.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
        await queueSave(treeRef.current);
      }
      await saveQueue.current;
      const found = draft || (await getTree(id));
      if (!found) throw Error('This tree was not found.');
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
      const link = draft ? undefined : await getDriveLink(id);
      setDriveFile(link ? { id: link.id, name: link.name, modifiedTime: link.modifiedTime } : null);
      setDriveSavedAt('');
      setScreen('editor');
      setSaveState(draft ? 'draft' : 'saved');
      setNotice('');
    } catch (error) {
      showError(error);
    }
  };
  const createTree = async () => {
    const newTree = makeTree('My family tree');
    await openTree(newTree.id, newTree);
  };
  const apply = useCallback(
    (update: (current: Tree) => Tree, record = true) => {
      if (!treeRef.current) return;
      try {
        commit(update(treeRef.current), record);
        setNotice('');
      } catch (error) {
        showError(error);
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
        lifeStatus: personLifeStatus(current) || undefined,
      }),
      ...changes,
    };
    setDateDrafts((previous) => {
      const next = { ...previous };
      if (lifeDatesError(dates)) next[personId] = dates;
      else delete next[personId];
      return next;
    });
    if (!lifeDatesError(dates))
      apply((t) => ({
        ...t,
        people: t.people.map((p) => (p.id === personId ? { ...p, ...dates } : p)),
      }));
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
    commit(next);
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
    const previous = history.current.pop();
    if (!previous || !treeRef.current) return;
    future.current.push(cloneTree(treeRef.current));
    setDateDrafts({});
    commit(previous, false);
  };
  const redo = () => {
    const next = future.current.pop();
    if (!next || !treeRef.current) return;
    history.current.push(cloneTree(treeRef.current));
    setDateDrafts({});
    commit(next, false);
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
  const saveNow = async () => {
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
    }
  };
  const doDrive = async (action: 'save' | 'copy' | 'open') => {
    if (!treeRef.current && action !== 'open') return;
    setDriveBusy(true);
    try {
      await authorizeDrive();
      if (action === 'open') {
        setDriveFiles(await listDriveTrees());
        return;
      }
      if (
        action === 'save' &&
        driveFile &&
        !window.confirm(`Replace "${driveFile.name}" in Google Drive with the current tree?`)
      )
        return;
      const file = await saveDriveTree(
        treeRef.current!,
        action === 'save' ? driveFile?.id : undefined,
      );
      setDriveFile(file);
      setDriveSavedAt(
        new Date().toLocaleTimeString([], {
          hour: 'numeric',
          minute: '2-digit',
        }),
      );
      try {
        await saveDriveLink({ treeId: treeRef.current!.id, ...file });
        setNotice(`Saved to Google Drive as ${file.name}.`);
      } catch {
        setNotice(
          `Saved to Google Drive as ${file.name}, but this browser could not remember the file link. Use Open from Drive next time.`,
        );
      }
    } catch (error) {
      showError(error);
    } finally {
      setDriveBusy(false);
    }
  };
  const loadDrive = async (file: DriveFile) => {
    setDriveBusy(true);
    try {
      await authorizeDrive();
      const imported = await openDriveTree(file.id);
      const copy = {
        ...imported,
        id: uid(),
        name: imported.name,
        updatedAt: Date.now(),
      };
      await saveTree(copy);
      await saveDriveLink({ treeId: copy.id, ...file });
      await refreshLibrary();
      await openTree(copy.id);
      setDriveFile(file);
      setDriveSavedAt('');
      setDriveFiles(null);
      setNotice('Opened a local working copy. Save to Drive when ready.');
    } catch (error) {
      showError(error);
    } finally {
      setDriveBusy(false);
    }
  };
  const rename = (item: Tree) =>
    setTreeAction({ kind: 'rename', treeId: item.id, name: item.name });
  const duplicate = async (item: Tree) => {
    if (duplicateBusy.current) return;
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
  const removeTree = (item: Tree) =>
    setTreeAction({ kind: 'delete-tree', treeId: item.id, name: item.name });
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
      commit(removePerson(current, action.personId));
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
      const current =
        treeRef.current?.id === action.treeId ? treeRef.current : await getTree(action.treeId);
      if (!current) throw Error('This tree was not found.');
      if (name !== current.name) {
        const updated = { ...current, name, updatedAt: Date.now() };
        try {
          await queueSave(updated);
        } catch (error) {
          if (treeRef.current?.id === action.treeId) setSaveState('error');
          throw error;
        }
        if (treeRef.current?.id === action.treeId) commit(updated, true, false);
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
    await deleteTree(action.treeId);
    setLibrary((previous) => previous.filter((item) => item.id !== action.treeId));
    if (treeRef.current?.id === action.treeId) {
      treeRef.current = null;
      setTree(null);
      setScreen('home');
    }
    await deleteDriveLink(action.treeId);
  };
  const leaveEditor = async () => {
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
    if (next !== current) apply(() => next);
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
    commit({ ...current, viewport }, false);
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
          importBusy={imports.feedback.status === 'pending'}
          importFeedback={
            <OperationFeedback
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
          }
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
              <span className="drive-status">
                {driveSavedAt ? `Drive saved ${driveSavedAt}` : 'Drive not saved'}
              </span>
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
                  disabled={driveBusy || !driveConfigured}
                  title={
                    driveConfigured
                      ? 'Google Drive options'
                      : 'Set VITE_GOOGLE_CLIENT_ID to enable Google Drive'
                  }
                  onClick={() => doDrive('save')}
                >
                  Save to Drive
                </button>
                <button
                  className="icon-button"
                  disabled={driveBusy || !driveConfigured}
                  aria-label="Save a copy to Google Drive"
                  title="Save a copy to Drive"
                  onClick={() => doDrive('copy')}
                >
                  <Plus size={18} />
                </button>
                <button
                  className="icon-button"
                  disabled={driveBusy || !driveConfigured}
                  aria-label="Open from Google Drive"
                  title="Open from Drive"
                  onClick={() => doDrive('open')}
                >
                  <Search size={18} />
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
          {exports.feedback.status !== 'idle' && (
            <div className="export-feedback">
              <OperationFeedback
                state={exports.feedback}
                onDismiss={exports.dismiss}
                action={
                  exports.feedback.status === 'error'
                    ? { label: 'Retry', onClick: exports.retry }
                    : undefined
                }
              />
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
                  onChange={(p) =>
                    apply((t) => ({
                      ...t,
                      people: t.people.map((old) => (old.id === p.id ? p : old)),
                    }))
                  }
                  onPortraitChange={(portrait) => {
                    const current = treeRef.current;
                    if (current?.id !== tree!.id || selectedId !== selected.id) return;
                    apply((t) => ({
                      ...t,
                      people: t.people.map((person) =>
                        person.id === selected.id ? { ...person, portrait } : person,
                      ),
                    }));
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
      {treeAction && (
        <TreeActionDialog
          action={treeAction}
          onSubmit={submitTreeAction}
          onClose={() => setTreeAction(null)}
        />
      )}
      {notice && (
        <div className="toast" role="alert">
          <span>{notice}</span>
          <button aria-label="Dismiss message" onClick={() => setNotice('')}>
            <X size={16} />
          </button>
        </div>
      )}
      {driveActionsOpen && (
        <DriveActionsDialog
          configured={driveConfigured}
          busy={driveBusy}
          onAction={doDrive}
          onDisconnect={() => {
            disconnectDrive();
            setDriveFile(null);
            setDriveSavedAt('');
            setDriveActionsOpen(false);
            setNotice(
              'Disconnected Google Drive for this session. Your local tree is still saved.',
            );
          }}
          onClose={() => setDriveActionsOpen(false)}
        />
      )}{' '}
      {driveFiles && (
        <DriveTreeDialog
          files={driveFiles}
          busy={driveBusy}
          onOpen={loadDrive}
          onClose={() => setDriveFiles(null)}
        />
      )}
    </>
  );
}
