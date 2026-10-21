import { useState } from 'react';
import type { SyncView } from '../lib/driveSync';
import type { DriveLink } from '../lib/storage';
export function DriveSyncStatus({
  view,
  onReview,
  onRetry,
  treeName,
  link,
  onSyncEnabledChange,
}: {
  view?: SyncView;
  onReview: () => void;
  onRetry: () => void;
  treeName?: string;
  link?: DriveLink;
  onSyncEnabledChange?: (enabled: boolean) => Promise<void>;
}) {
  const [changing, setChanging] = useState<boolean>();
  const [error, setError] = useState('');
  const association = view?.link ?? link;
  const enabled = association?.syncEnabled !== false;
  const pending = changing ?? view?.syncChange;
  return (
    <div className="drive-sync-status" role="status">
      {association && onSyncEnabledChange && (
        <button
          type="button"
          className="button outline"
          role="switch"
          aria-label={`Google Drive sync for ${treeName}`}
          aria-checked={enabled}
          disabled={pending !== undefined}
          onClick={() => {
            const next = !enabled;
            setError('');
            setChanging(next);
            void onSyncEnabledChange(next)
              .catch((failure: unknown) =>
                setError(
                  failure instanceof Error
                    ? failure.message
                    : 'Could not save Google Drive sync preference.',
                ),
              )
              .finally(() => setChanging(undefined));
          }}
        >
          Google Drive sync: {enabled ? 'On' : 'Off'}
        </button>
      )}
      <span>
        {pending !== undefined
          ? pending
            ? 'Turning on…'
            : 'Turning off…'
          : !enabled
            ? 'Drive sync off'
            : `Drive ${view?.status || (association ? 'pending' : 'not linked')}`}
      </span>
      {!enabled && <span>Changes stay in this browser. Your existing Drive backup is kept.</span>}
      {error && <span role="alert">{error}</span>}
      {view?.error && <span>{view.error}</span>}
      {view?.warning && <span>{view.warning}</span>}
      {enabled &&
        pending === undefined &&
        (view?.conflict ? (
          <button className="button outline" onClick={onReview}>
            Review conflict
          </button>
        ) : view?.status === 'needs attention' && !view.link.restoreWarnings?.length ? (
          <button className="button outline" onClick={onRetry}>
            Retry
          </button>
        ) : null)}
    </div>
  );
}
