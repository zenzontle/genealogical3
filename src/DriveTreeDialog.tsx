import { ArrowRight, Users, X } from 'lucide-react';
import type { DriveFile } from './drive';

export function DriveTreeDialog({
  files,
  busy,
  onOpen,
  onClose,
}: {
  files: DriveFile[];
  busy: boolean;
  onOpen: (file: DriveFile) => void;
  onClose: () => void;
}) {
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="drive-title">
        <div className="modal-heading">
          <div>
            <p className="eyebrow">GOOGLE DRIVE</p>
            <h2 id="drive-title">Open a tree</h2>
          </div>
          <button className="icon-button" aria-label="Close" onClick={onClose}>
            <X size={19} />
          </button>
        </div>
        <p>Choose an app-created tree. It opens as a local working copy.</p>
        {files.length ? (
          <div className="drive-file-list">
            {files.map((f) => (
              <button key={f.id} disabled={busy} onClick={() => onOpen(f)}>
                <Users size={20} />
                <span>
                  <strong>{f.name}</strong>
                  <small>Edited {new Date(f.modifiedTime).toLocaleDateString()}</small>
                </span>
                <ArrowRight size={16} />
              </button>
            ))}
          </div>
        ) : (
          <div className="empty-drive">No GENEalogical3 trees found in this Drive.</div>
        )}
      </div>
    </div>
  );
}
