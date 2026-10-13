const endpoint = '/api/drive-auth';
const reconnectMessage =
  'Google Drive is not connected. Use Connect Drive in Workspace to reconnect.';
let accessToken = '';
let expiresAt = 0;
let connection: 'unknown' | 'connected' | 'disconnected' = 'unknown';
let generation = 0;
let tokenPromise: Promise<number> | null = null;
let authorizationPromise: Promise<void> | null = null;
let disconnectPromise: Promise<void> | null = null;
let cancelPopup: (() => void) | null = null;

export const driveConfigured = Boolean(import.meta.env.VITE_GOOGLE_CLIENT_ID);
export type DriveConnection =
  | 'unconfigured'
  | 'restoring'
  | 'connecting'
  | 'disconnecting'
  | 'connected'
  | 'disconnected'
  | 'error';
let status: DriveConnection = driveConfigured ? 'restoring' : 'unconfigured';
const listeners = new Set<() => void>();
export const getDriveConnection = () => status;
export const getDriveGeneration = () => generation;
export class DriveAuthorizationError extends Error {
  constructor(
    message: string,
    public generation: number,
  ) {
    super(message);
  }
}
export function subscribeDriveConnection(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
function publish(next: DriveConnection) {
  status = next;
  listeners.forEach((listener) => listener());
}

const disconnectChannel =
  driveConfigured && typeof window !== 'undefined' && typeof window.BroadcastChannel === 'function'
    ? new window.BroadcastChannel('genealogical3-drive-auth')
    : null;

function clearAccess(nextConnection: typeof connection) {
  ++generation;
  cancelPopup?.();
  accessToken = '';
  expiresAt = 0;
  connection = nextConnection;
  publish(nextConnection === 'unknown' ? 'restoring' : nextConnection);
}

export function expireDriveConnection() {
  clearAccess('disconnected');
  disconnectChannel?.postMessage('expired');
}

if (disconnectChannel) {
  disconnectChannel.onmessage = (event: MessageEvent<unknown>) => {
    if (event.data === 'disconnect' || event.data === 'expired') clearAccess('disconnected');
    if (event.data === 'connect' && !authorizationPromise && !disconnectPromise) {
      const pendingToken = tokenPromise;
      clearAccess('unknown');
      const currentGeneration = generation;
      void (async () => {
        await pendingToken?.catch(() => undefined);
        if (currentGeneration === generation) await restoreDrive();
      })().catch(() => undefined);
    }
  };
  import.meta.hot?.dispose(() => disconnectChannel.close());
}

async function authRequest(action: 'token' | 'disconnect'): Promise<Response> {
  try {
    return await fetch(`${endpoint}/${action}`, {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'X-Requested-With': 'GENEalogical3' },
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw Error(
      'Could not reach Google Drive authentication. Please retry. Your local tree is unchanged.',
    );
  }
}

async function responseError(response: Response): Promise<Error> {
  const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
  return Error(
    typeof body?.error === 'string'
      ? body.error
      : 'Google Drive authentication failed. Please retry.',
  );
}

function renewToken(): Promise<number> {
  if (tokenPromise) return tokenPromise;
  const currentGeneration = generation;
  tokenPromise = (async () => {
    const response = await authRequest('token');
    if (currentGeneration !== generation) throw Error('Google Drive connection was canceled.');
    if (response.status === 401) {
      expireDriveConnection();
      // Identify this expiry even if another session change follows before the caller resumes.
      return currentGeneration + 1;
    }
    if (!response.ok) throw await responseError(response);
    const token = (await response.json().catch(() => null)) as {
      accessToken?: unknown;
      expiresAt?: unknown;
    } | null;
    if (currentGeneration !== generation) throw Error('Google Drive connection was canceled.');
    if (
      !token ||
      typeof token.accessToken !== 'string' ||
      !token.accessToken ||
      typeof token.expiresAt !== 'number' ||
      !Number.isFinite(token.expiresAt) ||
      token.expiresAt <= Date.now()
    ) {
      throw Error('Google Drive returned an invalid authentication response. Please retry.');
    }
    accessToken = token.accessToken;
    expiresAt = token.expiresAt;
    connection = 'connected';
    publish('connected');
    return currentGeneration;
  })()
    .catch((error: unknown) => {
      if (currentGeneration === generation) {
        accessToken = '';
        expiresAt = 0;
        publish('error');
      }
      throw error;
    })
    .finally(() => {
      tokenPromise = null;
    });
  return tokenPromise;
}

export async function restoreDrive(): Promise<void> {
  if (!driveConfigured || disconnectPromise) return;
  if (accessToken && Date.now() < expiresAt - 60_000) return;
  publish('restoring');
  await renewToken();
}

function connectPopup(): Promise<void> {
  // Called synchronously from a click once startup restoration has finished.
  const popup = window.open(`${endpoint}/start`, '_blank', 'popup,width=520,height=680');
  if (!popup)
    return Promise.reject(
      Error('Google sign-in was blocked. Allow popups for this site and retry.'),
    );
  const currentGeneration = generation;
  return new Promise<void>((resolve, reject) => {
    const finish = (error?: Error) => {
      window.removeEventListener('message', onMessage);
      clearInterval(closedCheck);
      clearTimeout(timeout);
      cancelPopup = null;
      popup.close();
      if (error) reject(error);
      else resolve();
    };
    const onMessage = (event: MessageEvent) => {
      if (
        event.origin !== window.location.origin ||
        event.source !== popup ||
        event.data?.type !== 'drive-auth'
      )
        return;
      if (currentGeneration !== generation) finish(Error('Google Drive connection was canceled.'));
      else if (typeof event.data.error === 'string') finish(Error(event.data.error));
      else finish();
    };
    const closedCheck = setInterval(() => {
      if (popup.closed) finish(Error('Google Drive authorization was canceled or denied.'));
    }, 250);
    const timeout = setTimeout(
      () => finish(Error('Google authorization was canceled or timed out.')),
      90_000,
    );
    cancelPopup = () => finish(Error('Google Drive connection was canceled.'));
    window.addEventListener('message', onMessage);
  }).then(async () => {
    if (currentGeneration !== generation) throw Error('Google Drive connection was canceled.');
    const tokenGeneration = await renewToken();
    if (tokenGeneration !== generation) throw Error('Google Drive connection was canceled.');
    if (connection !== 'connected')
      throw new DriveAuthorizationError(
        'Google Drive could not remember this connection. Allow site cookies and reconnect.',
        tokenGeneration,
      );
    disconnectChannel?.postMessage('connect');
  });
}

export function authorizeDrive(): Promise<void> {
  if (!driveConfigured)
    return Promise.reject(Error('Google Drive is not configured for this deployment.'));
  if (disconnectPromise)
    return Promise.reject(Error('Google Drive is disconnecting. Please wait.'));
  if (authorizationPromise) return authorizationPromise;
  if (accessToken && Date.now() < expiresAt - 60_000) return Promise.resolve();
  publish('connecting');
  authorizationPromise = (
    connection === 'disconnected'
      ? connectPopup()
      : renewToken().then((tokenGeneration) => {
          if (tokenGeneration !== generation) throw Error('Google Drive connection was canceled.');
          // A new user click is required after renewal discovers an expired/revoked session.
          if (connection !== 'connected')
            throw new DriveAuthorizationError(reconnectMessage, tokenGeneration);
        })
  ).finally(() => {
    authorizationPromise = null;
    if (status === 'connecting') publish(connection === 'connected' ? 'connected' : 'disconnected');
  });
  return authorizationPromise;
}

export function disconnectDrive(): Promise<void> {
  if (disconnectPromise) return disconnectPromise;
  clearAccess('unknown');
  publish('disconnecting');
  const pendingToken = tokenPromise;
  disconnectPromise = (async () => {
    // Let this tab's pending renewal settle before completing disconnection.
    await pendingToken?.catch(() => undefined);
    const response = await authRequest('disconnect');
    if (!response.ok) throw await responseError(response);
    connection = 'disconnected';
    publish('disconnected');
    disconnectChannel?.postMessage('disconnect');
  })()
    .catch((error: unknown) => {
      publish('error');
      throw error;
    })
    .finally(() => {
      disconnectPromise = null;
    });
  return disconnectPromise;
}

export async function driveAccessToken(forceRefresh = false): Promise<string> {
  if (disconnectPromise) throw Error('Google Drive is disconnecting. Please wait.');
  if (forceRefresh || !accessToken || Date.now() >= expiresAt - 60_000) await renewToken();
  if (!accessToken || connection !== 'connected') throw Error(reconnectMessage);
  return accessToken;
}
