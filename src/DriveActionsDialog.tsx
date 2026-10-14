import { X } from 'lucide-react';

export function DriveActionsDialog({
  configured,
  canDisconnect,
  busy,
  onAction,
  onDisconnect,
  onClose,
}: {
  configured: boolean;
  canDisconnect: boolean;
  busy: boolean;
  onAction: () => void;
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
              Open a Google Drive card in Workspace to retrieve the document and its private photos.
              To retry missing portraits, duplicate local edits for safekeeping, delete the linked
              local copy, and reopen the remaining Drive card to download again. Download JSON from
              the editor for a portable backup with embedded portraits. Duplicate a tree in
              Workspace to make an independent local copy; choose Save to Drive on the duplicate to
              create a new backup. After a successful save, replaced or removed photos go to Drive
              Trash; older Drive revisions may then have missing photos. Keep each backup's photo
              folder with its document. Editing across devices at the same time is unsupported.
              Drive deletion permanently removes the backup and its app-owned portraits, including
              superseded portraits in Trash. Photo folder containers remain to protect unrelated
              contents.
            </p>
            <p>
              Linked trees sync automatically three seconds after data edits, with at least ten
              seconds between tree-save attempts. Local saving continues independently. Offline or
              disconnected changes stay pending and resume when you reconnect. Failed requests retry
              with increasing delays; Retry is available when attention is needed. Conflicts pause
              sync: review Local last edited and Drive last edited, then replace Drive with local,
              use the fully downloaded Drive version, or leave paused. You can duplicate local edits
              in Workspace first. There is no automatic merge.
            </p>
            <div className="drive-action-list">
              <button
                disabled={busy}
                onClick={() => {
                  onClose();
                  onAction();
                }}
              >
                Save to Drive
              </button>
              {canDisconnect && (
                <button disabled={busy} onClick={onDisconnect}>
                  Disconnect Drive
                </button>
              )}
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
