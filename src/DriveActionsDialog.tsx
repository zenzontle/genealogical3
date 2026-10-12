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
              Tree documents are saved in genealogical3 in My Drive, each with its own sibling photo
              folder. Portraits are processed once as JPEG (quality 0.82), at most 512 pixels on the
              longest side, without upscaling. Later saves upload only new or changed photos.
            </p>
            <p>
              Use Open from Drive to retrieve the document and its private photos. Download JSON
              from the editor for a portable backup with embedded portraits. Save a copy creates
              independent photo files. After a successful save, replaced or removed photos go to
              Drive Trash; older Drive revisions may then have missing photos. Keep each backup's
              photo folder with its document. Editing across devices at the same time is
              unsupported.
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
              <button disabled={busy} onClick={onDisconnect}>
                Disconnect Drive
              </button>
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
