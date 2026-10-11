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
        <p>
          Drive access is optional and limited to files used with this app. Read our{' '}
          <a href="/privacy-policy" target="_blank" rel="noopener noreferrer">
            privacy policy (opens in a new tab)
          </a>
          {' and '}
          <a href="/terms-of-service" target="_blank" rel="noopener noreferrer">
            terms of service (opens in a new tab)
          </a>
          .
        </p>
        {configured ? (
          <>
            <p>
              New trees and copies are saved in a genealogical3 folder in My Drive. Existing files
              stay in their current folders when updated. Open from Drive searches only the
              genealogical3 folder.
            </p>
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
          </>
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
