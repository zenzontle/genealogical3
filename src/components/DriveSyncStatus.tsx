import type { SyncView } from '../lib/driveSync';
export function DriveSyncStatus({
  view,
  onReview,
  onRetry,
}: {
  view?: SyncView;
  onReview: () => void;
  onRetry: () => void;
}) {
  return (
    <div className="drive-sync-status" role="status">
      <span>Drive {view?.status || 'not linked'}</span>
      {view?.error && <span>{view.error}</span>}
      {view?.warning && <span>{view.warning}</span>}
      {view?.conflict ? (
        <button className="button outline" onClick={onReview}>
          Review conflict
        </button>
      ) : view?.status === 'needs attention' && !view.link.restoreWarnings?.length ? (
        <button className="button outline" onClick={onRetry}>
          Retry
        </button>
      ) : null}
    </div>
  );
}
