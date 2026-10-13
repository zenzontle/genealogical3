import { useRef, useState } from 'react';
import {
  createDriveDeletion,
  deleteDriveBackup,
  getDriveConnection,
  getDriveGeneration,
  type DriveDeletionProgress,
} from './drive';
import { removeWorkspaceStorage } from './storage';
import type { DeletionScope, WorkspaceEntry } from './workspaceEntries';

export type WorkspaceDeletion = {
  entry: WorkspaceEntry;
  scope: DeletionScope;
  started: boolean;
  progress?: DriveDeletionProgress;
};

export function useWorkspaceDeletion({
  operationBusy,
  beforeLocalRemoval,
  onDriveDeleted,
  onRemoved,
  onBusy,
}: {
  operationBusy: { current: boolean };
  beforeLocalRemoval: (treeId: string) => Promise<() => void>;
  onDriveDeleted: (backupId: string, generation: number) => void;
  onRemoved: (treeId?: string, backupId?: string) => void;
  onBusy: (busy: boolean) => void;
}) {
  const [action, setAction] = useState<WorkspaceDeletion | null>(null);
  const retries = useRef(new Map<string, WorkspaceDeletion>());
  const key = (entry: WorkspaceEntry) =>
    entry.kind === 'local' ? `local:${entry.tree.id}` : `drive:${entry.file.id}`;
  const open = (entry: WorkspaceEntry) => {
    const previous = retries.current.get(key(entry));
    // Reopening explicitly reconfirms the scope in the current session. The helper
    // still revalidates document revision, ownership and backup identity before any DELETE.
    if (
      previous?.progress &&
      !previous.progress.documentDeleted &&
      getDriveConnection() === 'connected' &&
      previous.progress.generation !== getDriveGeneration()
    ) {
      // Missing files in another account cannot confirm a previously uncertain DELETE.
      previous.progress.documentAttempted = false;
      previous.progress.portraitAttempted = undefined;
      previous.progress.generation = getDriveGeneration();
    }
    if (previous?.progress && !previous.progress.documentDeleted)
      previous.progress.revision = undefined;
    setAction(
      previous || { entry, scope: entry.kind === 'drive' ? 'drive' : 'local', started: false },
    );
  };
  const submit = async (scope: DeletionScope) => {
    if (!action) return;
    if (operationBusy.current)
      throw Error('Another Drive operation is pending. Try again when it finishes.');
    const entry = action.entry;
    const backup = entry.kind === 'drive' ? entry.file : entry.link;
    const treeId = scope !== 'drive' && entry.kind === 'local' ? entry.tree.id : undefined;
    const backupId = scope !== 'local' ? backup?.id : undefined;
    if (scope !== 'local' && !backupId) throw Error('This entry has no Drive backup.');
    if (scope !== 'drive' && !treeId) throw Error('This entry has no local copy.');
    if (action.started && scope !== action.scope)
      throw Error('Retry the previously confirmed deletion scope.');
    if (backupId && !action.progress?.documentDeleted && getDriveConnection() !== 'connected')
      throw Error('Connect Drive in Workspace to delete this backup.');
    const task = {
      ...action,
      scope,
      started: true,
      progress: backupId ? action.progress || createDriveDeletion(backupId) : undefined,
    };
    retries.current.set(key(entry), task);
    setAction(task);
    operationBusy.current = true;
    onBusy(true);
    let releaseLocal: (() => void) | undefined;
    try {
      if (task.progress) {
        if (!task.progress.documentDeleted) await deleteDriveBackup(task.progress);
        onDriveDeleted(backupId!, task.progress.generation);
      }
      if (treeId) releaseLocal = await beforeLocalRemoval(treeId);
      try {
        await removeWorkspaceStorage({ treeId, backupId });
      } catch (error) {
        if (task.progress?.documentDeleted)
          throw Error(
            'The Drive backup and its portraits were permanently deleted, but browser cleanup failed. Your local copies are still available. Retry to finish browser cleanup.',
            { cause: error },
          );
        throw error;
      }
      onRemoved(treeId, backupId);
      retries.current.delete(key(entry));
    } finally {
      releaseLocal?.();
      operationBusy.current = false;
      onBusy(false);
    }
  };
  return { action, open, submit, close: () => setAction(null) };
}
