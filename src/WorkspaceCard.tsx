import { ArrowRight, Cloud, Home, Monitor } from 'lucide-react';
import type { DriveFile } from './drive';
import type { Tree } from './model';
import { TreePreview } from './TreePreview';
import { driveTreeName, type WorkspaceEntry } from './workspaceEntries';
import { DriveSyncStatus } from './DriveSyncStatus';
import type { SyncView } from './driveSync';

export function WorkspaceCard({
  entry,
  busy,
  duplicatingTreeId,
  driveConnected,
  onOpenTree,
  onRestore,
  onDuplicateTree,
  onRenameTree,
  onRemoveTree,
  syncView,
  onReviewConflict,
  onRetrySync,
}: {
  entry: WorkspaceEntry;
  busy: boolean;
  duplicatingTreeId: string | null;
  driveConnected: boolean;
  onOpenTree: (id: string) => void;
  onRestore: (file: DriveFile) => void;
  onDuplicateTree: (tree: Tree) => void;
  onRenameTree: (tree: Tree) => void;
  onRemoveTree: (entry: WorkspaceEntry) => void;
  syncView?: SyncView;
  onReviewConflict?: (id: string) => void;
  onRetrySync?: (id: string) => void;
}) {
  const local = entry.kind === 'local' ? entry.tree : null;
  const name =
    entry.kind === 'local'
      ? entry.tree.name
      : driveTreeName(entry.file.name, entry.file.description);
  const link = entry.kind === 'local' ? entry.link : undefined;
  return (
    <div className="tree-tile">
      <button
        className="tree-open"
        disabled={busy || (!local && !driveConnected)}
        aria-label={`Open ${name}`}
        onClick={() => (entry.kind === 'local' ? onOpenTree(entry.tree.id) : onRestore(entry.file))}
      >
        {local ? (
          <TreePreview tree={local} />
        ) : (
          <div className="tree-preview tree-preview-empty" aria-hidden="true">
            <Cloud size={36} />
          </div>
        )}
        <strong title={name}>{name}</strong>
        <span className="storage-icons">
          {local && (
            <span role="img" aria-label="Stored in this browser" title="Stored in this browser">
              <Monitor size={17} aria-hidden="true" />
            </span>
          )}
          {(!local || link) && (
            <span
              role="img"
              aria-label="Backed up in Google Drive"
              title="Backed up in Google Drive"
            >
              <Cloud size={17} aria-hidden="true" />
            </span>
          )}
        </span>
        {local && local.homePersonId !== null && (
          <span className="library-home">
            <Home size={13} aria-hidden="true" />
            <span>
              Home:{' '}
              {local.people.find((p) => p.id === local.homePersonId)?.name || 'Unnamed person'}
            </span>
          </span>
        )}
        <span>
          {local && (
            <>
              {local.people.length} {local.people.length === 1 ? 'person' : 'people'} ·{' '}
            </>
          )}
          Edited {new Date(entry.updatedAt).toLocaleDateString()}
        </span>
        <span className="open-cue">
          Open tree <ArrowRight size={15} />
        </span>
      </button>
      {local && link && (
        <DriveSyncStatus
          view={syncView}
          onReview={() => onReviewConflict?.(local.id)}
          onRetry={() => onRetrySync?.(local.id)}
        />
      )}
      <div className="tree-tile-tools">
        {local && (
          <>
            <button
              aria-label={`Duplicate ${name}`}
              title="Duplicate"
              disabled={busy || duplicatingTreeId !== null}
              onClick={() => onDuplicateTree(local)}
            >
              {duplicatingTreeId === local.id ? 'Duplicating…' : 'Duplicate'}
            </button>
            <button
              aria-label={`Rename ${name}`}
              title="Rename"
              disabled={busy}
              onClick={() => onRenameTree(local)}
            >
              Rename
            </button>
            <button
              aria-label={`Delete ${name}`}
              title="Delete"
              disabled={busy}
              onClick={() => onRemoveTree(entry)}
            >
              Delete
            </button>
          </>
        )}
        {!local && (
          <button
            aria-label={`Delete ${name} from Drive`}
            disabled={busy}
            onClick={() => onRemoveTree(entry)}
          >
            Delete from Drive
          </button>
        )}
      </div>
    </div>
  );
}
