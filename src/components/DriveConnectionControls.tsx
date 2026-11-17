import type { DriveConnection } from '../lib/driveAuth';

const statusLabels: Partial<Record<DriveConnection, string>> = {
  connected: 'Google Drive connected',
  restoring: 'Restoring Google Drive connection…',
  connecting: 'Connecting Google Drive…',
  disconnecting: 'Disconnecting Google Drive…',
};

export function DriveConnectionControls({
  connection,
  configured,
  ready,
  busy,
  onConnect,
  onDisconnect,
}: {
  connection: DriveConnection;
  configured: boolean;
  ready: boolean;
  busy: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  const status = configured ? statusLabels[connection] : undefined;
  const canDisconnect =
    connection === 'connected' || connection === 'error' || connection === 'disconnecting';
  return (
    <div className="workspace-drive-controls">
      {status && (
        <span role="status" className="sr-only">
          {status}
        </span>
      )}
      {canDisconnect ? (
        <button
          className="button outline"
          disabled={busy || !ready}
          aria-busy={connection === 'disconnecting'}
          onClick={onDisconnect}
        >
          {connection === 'disconnecting' ? 'Disconnecting…' : 'Disconnect Drive'}
        </button>
      ) : (
        <button
          className="button outline"
          disabled={busy || !ready || !configured}
          aria-busy={!ready}
          title={configured ? undefined : 'Google Drive is not configured for this deployment'}
          onClick={onConnect}
        >
          {connection === 'restoring'
            ? 'Restoring Drive…'
            : connection === 'connecting'
              ? 'Connecting…'
              : 'Connect Drive'}
        </button>
      )}
    </div>
  );
}
