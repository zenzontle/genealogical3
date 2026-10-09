import { useId, useRef, useState } from 'react';
import { LocalDialog } from './LocalDialog';
import { OperationFeedback } from './OperationFeedback';
import { errorMessage, type FeedbackState } from './feedback';

export type TreeAction =
  | { kind: 'rename'; treeId: string; name: string }
  | { kind: 'delete-tree'; treeId: string; name: string }
  | { kind: 'delete-person'; treeId: string; personId: string; name: string; isHome: boolean };

export function TreeActionDialog({
  action,
  onSubmit,
  onClose,
}: {
  action: TreeAction;
  onSubmit: (name: string) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(action.name);
  const [feedback, setFeedback] = useState<FeedbackState>({ status: 'idle' });
  const locked = useRef(false);
  const inputId = useId(),
    errorId = useId();
  const rename = action.kind === 'rename';
  const busy = feedback.status === 'pending';
  const title = rename
    ? 'Rename tree'
    : action.kind === 'delete-tree'
      ? 'Delete tree?'
      : 'Delete person?';
  const description = rename
    ? 'Choose a name for this family tree.'
    : action.kind === 'delete-tree'
      ? `Delete “${action.name}” from this browser? Export a backup first if you want to keep it.`
      : `Delete ${action.name || 'this person'} and their relationships?${action.isHome ? ' This also clears the home person designation.' : ''} You can undo this change.`;
  return (
    <LocalDialog title={title} description={description} busy={busy} onClose={onClose}>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (locked.current) return;
          if (rename && !name.trim()) {
            setFeedback({ status: 'error', message: 'Enter a tree name.' });
            return;
          }
          locked.current = true;
          setFeedback({ status: 'pending', message: rename ? 'Saving name…' : 'Deleting…' });
          try {
            await onSubmit(name.trim());
            onClose();
          } catch (error) {
            setFeedback({ status: 'error', message: errorMessage(error) });
          } finally {
            locked.current = false;
          }
        }}
      >
        {rename && (
          <label htmlFor={inputId}>
            Tree name
            <input
              id={inputId}
              data-autofocus
              value={name}
              disabled={busy}
              aria-invalid={feedback.status === 'error'}
              aria-describedby={feedback.status === 'error' ? errorId : undefined}
              onChange={(event) => {
                setName(event.target.value);
                setFeedback({ status: 'idle' });
              }}
            />
          </label>
        )}
        <div id={errorId}>
          <OperationFeedback state={feedback} onDismiss={() => setFeedback({ status: 'idle' })} />
        </div>
        <div className="dialog-actions">
          <button
            type="button"
            className="button outline"
            data-autofocus={rename ? undefined : true}
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="submit"
            className={`button ${rename ? 'primary' : 'danger'}`}
            disabled={busy}
          >
            {busy
              ? rename
                ? 'Saving…'
                : 'Deleting…'
              : feedback.status === 'error'
                ? 'Retry'
                : rename
                  ? 'Save name'
                  : 'Delete'}
          </button>
        </div>
      </form>
    </LocalDialog>
  );
}
