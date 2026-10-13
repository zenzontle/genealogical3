import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { DriveAuthorizationError } from './driveAuth';
import {
  authorizeDrive,
  driveConfigured,
  getDriveConnection,
  getDriveGeneration,
  listDriveTrees,
  restoreDrive,
  subscribeDriveConnection,
  type DriveFile,
} from './drive';

export function useDriveWorkspace(active: boolean) {
  const connection = useSyncExternalStore(subscribeDriveConnection, getDriveConnection);
  const sessionGeneration = useSyncExternalStore(subscribeDriveConnection, getDriveGeneration);
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [filesGeneration, setFilesGeneration] = useState(sessionGeneration);
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [error, setError] = useState('');
  const request = useRef(0);
  const failedConnectionGeneration = useRef<number | null>(null);
  const mounted = useRef(false);
  const previousSession = useRef({ connection, generation: sessionGeneration });
  const reportError = useCallback((error: unknown) => {
    setState('error');
    setError(error instanceof Error ? error.message : 'Could not load Google Drive trees.');
  }, []);
  const refresh = useCallback(async () => {
    if (getDriveConnection() !== 'connected') return;
    const current = ++request.current;
    const generation = getDriveGeneration();
    const valid = () =>
      mounted.current &&
      current === request.current &&
      generation === getDriveGeneration() &&
      getDriveConnection() === 'connected';
    setState('loading');
    setError('');
    try {
      const files = await listDriveTrees();
      if (valid()) {
        setFiles(files);
        setFilesGeneration(generation);
        setState('ready');
      }
    } catch (error) {
      if (valid()) reportError(error);
    }
  }, [reportError]);
  useEffect(() => {
    mounted.current = true;
    const invalidate = () => {
      mounted.current = false;
      ++request.current;
    };
    const generation = getDriveGeneration();
    if (driveConfigured)
      void restoreDrive().catch((error: unknown) => {
        if (mounted.current && generation === getDriveGeneration()) reportError(error);
      });
    return invalidate;
  }, [reportError]);
  useEffect(() => {
    const sessionChanged = previousSession.current.generation !== sessionGeneration;
    const changed = previousSession.current.connection !== connection || sessionChanged;
    previousSession.current = { connection, generation: sessionGeneration };
    if (connection !== 'connected') {
      ++request.current;
      setFiles([]);
      setState(connection === 'error' ? 'error' : 'idle');
      // Preserve feedback for an authorization failure in this session, including cookie expiry.
      if (
        (sessionChanged &&
          connection !== 'error' &&
          failedConnectionGeneration.current !== sessionGeneration) ||
        connection === 'unconfigured'
      )
        setError('');
    } else if (active || changed) void refresh();
  }, [active, connection, sessionGeneration, refresh]);
  const connect = async () => {
    const generation = getDriveGeneration();
    failedConnectionGeneration.current = null;
    setError('');
    try {
      await authorizeDrive();
    } catch (error) {
      const failureGeneration =
        error instanceof DriveAuthorizationError ? error.generation : generation;
      if (mounted.current && failureGeneration === getDriveGeneration()) {
        failedConnectionGeneration.current = failureGeneration;
        reportError(error);
      }
    }
  };
  const retry = async () => {
    const generation = getDriveGeneration();
    setError('');
    try {
      if (getDriveConnection() === 'connected') await refresh();
      else if (failedConnectionGeneration.current === generation) await connect();
      else await restoreDrive();
    } catch (error) {
      if (mounted.current && generation === getDriveGeneration()) reportError(error);
    }
  };
  return {
    connection,
    files: connection === 'connected' && filesGeneration === sessionGeneration ? files : [],
    loading:
      connection === 'restoring' ||
      connection === 'connecting' ||
      (connection === 'connected' &&
        (state === 'idle' ||
          state === 'loading' ||
          (filesGeneration !== sessionGeneration && state !== 'error'))),
    error:
      connection === 'error'
        ? error || 'Could not restore Google Drive access. Please retry.'
        : error,
    ready:
      connection !== 'restoring' && connection !== 'connecting' && connection !== 'disconnecting',
    refresh,
    connect,
    retry,
  };
}
