import { ArrowRight, Cloud, Home } from 'lucide-react';
import type { DriveFile } from './drive';
import type { Tree } from './model';
import { TreePreview } from './TreePreview';
import { driveTreeName, type WorkspaceEntry } from './workspaceEntries';

export function WorkspaceCard({
  entry,
  busy,
  duplicatingTreeId,
  canRestore,
  onOpenTree,
  onRestore,
  onDuplicateTree,
  onRenameTree,
  onRemoveTree,
}: {
  entry: WorkspaceEntry;
  busy: boolean;
  duplicatingTreeId: string | null;
  canRestore: boolean;
  onOpenTree: (id: string) => void;
  onRestore: (file: DriveFile) => void;
  onDuplicateTree: (tree: Tree) => void;
  onRenameTree: (tree: Tree) => void;
  onRemoveTree: (tree: Tree) => void;
}) {
  const local = entry.kind === 'local' ? entry.tree : null;
  const name = entry.kind === 'local' ? entry.tree.name : driveTreeName(entry.file.name);
  const link = entry.kind === 'local' ? entry.link : undefined;
  return (
    <div className="tree-tile">
      <button
        className="tree-open"
        disabled={busy}
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
        <span>{local ? (link ? 'This browser + Drive' : 'This browser') : 'Google Drive'}</span>
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
      {local && (
        <div className="tree-tile-tools">
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
            onClick={() => onRemoveTree(local)}
          >
            Delete
          </button>
          {link && (
            <button
              aria-label={`Restore Drive copy of ${name}`}
              disabled={busy || !canRestore}
              onClick={() => onRestore(link)}
            >
              Restore Drive copy
            </button>
          )}
        </div>
      )}
    </div>
  );
}
