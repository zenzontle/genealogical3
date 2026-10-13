import { useId, useRef, useState } from 'react';
import { LocalDialog } from './LocalDialog';
import { OperationFeedback } from './OperationFeedback';
import { errorMessage, type FeedbackState } from './feedback';
import { driveTreeName, type DeletionScope } from './workspaceEntries';
import type { WorkspaceDeletion } from './useWorkspaceDeletion';

export function WorkspaceDeletionDialog({
  action,
  driveConnected,
  onSubmit,
  onClose,
}: {
  action: WorkspaceDeletion;
  driveConnected: boolean;
  onSubmit: (scope: DeletionScope) => Promise<void>;
  onClose: () => void;
}) {
  const [scope, setScope] = useState(action.scope);
  const [feedback, setFeedback] = useState<FeedbackState>({ status: 'idle' });
  const locked = useRef(false);
  const group = useId(),
    guidance = useId();
  const { entry } = action;
  const linked = entry.kind === 'local' && !!entry.link;
  const name = entry.kind === 'local' ? entry.tree.name : driveTreeName(entry.file.name);
  const backup = entry.kind === 'drive' ? entry.file : entry.link;
  const backupName = backup ? driveTreeName(backup.name) : '';
  const busy = feedback.status === 'pending';
  const browserCleanup = !!action.progress?.documentDeleted;
  const driveUnavailable = !driveConnected && !browserCleanup;
  const explanation: Record<DeletionScope, string> = {
    local: `Remove “${name}” from this browser.${linked ? ' Its Drive backup will remain available to open again.' : ' Keep a backup first if you want to keep this tree.'}`,
    drive: `Permanently delete “${backupName}” from Google Drive, including its associated portraits. This cannot be undone.${linked ? ' All local copies will remain, without this Drive association.' : ''}`,
    both: `Permanently delete “${backupName}” from Google Drive and its associated portraits, then remove “${name}” from this browser. This cannot be undone. Other local copies will remain, without this Drive association.`,
  };
  return (
    <LocalDialog
      title="Delete tree?"
      description={explanation[scope]}
      busy={busy}
      onClose={onClose}
    >
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (locked.current || (scope !== 'local' && driveUnavailable)) return;
          locked.current = true;
          setFeedback({
            status: 'pending',
            message: browserCleanup ? 'Finishing browser cleanup…' : 'Deleting…',
          });
          try {
            await onSubmit(scope);
            onClose();
          } catch (error) {
            setFeedback({ status: 'error', message: errorMessage(error) });
          } finally {
            locked.current = false;
          }
        }}
      >
        {linked && (
          <fieldset
            className="deletion-scopes"
            disabled={busy || action.started}
            aria-describedby={driveUnavailable ? guidance : undefined}
          >
            <legend>Delete from</legend>
            {(['local', 'drive', 'both'] as const).map((choice) => (
              <label key={choice}>
                <input
                  type="radio"
                  name={group}
                  value={choice}
                  checked={scope === choice}
                  disabled={choice !== 'local' && driveUnavailable}
                  onChange={() => {
                    setScope(choice);
                    setFeedback({ status: 'idle' });
                  }}
                />
                {{ local: 'Local only', drive: 'Drive only', both: 'Both' }[choice]}
              </label>
            ))}
          </fieldset>
        )}
        {driveUnavailable && (linked || scope === 'drive') && (
          <p id={guidance}>Connect Drive in Workspace to enable permanent Drive deletion.</p>
        )}
        {browserCleanup && (
          <p role="status">Drive deletion is complete. Retry to finish browser cleanup.</p>
        )}
        <OperationFeedback state={feedback} onDismiss={() => setFeedback({ status: 'idle' })} />
        <div className="dialog-actions">
          <button
            type="button"
            className="button outline"
            data-autofocus
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="button danger"
            disabled={busy || (scope !== 'local' && driveUnavailable)}
          >
            {busy
              ? 'Deleting…'
              : feedback.status === 'error' || browserCleanup
                ? 'Retry'
                : 'Delete'}
          </button>
        </div>
      </form>
    </LocalDialog>
  );
}
