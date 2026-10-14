import { useState } from 'react';
import { LocalDialog } from './LocalDialog';
import type { SyncConflict } from './storage';

const conflictTimestamp = (timestamp: number) => {
  if (!Number.isFinite(new Date(timestamp).getTime()))
    return 'Date outside the browser’s supported range';
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'long',
  }).format(timestamp);
};

export function DriveConflictDialog({
  name,
  conflict,
  onResolve,
  onClose,
}: {
  name: string;
  conflict: SyncConflict;
  onResolve: (action: 'local' | 'drive', reviewed: SyncConflict) => Promise<boolean>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const resolve = async (action: 'local' | 'drive') => {
    const message =
      action === 'local'
        ? 'Replace the reviewed Drive version with your local tree?'
        : 'Discard your local edits and use the reviewed Drive version?';
    if (!window.confirm(message)) return;
    setBusy(true);
    setError('');
    try {
      if (await onResolve(action, conflict)) onClose();
      else
        setError('A version changed during review. Review the refreshed dates before continuing.');
    } catch (error) {
      setError(
        error instanceof Error ? error.message : 'Resolution failed. Both versions are preserved.',
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <LocalDialog
      hideClose
      title={`Review Drive conflict: ${name}`}
      description="Both versions are preserved. Sync is paused until you choose a version."
      busy={busy}
      onClose={onClose}
    >
      <dl>
        <dt>Local last edited</dt>
        <dd>{conflictTimestamp(conflict.localDataUpdatedAt)}</dd>
        <dt>Drive last edited</dt>
        <dd>{conflictTimestamp(conflict.remoteDataUpdatedAt)}</dd>
      </dl>
      <p>
        You can duplicate your local tree in Workspace before resolving this conflict. The duplicate
        stays local until you choose Save to Drive.
      </p>
      {error && <p role="alert">{error}</p>}
      <div className="dialog-actions">
        <button className="button outline" disabled={busy} onClick={() => void resolve('local')}>
          Replace Drive with local
        </button>
        <button className="button outline" disabled={busy} onClick={() => void resolve('drive')}>
          Use Drive version
        </button>
        <button className="button primary" disabled={busy} data-autofocus onClick={onClose}>
          Leave paused
        </button>
      </div>
    </LocalDialog>
  );
}
