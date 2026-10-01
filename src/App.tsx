import { useCallback, useEffect, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  ConnectionMode,
  Controls,
  Handle,
  MarkerType,
  Position,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
  useEdgesState,
  useNodesState,
} from "@xyflow/react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  CircleHelp,
  Download,
  FileImage,
  Heart,
  ImagePlus,
  Link2,
  Menu,
  Plus,
  Redo2,
  Search,
  ShieldCheck,
  Trash2,
  Undo2,
  Upload,
  Users,
  X,
} from "lucide-react";
import { BrandMark } from "./BrandMark";
import { SexIcon } from "./SexIcon";
import { RelationshipFields } from "./RelationshipFields";
import { RelationshipEdge } from "./RelationshipEdge";
import {
  addRelation,
  dateYearLabel,
  lifeDatesError,
  makePerson,
  makeTree,
  personAgeLabel,
  relationLabel,
  relationFromConnection,
  updateRelation,
  uid,
  validateTree,
  type DateValue,
  type HandleSide,
  type LifeDates,
  type Person,
  type Relation,
  type Tree,
} from "./model";
import {
  deleteDriveLink,
  deleteTree,
  getDriveLink,
  getTree,
  listTrees,
  saveDriveLink,
  saveTree,
} from "./storage";
import { exportJson, exportPng, portraitData } from "./media";
import {
  authorizeDrive,
  disconnectDrive,
  driveConfigured,
  listDriveTrees,
  openDriveTree,
  saveDriveTree,
  type DriveFile,
} from "./drive";

type PersonNode = Node<
  { person: Person; selected: boolean; onSelect: (id: string) => void },
  "person"
>;
function PersonCard({ data }: NodeProps<PersonNode>) {
  const p = data.person;
  const age = personAgeLabel(p);
  return (
    <div
      className={`person-card ${data.selected ? "selected" : ""}`}
      onClick={() => data.onSelect(p.id)}
      role="button"
      tabIndex={0}
      aria-label={`Edit ${p.name || "unnamed person"}`}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          data.onSelect(p.id);
        }
      }}
    >
      <Handle
        id="top"
        type="source"
        position={Position.Top}
        className="family-handle"
        title="Parent or child connection"
      />
      <Handle
        id="bottom"
        type="source"
        position={Position.Bottom}
        className="family-handle"
        title="Parent or child connection"
      />
      <Handle
        id="left"
        type="source"
        position={Position.Left}
        className="family-handle partner-handle"
        title="Partner connection"
      />
      <Handle
        id="right"
        type="source"
        position={Position.Right}
        className="family-handle partner-handle"
        title="Partner connection"
      />
      <div className="person-avatar">
        {p.portrait ? (
          <img src={p.portrait} alt="" />
        ) : (
          <span>{(p.name[0] || "?").toUpperCase()}</span>
        )}
      </div>
      <div className="person-info">
        <strong>{p.name || "Unnamed person"}</strong>
        {p.nickname && <small>“{p.nickname}”</small>}
        <span>
          {dateYearLabel(p.born) || "?"}{" "}
          {p.died.precision !== "unknown" ? `— ${dateYearLabel(p.died)}` : ""}
        </span>
        {age && <span className="person-age">{age}</span>}
      </div>
      {(p.sex === "male" || p.sex === "female") && (
        <span
          className="person-sex"
          role="img"
          aria-label={p.sex === "male" ? "Male" : "Female"}
          title={p.sex === "male" ? "Male" : "Female"}
        >
          <SexIcon sex={p.sex} size={16} />
        </span>
      )}
    </div>
  );
}
const nodeTypes = { person: PersonCard };
const edgeTypes = { relationship: RelationshipEdge };
const cloneTree = (tree: Tree): Tree => structuredClone(tree);
type SaveState = "saved" | "saving" | "error";
type ConnectMode = "parent" | "child" | "partner" | null;
function DateInput({
  label,
  value,
  onChange,
  invalid = false,
  errorId,
}: {
  label: string;
  value: DateValue;
  onChange: (value: DateValue) => void;
  invalid?: boolean;
  errorId?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const savedValue =
    value.precision === "full"
      ? value.value
      : value.precision === "year"
        ? Number.isFinite(value.year)
          ? String(value.year)
          : ""
        : "";
  useEffect(() => {
    if (input.current && document.activeElement !== input.current)
      input.current.value = savedValue;
  }, [savedValue, value.precision]);
  return (
    <div className="date-field">
      <label>
        {label}
        <select
          value={value.precision}
          onChange={(e) =>
            onChange(
              e.target.value === "year"
                ? { precision: "year", year: new Date().getFullYear() }
                : e.target.value === "full"
                  ? { precision: "full", value: "2000-01-01" }
                  : { precision: "unknown" },
            )
          }
        >
          <option value="unknown">Unknown</option>
          <option value="year">Year only</option>
          <option value="full">Full date</option>
        </select>
      </label>
      {value.precision === "year" && (
        <input
          ref={input}
          type="number"
          aria-label={`${label} year`}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? errorId : undefined}
          min="1"
          max="9999"
          defaultValue={Number.isFinite(value.year) ? value.year : ""}
          onChange={(e) => {
            onChange({
              precision: "year",
              year: e.currentTarget.valueAsNumber,
            });
          }}
        />
      )}
      {value.precision === "full" && (
        <input
          ref={input}
          type="date"
          min="0001-01-01"
          max="9999-12-31"
          aria-label={`${label} date`}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? errorId : undefined}
          defaultValue={value.value}
          onChange={(e) => {
            onChange({ precision: "full", value: e.currentTarget.value });
          }}
        />
      )}
    </div>
  );
}
function PersonEditor({
  person,
  dates,
  onDatesChange,
  relations,
  people,
  onChange,
  onDelete,
  onAddRelative,
  connectMode,
  setConnectMode,
  onConnectTo,
  onRemoveRelation,
  onUpdateRelation,
  onClose,
}: {
  person: Person;
  dates: LifeDates;
  onDatesChange: (field: "born" | "died", date: DateValue) => void;
  relations: Relation[];
  people: Person[];
  onChange: (p: Person) => void;
  onDelete: () => void;
  onAddRelative: (type: Exclude<ConnectMode, null>) => void;
  connectMode: ConnectMode;
  setConnectMode: (mode: ConnectMode) => void;
  onConnectTo: (targetId: string) => void;
  onRemoveRelation: (id: string) => void;
  onUpdateRelation: (relation: Relation) => void;
  onClose: () => void;
}) {
  const portraitInput = useRef<HTMLInputElement>(null);
  const dateError = lifeDatesError(dates);
  const dateErrorId = `date-error-${person.id}`;
  const attached = relations.filter((r) =>
    r.type === "parent"
      ? r.parentId === person.id || r.childId === person.id
      : r.personA === person.id || r.personB === person.id,
  );
  const other = (r: Relation) =>
    people.find(
      (p) =>
        p.id ===
        (r.type === "parent"
          ? r.parentId === person.id
            ? r.childId
            : r.parentId
          : r.personA === person.id
            ? r.personB
            : r.personA),
    )?.name || "Unknown";
  return (
    <div className="editor-content">
      <div className="panel-title">
        <div>
          <p className="eyebrow">PERSON DETAILS</p>
          <h2>{person.name || "Unnamed person"}</h2>
        </div>
        <button
          className="icon-button"
          aria-label="Close details"
          onClick={onClose}
        >
          <X size={19} />
        </button>
      </div>
      <div className="portrait-upload">
        <button
          type="button"
          className="portrait-preview"
          aria-label={person.portrait ? "Change photo" : "Add photo"}
          title={person.portrait ? "Change photo" : "Add photo"}
          onClick={() => portraitInput.current?.click()}
        >
          {person.portrait ? (
            <img src={person.portrait} alt="Portrait" />
          ) : (
            <span>{(person.name[0] || "?").toUpperCase()}</span>
          )}
          <span className="portrait-upload-icon">
            <ImagePlus size={16} />
          </span>
        </button>
        <div>
          <input
            ref={portraitInput}
            className="sr-only"
            tabIndex={-1}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              e.currentTarget.value = "";
              try {
                onChange({ ...person, portrait: await portraitData(f) });
              } catch (error) {
                alert((error as Error).message);
              }
            }}
          />
          <p className="tiny">JPEG, PNG or WebP · processed locally</p>
          {person.portrait && (
            <button
              className="text-button"
              onClick={() => onChange({ ...person, portrait: null })}
            >
              Remove photo
            </button>
          )}
        </div>
      </div>
      <div className="field-grid">
        <label>
          Full name
          <input
            value={person.name}
            onChange={(e) => onChange({ ...person, name: e.target.value })}
            placeholder="Full name"
          />
        </label>
        <label>
          Nickname
          <input
            value={person.nickname}
            onChange={(e) => onChange({ ...person, nickname: e.target.value })}
            placeholder="Optional"
          />
        </label>
      </div>
      <div className="field-grid">
        <DateInput
          key={`${person.id}-born`}
          label="Born"
          value={dates.born}
          onChange={(born) => onDatesChange("born", born)}
          invalid={!!dateError}
          errorId={dateErrorId}
        />
        <DateInput
          key={`${person.id}-died`}
          label="Died"
          value={dates.died}
          onChange={(died) => onDatesChange("died", died)}
          invalid={!!dateError}
          errorId={dateErrorId}
        />
      </div>
      {dateError && (
        <p className="date-error" id={dateErrorId} role="alert">
          {dateError} These date changes haven’t been saved. Adjust either field
          to continue.
        </p>
      )}
      <fieldset className="sex-field">
        <legend>
          Sex <span className="optional">(optional)</span>
        </legend>
        <div className="sex-options">
          {(["male", "female"] as const).map((sex) => (
            <button
              key={sex}
              type="button"
              aria-pressed={person.sex === sex}
              onClick={() =>
                onChange({ ...person, sex: person.sex === sex ? "" : sex })
              }
            >
              <SexIcon sex={sex} />
              {sex === "male" ? "Male" : "Female"}
            </button>
          ))}
        </div>
        <p className="tiny">
          {person.sex === "other"
            ? "Other recorded. Choose an option to change it."
            : person.sex
              ? "Select again to clear."
              : "Not recorded."}
        </p>
      </fieldset>
      <label>
        Notes
        <textarea
          rows={4}
          value={person.notes}
          onChange={(e) => onChange({ ...person, notes: e.target.value })}
          placeholder="Stories, places, memories…"
        />
      </label>
      <section className="panel-section">
        <div className="section-heading">
          <h3>Relationships</h3>
          <span>{attached.length}</span>
        </div>
        {attached.length ? (
          <div className="relation-list">
            {attached.map((r) => (
              <div className="relation-item" key={r.id}>
                <div>
                  <strong>{other(r)}</strong>
                  <span>{relationLabel(r)}</span>
                </div>
                <button
                  className="icon-button"
                  aria-label={`Remove relationship with ${other(r)}`}
                  title="Remove relationship"
                  onClick={() => onRemoveRelation(r.id)}
                >
                  <X size={16} />
                </button>
                <RelationshipFields
                  relation={r}
                  people={people}
                  referenceId={person.id}
                  onChange={onUpdateRelation}
                />
              </div>
            ))}
          </div>
        ) : (
          <p className="muted">No relationships yet.</p>
        )}
        <div className="relative-actions">
          <button
            className="button subtle"
            onClick={() => onAddRelative("parent")}
          >
            + Parent
          </button>
          <button
            className="button subtle"
            onClick={() => onAddRelative("child")}
          >
            + Child
          </button>
          <button
            className="button subtle"
            onClick={() => onAddRelative("partner")}
          >
            + Partner
          </button>
        </div>
        <div className="connect-box">
          <p>Connect to someone already in this tree</p>
          <div className="field-grid">
            <select
              aria-label="Connection role"
              value={
                connectMode === "partner"
                  ? "partner"
                  : connectMode
                    ? "parent-child"
                    : ""
              }
              onChange={(e) =>
                setConnectMode(
                  e.target.value === "parent-child"
                    ? "child"
                    : e.target.value === "partner"
                      ? "partner"
                      : null,
                )
              }
            >
              <option value="">Choose relationship</option>
              <option value="parent-child">Parent / Child</option>
              <option value="partner">Partner</option>
            </select>
            {(connectMode === "parent" || connectMode === "child") && (
              <label>
                Parent in this connection
                <select
                  aria-label="Parent in new connection"
                  value={connectMode}
                  onChange={(e) =>
                    setConnectMode(e.target.value as ConnectMode)
                  }
                >
                  <option value="child">{person.name || "This person"}</option>
                  <option value="parent">Person being connected</option>
                </select>
              </label>
            )}
            <select
              aria-label="Person to connect"
              disabled={!connectMode}
              defaultValue=""
              onChange={(e) => {
                if (e.target.value) onConnectTo(e.target.value);
                e.target.value = "";
              }}
            >
              <option value="">Choose person…</option>
              {people
                .filter((p) => p.id !== person.id)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </select>
          </div>
        </div>
      </section>
      <button className="button danger" onClick={onDelete}>
        <Trash2 size={16} /> Delete person
      </button>
    </div>
  );
}
export default function App() {
  const [screen, setScreen] = useState<"home" | "editor">("home");
  const [library, setLibrary] = useState<Tree[]>([]);
  const [tree, setTree] = useState<Tree | null>(null);
  const [dateDrafts, setDateDrafts] = useState<Record<string, LifeDates>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedRelationId, setSelectedRelationId] = useState<string | null>(
    null,
  );
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [notice, setNotice] = useState("");
  const [driveFile, setDriveFile] = useState<DriveFile | null>(null);
  const [driveSavedAt, setDriveSavedAt] = useState("");
  const [driveFiles, setDriveFiles] = useState<DriveFile[] | null>(null);
  const [driveBusy, setDriveBusy] = useState(false);
  const [driveActionsOpen, setDriveActionsOpen] = useState(false);
  const [connectMode, setConnectMode] = useState<ConnectMode>(null);
  const [mobilePanel, setMobilePanel] = useState(false);
  const [nodes, setNodes, onNodesChange] = useNodesState<PersonNode>([]);
  const [edges, setEdges] = useEdgesState<Edge>([]);
  const history = useRef<Tree[]>([]),
    future = useRef<Tree[]>([]),
    treeRef = useRef<Tree | null>(null),
    saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    saveCounter = useRef(0),
    saveQueue = useRef<Promise<unknown>>(Promise.resolve()),
    fileInput = useRef<HTMLInputElement>(null),
    flowRef = useRef<any>(null),
    movingRef = useRef(false);
  const showError = (error: unknown) =>
    setNotice(error instanceof Error ? error.message : "Something went wrong.");
  const refreshLibrary = async () => {
    try {
      setLibrary((await listTrees()).sort((a, b) => b.updatedAt - a.updatedAt));
    } catch (error) {
      showError(error);
    }
  };
  useEffect(() => {
    refreshLibrary();
  }, []);
  const queueSave = (value: Tree) => {
    const queued = saveQueue.current
      .catch(() => undefined)
      .then(() => saveTree(value));
    saveQueue.current = queued;
    return queued;
  };
  const commit = useCallback((next: Tree, record = true) => {
    const previous = treeRef.current;
    if (record && previous) {
      history.current.push(cloneTree(previous));
      if (history.current.length > 50) history.current.shift();
      future.current = [];
    }
    const updated = { ...next, version: 2 as const, updatedAt: Date.now() };
    treeRef.current = updated;
    setTree(updated);
    setSaveState("saving");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const count = ++saveCounter.current;
    saveTimer.current = setTimeout(async () => {
      try {
        await queueSave(updated);
        if (count === saveCounter.current) {
          setSaveState("saved");
          refreshLibrary();
        }
      } catch (error) {
        if (count === saveCounter.current) {
          setSaveState("error");
          showError(error);
        }
      }
    }, 450);
  }, []);
  const openTree = async (id: string) => {
    try {
      if (saveTimer.current && treeRef.current) {
        clearTimeout(saveTimer.current);
        await queueSave(treeRef.current);
      }
      await saveQueue.current;
      const found = await getTree(id);
      if (!found) throw Error("This tree was not found.");
      history.current = [];
      future.current = [];
      treeRef.current = found;
      setTree(found);
      setDateDrafts({});
      setSelectedId(null);
      setSelectedRelationId(null);
      const link = await getDriveLink(id);
      setDriveFile(
        link
          ? { id: link.id, name: link.name, modifiedTime: link.modifiedTime }
          : null,
      );
      setDriveSavedAt("");
      setScreen("editor");
      setSaveState("saved");
      setNotice("");
    } catch (error) {
      showError(error);
    }
  };
  const createTree = async () => {
    const newTree = makeTree("My family tree");
    try {
      await saveTree(newTree);
      await refreshLibrary();
      await openTree(newTree.id);
    } catch (error) {
      showError(error);
    }
  };
  const apply = (update: (current: Tree) => Tree, record = true) => {
    if (!treeRef.current) return;
    try {
      commit(update(treeRef.current), record);
      setNotice("");
    } catch (error) {
      showError(error);
    }
  };
  const editDate = (
    personId: string,
    field: "born" | "died",
    value: DateValue,
  ) => {
    const current = treeRef.current?.people.find((p) => p.id === personId);
    if (!current) return;
    const dates = {
      ...(dateDrafts[personId] || { born: current.born, died: current.died }),
      [field]: value,
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
        people: t.people.map((p) =>
          p.id === personId ? { ...p, ...dates } : p,
        ),
      }));
  };
  const addPerson = (relative?: Exclude<ConnectMode, null>) => {
    const current = treeRef.current;
    if (!current) return;
    const selected = current.people.find((p) => p.id === selectedId);
    const shift = (current.people.length % 4) * 30;
    const x = selected
      ? selected.x + (relative === "partner" ? 350 : shift)
      : Math.max(0, ...current.people.map((p) => p.x + 300));
    const y = selected
      ? selected.y +
        (relative === "parent" ? -220 : relative === "child" ? 220 : 0)
      : 0;
    const person = makePerson("", x, y);
    let next = { ...current, people: [...current.people, person] };
    if (selected && relative)
      next = addRelation(
        next,
        relative === "partner"
          ? {
              id: uid(),
              type: "partner",
              personA: selected.id,
              personB: person.id,
              status: "unspecified",
              union: "unspecified",
            }
          : {
              id: uid(),
              type: "parent",
              parentId: relative === "parent" ? person.id : selected.id,
              childId: relative === "child" ? person.id : selected.id,
              kind: "unspecified",
            },
      );
    commit(next);
    setSelectedId(person.id);
    setMobilePanel(true);
    requestAnimationFrame(() =>
      flowRef.current?.setCenter(person.x + 110, person.y + 54, {
        zoom: Math.min(flowRef.current?.getZoom() || 1, 1.1),
        duration: 350,
      }),
    );
  };
  const connect = (connection: Connection) => {
    const a = connection.source,
      b = connection.target;
    if (!a || !b || !connection.sourceHandle || !connection.targetHandle)
      return;
    const sh = connection.sourceHandle.replace("-target", ""),
      th = connection.targetHandle.replace("-target", "");
    const relation = relationFromConnection(
      a,
      b,
      sh as HandleSide,
      th as HandleSide,
    );
    apply((t) => addRelation(t, relation));
  };
  const connectFromPanel = (targetId: string) => {
    if (!selectedId || !connectMode) return;
    const r: Relation =
      connectMode === "partner"
        ? {
            id: uid(),
            type: "partner",
            personA: selectedId,
            personB: targetId,
            status: "unspecified",
            union: "unspecified",
          }
        : {
            id: uid(),
            type: "parent",
            parentId: connectMode === "parent" ? targetId : selectedId,
            childId: connectMode === "child" ? targetId : selectedId,
            kind: "unspecified",
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
      if (
        !(e.ctrlKey || e.metaKey) ||
        !["z", "y"].includes(e.key.toLowerCase())
      )
        return;
      if (
        ["INPUT", "TEXTAREA", "SELECT"].includes(
          (e.target as HTMLElement).tagName,
        )
      )
        return;
      e.preventDefault();
      if (e.key.toLowerCase() === "z" && !e.shiftKey) undo();
      else redo();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  useEffect(() => {
    if (!tree) return;
    setNodes(
      tree.people.map((p) => ({
        id: p.id,
        type: "person",
        position: { x: p.x, y: p.y },
        data: {
          person: p,
          selected: selectedId === p.id,
          onSelect: (id: string) => {
            setSelectedId(id);
            setSelectedRelationId(null);
            setMobilePanel(true);
          },
        },
        draggable: true,
      })),
    );
    setEdges(
      tree.relations.map((r) => ({
        id: r.id,
        source: r.type === "parent" ? r.parentId : r.personA,
        target: r.type === "parent" ? r.childId : r.personB,
        sourceHandle:
          r.type === "parent"
            ? "bottom"
            : r.type === "unassigned"
              ? r.sourceHandle
              : "right",
        targetHandle:
          r.type === "parent"
            ? "top"
            : r.type === "unassigned"
              ? r.targetHandle
              : "left",
        type: "relationship",
        data: { relationshipType: r.type },
        ariaLabel: relationLabel(r),
        label: relationLabel(r),
        markerEnd:
          r.type === "parent"
            ? {
                type: MarkerType.ArrowClosed,
                color: "#958469",
                width: 14,
                height: 14,
              }
            : undefined,
        style: {
          stroke:
            r.type === "parent"
              ? "#958469"
              : r.type === "partner"
                ? "#b8786f"
                : "#92968b",
          strokeWidth: selectedRelationId === r.id ? 3 : 2,
        },
        labelStyle: { fill: "#5b5349", fontSize: 11, fontWeight: 600 },
        labelBgStyle: { fill: "#f7f5ef", fillOpacity: 0.96 },
        selectable: true,
      })),
    );
  }, [tree, selectedId, selectedRelationId, setNodes, setEdges]);
  const selected = tree?.people.find((p) => p.id === selectedId) || null;
  const selectedRelation =
    tree?.relations.find((r) => r.id === selectedRelationId) || null;
  const saveNow = async () => {
    if (!treeRef.current) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const count = ++saveCounter.current;
    try {
      await queueSave(treeRef.current);
      if (count === saveCounter.current) {
        setSaveState("saved");
        refreshLibrary();
      }
    } catch (error) {
      setSaveState("error");
      showError(error);
    }
  };
  const importFile = async (file: File) => {
    try {
      if (file.size > 30_000_000)
        throw Error("Choose a JSON file smaller than 30 MB.");
      const imported = validateTree(JSON.parse(await file.text()));
      const copy = {
        ...imported,
        id: uid(),
        name: `${imported.name} (imported)`,
        updatedAt: Date.now(),
      };
      await saveTree(copy);
      await refreshLibrary();
      await openTree(copy.id);
    } catch (error) {
      showError(error);
    }
  };
  const doDrive = async (action: "save" | "copy" | "open") => {
    if (!treeRef.current && action !== "open") return;
    setDriveBusy(true);
    try {
      await authorizeDrive();
      if (action === "open") {
        setDriveFiles(await listDriveTrees());
        return;
      }
      if (
        action === "save" &&
        driveFile &&
        !window.confirm(
          `Replace “${driveFile.name}” in Google Drive with the current tree?`,
        )
      )
        return;
      const file = await saveDriveTree(
        treeRef.current!,
        action === "save" ? driveFile?.id : undefined,
      );
      setDriveFile(file);
      setDriveSavedAt(
        new Date().toLocaleTimeString([], {
          hour: "numeric",
          minute: "2-digit",
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
      setDriveSavedAt("");
      setDriveFiles(null);
      setNotice("Opened a local working copy. Save to Drive when ready.");
    } catch (error) {
      showError(error);
    } finally {
      setDriveBusy(false);
    }
  };
  const rename = async (item: Tree) => {
    const name = window.prompt("Tree name", item.name)?.trim();
    if (!name || name === item.name) return;
    try {
      const updated = { ...item, name, updatedAt: Date.now() };
      if (treeRef.current?.id === item.id) commit(updated);
      else await saveTree(updated);
      await refreshLibrary();
    } catch (error) {
      showError(error);
    }
  };
  const removeTree = async (item: Tree) => {
    if (
      !window.confirm(
        `Delete “${item.name}” from this browser? Export a backup first if you want to keep it.`,
      )
    )
      return;
    try {
      await deleteTree(item.id);
      await deleteDriveLink(item.id);
      if (treeRef.current?.id === item.id) {
        treeRef.current = null;
        setTree(null);
        setScreen("home");
      }
      await refreshLibrary();
    } catch (error) {
      showError(error);
    }
  };
  const leaveEditor = async () => {
    await saveNow();
    setScreen("home");
    setSelectedId(null);
    setMobilePanel(false);
  };
  const onNodeDragStop = (_: unknown, node: Node) => {
    movingRef.current = false;
    apply((t) => ({
      ...t,
      people: t.people.map((p) =>
        p.id === node.id ? { ...p, x: node.position.x, y: node.position.y } : p,
      ),
    }));
  };
  const onViewportEnd = (
    _: unknown,
    viewport: { x: number; y: number; zoom: number },
  ) => {
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
  const hasInvalidDateDraft = tree?.people.some(
    (p) => !!lifeDatesError(dateDrafts[p.id] || p),
  );
  const downloadJson = () => {
    try {
      if (tree) exportJson(tree);
    } catch (error) {
      showError(error);
    }
  };
  const localStatus =
    hasInvalidDateDraft && saveState !== "error"
      ? "Date edits not saved"
      : saveState === "saved"
        ? "Saved locally"
        : saveState === "saving"
          ? "Saving locally…"
          : "Local save failed · export JSON";
  return (
    <>
      <input
        ref={fileInput}
        className="sr-only"
        type="file"
        accept="application/json,.json"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) importFile(f);
          e.currentTarget.value = "";
        }}
      />
      {screen === "home" ? (
        <div className="home">
          <header className="site-header">
            <div className="brand">
              <BrandMark />
              <span>
                GENEalogical<span className="brand-three">3</span>
              </span>
            </div>
            <nav>
              <a href="#how-it-works">How it works</a>
              <a href="#privacy">Privacy</a>
              <button
                className="button light"
                onClick={() => fileInput.current?.click()}
              >
                <Upload size={15} /> Import a tree
              </button>
            </nav>
          </header>
          <main>
            <div className="hero">
              <div className="hero-copy">
                <div className="eyebrow with-line">A PLACE FOR YOUR PEOPLE</div>
                <h1>
                  Every family has
                  <br />
                  a story worth
                  <br />
                  <em>keeping.</em>
                </h1>
                <p>
                  Gather the names, faces, and connections that make your family
                  yours. Build at your own pace, right here in your browser.
                </p>
                <div className="hero-actions">
                  <button className="button primary large" onClick={createTree}>
                    Start a family tree <ArrowRight size={18} />
                  </button>
                  <span>No account needed. Your story stays yours.</span>
                </div>
              </div>
              <div className="hero-art" aria-hidden="true">
                <div className="hero-leaf leaf-one">✻</div>
                <div className="hero-leaf leaf-two">✻</div>
                <div className="art-line line-one" />
                <div className="art-line line-two" />
                <div className="art-card art-one">
                  <span className="art-avatar sage">E</span>
                  <div>
                    <b>Eleanor</b>
                    <small>1924 — 2008</small>
                  </div>
                </div>
                <div className="art-card art-two">
                  <span className="art-avatar peach">J</span>
                  <div>
                    <b>James</b>
                    <small>1920 — 1996</small>
                  </div>
                </div>
                <div className="art-card art-three">
                  <span className="art-avatar cream">M</span>
                  <div>
                    <b>Margaret</b>
                    <small>1952 —</small>
                  </div>
                </div>
                <div className="art-card art-four">
                  <span className="art-avatar blue">S</span>
                  <div>
                    <b>Samuel</b>
                    <small>1981 —</small>
                  </div>
                </div>
                <div className="art-caption">One connection at a time.</div>
              </div>
            </div>
            <section className="library-section">
              <div className="section-intro">
                <div>
                  <p className="eyebrow">YOUR WORKSPACE</p>
                  <h2>Your family trees</h2>
                </div>
                <button className="button outline" onClick={createTree}>
                  <Plus size={17} /> New tree
                </button>
              </div>
              {library.length ? (
                <div className="tree-grid">
                  {library.map((item) => (
                    <div className="tree-tile" key={item.id}>
                      <button
                        className="tree-open"
                        onClick={() => openTree(item.id)}
                      >
                        <div className="tree-tile-icon">
                          <Users size={27} />
                        </div>
                        <strong>{item.name}</strong>
                        <span>
                          {item.people.length}{" "}
                          {item.people.length === 1 ? "person" : "people"} ·
                          Edited {new Date(item.updatedAt).toLocaleDateString()}
                        </span>
                        <span className="open-cue">
                          Open tree <ArrowRight size={15} />
                        </span>
                      </button>
                      <div className="tree-tile-tools">
                        <button
                          aria-label={`Rename ${item.name}`}
                          title="Rename"
                          onClick={() => rename(item)}
                        >
                          Rename
                        </button>
                        <button
                          aria-label={`Delete ${item.name}`}
                          title="Delete"
                          onClick={() => removeTree(item)}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty-library">
                  <div className="empty-icon">
                    <Users size={31} />
                  </div>
                  <div>
                    <strong>Your first story starts here.</strong>
                    <p>Create a tree to start adding the people who matter.</p>
                  </div>
                  <button className="button primary" onClick={createTree}>
                    Create your first tree <ArrowRight size={16} />
                  </button>
                </div>
              )}
            </section>
            <section id="how-it-works" className="how-section">
              <p className="eyebrow">MADE FOR REAL FAMILIES</p>
              <h2>Simple to start. Yours to keep.</h2>
              <div className="how-grid">
                <div>
                  <span className="how-icon how-icon-peach">
                    <Users size={27} />
                  </span>
                  <h3>Make it yours</h3>
                  <p>
                    Add names, dates, photos, and the little notes that make a
                    person more than a name on a page.
                  </p>
                </div>
                <div>
                  <span className="how-icon how-icon-sage">
                    <Link2 size={27} />
                  </span>
                  <h3>See how you connect</h3>
                  <p>
                    Draw the lines between generations. Move things around until
                    your family story feels right.
                  </p>
                </div>
                <div>
                  <span className="how-icon how-icon-lilac">
                    <Download size={27} />
                  </span>
                  <h3>Save and share</h3>
                  <p>
                    Your tree stays in this browser. Download a JSON backup or
                    export a PNG to share with family.
                  </p>
                </div>
              </div>
            </section>
            <section id="privacy" className="privacy-section">
              <div className="privacy-intro">
                <span className="privacy-icon">
                  <ShieldCheck size={27} />
                </span>
                <div>
                  <p className="eyebrow">YOUR FAMILY STORY STAYS YOURS</p>
                  <h2>
                    Private by default.
                    <br />
                    <span>Clear about every connection.</span>
                  </h2>
                  <p>
                    Your tree is saved in this browser. GENEalogical3 has no
                    account system or app database, so we can’t view or retrieve
                    your family details.
                  </p>
                </div>
              </div>
              <div className="privacy-steps">
                <div className="privacy-card">
                  <div className="privacy-card-heading">
                    <span>01</span>
                    <h3>Your device</h3>
                  </div>
                  <p>
                    Edit people and photos. Autosave keeps the tree in this
                    browser’s storage.
                  </p>
                  <small>
                    <Check size={17} /> GENEalogical3 can’t see it
                  </small>
                </div>
                <div className="privacy-card">
                  <div className="privacy-card-heading">
                    <span>02</span>
                    <h3>Your choice</h3>
                  </div>
                  <p>
                    Export an editable JSON backup or a PNG image, or connect
                    Google Drive when you want a cloud copy.
                  </p>
                  <small>
                    <Check size={17} /> Nothing uploads by default
                  </small>
                </div>
                <div className="privacy-card">
                  <div className="privacy-card-heading">
                    <span>03</span>
                    <h3>Google Drive, if connected</h3>
                  </div>
                  <p>
                    GENEalogical3 sends the tree only when you choose Drive
                    save. Google stores that copy under your account.
                  </p>
                  <small>
                    <ShieldCheck size={17} /> App-created files only
                  </small>
                </div>
              </div>
              <p className="privacy-note">
                <ShieldCheck size={20} /> GENEalogical3 does not store family
                trees, portraits, or profile data on its own servers. Browser
                storage stays on this device; clearing browser data removes that
                local copy.
              </p>
            </section>
          </main>
          <footer>
            <div className="footer-brand">
              <BrandMark small />
              <span>GENEalogical3</span>
            </div>
            <span>Made for the stories that connect us.</span>
          </footer>
        </div>
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
                  {tree?.name} <ChevronDown size={14} />
                </button>
                <div
                  className={`save-status ${hasInvalidDateDraft ? "error" : saveState}`}
                  role="status"
                >
                  {saveState === "saved" && !hasInvalidDateDraft && (
                    <Check size={12} />
                  )}{" "}
                  {localStatus}
                </div>
              </div>
            </div>
            <div className="editor-header-actions">
              <span className="drive-status">
                {driveSavedAt
                  ? `Drive saved ${driveSavedAt}`
                  : "Drive not saved"}
              </span>
              <button
                className="button header-button"
                onClick={downloadJson}
                title="Download editable backup"
              >
                <Download size={16} />
                <span>JSON</span>
              </button>
              <button
                className="button header-button"
                onClick={() => tree && exportPng(tree).catch(showError)}
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
                      ? "Google Drive options"
                      : "Set VITE_GOOGLE_CLIENT_ID to enable Google Drive"
                  }
                  onClick={() => doDrive("save")}
                >
                  Save to Drive
                </button>
                <button
                  className="icon-button"
                  disabled={driveBusy || !driveConfigured}
                  aria-label="Save a copy to Google Drive"
                  title="Save a copy to Drive"
                  onClick={() => doDrive("copy")}
                >
                  <Plus size={18} />
                </button>
                <button
                  className="icon-button"
                  disabled={driveBusy || !driveConfigured}
                  aria-label="Open from Google Drive"
                  title="Open from Drive"
                  onClick={() => doDrive("open")}
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
                className="icon-button mobile-menu"
                aria-label="Open details"
                onClick={() => setMobilePanel(true)}
              >
                <Menu size={19} />
              </button>
            </div>
          </header>
          <div className="editor-layout">
            <div className="canvas-wrap">
              <div className="canvas-topbar">
                <div className="canvas-label">
                  <span className="canvas-label-dot" /> FAMILY CANVAS
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
                  connectionMode={ConnectionMode.Loose}
                  onNodesChange={onNodesChange}
                  onConnect={connect}
                  onNodeDragStart={() => {
                    movingRef.current = true;
                  }}
                  onNodeDragStop={onNodeDragStop}
                  onMoveEnd={onViewportEnd}
                  onInit={(instance) => {
                    flowRef.current = instance;
                  }}
                  onEdgeClick={(_, edge) => {
                    setSelectedRelationId(edge.id);
                    setSelectedId(null);
                    setMobilePanel(true);
                  }}
                  onPaneClick={() => {
                    setSelectedId(null);
                    setSelectedRelationId(null);
                  }}
                  defaultViewport={tree.viewport}
                  minZoom={0.05}
                  maxZoom={2}
                  fitView={
                    tree.people.length > 0 &&
                    (window.innerWidth < 700 ||
                      (tree.viewport.x === 0 && tree.viewport.y === 0))
                  }
                  fitViewOptions={{ padding: 0.25, maxZoom: 1.1 }}
                  nodesDraggable
                  elementsSelectable
                  selectionOnDrag={false}
                  deleteKeyCode={null}
                  proOptions={{ hideAttribution: false }}
                >
                  <Background color="#dedbd3" gap={24} size={1} />
                  <Controls position="bottom-left" showInteractive={false} />
                </ReactFlow>
              )}
              {!tree?.people.length && (
                <div className="canvas-empty">
                  <div className="empty-symbol">✳</div>
                  <h2>Start with someone you know.</h2>
                  <p>
                    Every family tree begins with one person. You can always add
                    more branches later.
                  </p>
                  <button
                    className="button primary"
                    onClick={() => addPerson()}
                  >
                    Add first person <ArrowRight size={16} />
                  </button>
                </div>
              )}
              <button className="floating-add" onClick={() => addPerson()}>
                <Plus size={19} /> Add person
              </button>
              <div className="canvas-tip">
                <CircleHelp size={15} /> Drag cards to arrange · connect handles
                to link relatives
              </div>
            </div>
            <aside className={`details-panel ${mobilePanel ? "open" : ""}`}>
              {selected ? (
                <PersonEditor
                  person={selected}
                  dates={dateDrafts[selected.id] || selected}
                  onDatesChange={(field, date) =>
                    editDate(selected.id, field, date)
                  }
                  relations={tree!.relations}
                  people={tree!.people}
                  onChange={(p) =>
                    apply((t) => ({
                      ...t,
                      people: t.people.map((old) =>
                        old.id === p.id ? p : old,
                      ),
                    }))
                  }
                  onDelete={() => {
                    if (
                      !window.confirm(
                        `Delete ${selected.name || "this person"} and their relationships?`,
                      )
                    )
                      return;
                    apply((t) => ({
                      ...t,
                      people: t.people.filter((p) => p.id !== selected.id),
                      relations: t.relations.filter((r) =>
                        r.type === "parent"
                          ? r.parentId !== selected.id &&
                            r.childId !== selected.id
                          : r.personA !== selected.id &&
                            r.personB !== selected.id,
                      ),
                    }));
                    setSelectedId(null);
                  }}
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
                  onUpdateRelation={(relation) =>
                    apply((t) => updateRelation(t, relation))
                  }
                  onClose={() => {
                    setSelectedId(null);
                    setMobilePanel(false);
                  }}
                />
              ) : selectedRelation ? (
                <div className="editor-content">
                  <div className="panel-title">
                    <div>
                      <p className="eyebrow">RELATIONSHIP</p>
                      <h2>{relationLabel(selectedRelation)}</h2>
                    </div>
                    <button
                      className="icon-button"
                      aria-label="Close details"
                      onClick={() => {
                        setSelectedRelationId(null);
                        setMobilePanel(false);
                      }}
                    >
                      <X size={19} />
                    </button>
                  </div>
                  <RelationshipFields
                    relation={selectedRelation}
                    people={tree!.people}
                    onChange={(relation) =>
                      apply((t) => updateRelation(t, relation))
                    }
                  />
                  <button
                    className="button danger"
                    onClick={() => {
                      apply((t) => ({
                        ...t,
                        relations: t.relations.filter(
                          (r) => r.id !== selectedRelation.id,
                        ),
                      }));
                      setSelectedRelationId(null);
                    }}
                  >
                    <Trash2 size={16} /> Remove relationship
                  </button>
                </div>
              ) : (
                <div className="panel-welcome">
                  <div className="panel-welcome-icon">
                    <Heart size={26} />
                  </div>
                  <p className="eyebrow">YOUR FAMILY TREE</p>
                  <h2>Stories take shape together.</h2>
                  <p>
                    Select a person to add details, photos, and relationships.
                  </p>
                  <button
                    className="button primary"
                    onClick={() => addPerson()}
                  >
                    <Plus size={16} /> Add a person
                  </button>
                  <div className="panel-hint">
                    <span>TIP</span> Top and bottom handles connect parents and
                    children. Side handles connect partners. Other connections
                    can be assigned a relationship later.
                  </div>
                </div>
              )}
            </aside>
          </div>
          <div className="editor-footer">
            <span>
              Stored in this browser ·{" "}
              <button onClick={downloadJson}>Download a backup</button>
            </span>
            <span>
              {tree?.people.length || 0} people · {tree?.relations.length || 0}{" "}
              connections
            </span>
          </div>
        </div>
      )}
      {notice && (
        <div className="toast" role="alert">
          <span>{notice}</span>
          <button aria-label="Dismiss message" onClick={() => setNotice("")}>
            <X size={16} />
          </button>
        </div>
      )}
      {driveActionsOpen && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setDriveActionsOpen(false);
          }}
        >
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="drive-actions-title"
          >
            <div className="modal-heading">
              <div>
                <p className="eyebrow">GOOGLE DRIVE</p>
                <h2 id="drive-actions-title">Drive options</h2>
              </div>
              <button
                className="icon-button"
                aria-label="Close"
                onClick={() => setDriveActionsOpen(false)}
              >
                <X size={19} />
              </button>
            </div>
            {driveConfigured ? (
              <div className="drive-action-list">
                <button
                  disabled={driveBusy}
                  onClick={() => {
                    setDriveActionsOpen(false);
                    doDrive("save");
                  }}
                >
                  Save to Drive
                </button>
                <button
                  disabled={driveBusy}
                  onClick={() => {
                    setDriveActionsOpen(false);
                    doDrive("copy");
                  }}
                >
                  Save a copy
                </button>
                <button
                  disabled={driveBusy}
                  onClick={() => {
                    setDriveActionsOpen(false);
                    doDrive("open");
                  }}
                >
                  Open from Drive
                </button>
                <button
                  onClick={() => {
                    disconnectDrive();
                    setDriveFile(null);
                    setDriveSavedAt("");
                    setDriveActionsOpen(false);
                    setNotice(
                      "Disconnected Google Drive for this session. Your local tree is still saved.",
                    );
                  }}
                >
                  Disconnect Drive
                </button>
              </div>
            ) : (
              <p>
                Google Drive is not configured for this deployment. Add a Google
                OAuth client ID to enable these actions.
              </p>
            )}
          </div>
        </div>
      )}{" "}
      {driveFiles && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setDriveFiles(null);
          }}
        >
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="drive-title"
          >
            <div className="modal-heading">
              <div>
                <p className="eyebrow">GOOGLE DRIVE</p>
                <h2 id="drive-title">Open a tree</h2>
              </div>
              <button
                className="icon-button"
                aria-label="Close"
                onClick={() => setDriveFiles(null)}
              >
                <X size={19} />
              </button>
            </div>
            <p>Choose an app-created tree. It opens as a local working copy.</p>
            {driveFiles.length ? (
              <div className="drive-file-list">
                {driveFiles.map((f) => (
                  <button
                    key={f.id}
                    disabled={driveBusy}
                    onClick={() => loadDrive(f)}
                  >
                    <Users size={20} />
                    <span>
                      <strong>{f.name}</strong>
                      <small>
                        Edited {new Date(f.modifiedTime).toLocaleDateString()}
                      </small>
                    </span>
                    <ArrowRight size={16} />
                  </button>
                ))}
              </div>
            ) : (
              <div className="empty-drive">
                No GENEalogical3 trees found in this Drive.
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
