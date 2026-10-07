import { X } from 'lucide-react';

export function DriveActionsDialog({
  configured,
  busy,
  onAction,
  onDisconnect,
  onClose,
}: {
  configured: boolean;
  busy: boolean;
  onAction: (action: 'save' | 'copy' | 'open') => void;
  onDisconnect: () => void;
  onClose: () => void;
}) {
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="drive-actions-title">
        <div className="modal-heading">
          <div>
            <p className="eyebrow">GOOGLE DRIVE</p>
            <h2 id="drive-actions-title">Drive options</h2>
          </div>
          <button className="icon-button" aria-label="Close" onClick={onClose}>
            <X size={19} />
          </button>
        </div>
        {configured ? (
          <div className="drive-action-list">
            <button
              disabled={busy}
              onClick={() => {
                onClose();
                onAction('save');
              }}
            >
              Save to Drive
            </button>
            <button
              disabled={busy}
              onClick={() => {
                onClose();
                onAction('copy');
              }}
            >
              Save a copy
            </button>
            <button
              disabled={busy}
              onClick={() => {
                onClose();
                onAction('open');
              }}
            >
              Open from Drive
            </button>
            <button onClick={onDisconnect}>Disconnect Drive</button>
          </div>
        ) : (
          <p>
            Google Drive is not configured for this deployment. Add a Google OAuth client ID to
            enable these actions.
          </p>
        )}
      </div>
    </div>
  );
}
