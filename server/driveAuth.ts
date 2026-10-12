import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

const scope = 'https://www.googleapis.com/auth/drive.file';
const cookiePath = '/api/drive-auth';
const sessionCookie = 'drive_session';
const stateCookie = 'drive_oauth_state';
const bindingCookie = 'drive_binding';
const sessionLifetime = 30 * 24 * 60 * 60;
const stateLifetime = 10 * 60;
const configurationError = 'Google Drive authentication is not configured for this deployment.';
type Config = { clientId: string; secret: string; key: Buffer; origin: string; secure: boolean };
type Session = { refreshToken: string; binding: string; expiresAt: number };
type OAuthState = { state: string; binding: string; expiresAt: number; sessionExpiresAt: number };

class AuthError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

function configuration(env: NodeJS.ProcessEnv): Config {
  try {
    const url = new URL(env.DRIVE_APP_ORIGIN || '');
    const localhost = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    const secure = url.protocol === 'https:';
    if (
      (!secure && !(localhost && url.protocol === 'http:' && env.NODE_ENV !== 'production')) ||
      url.origin !== env.DRIVE_APP_ORIGIN ||
      url.username ||
      url.password
    )
      throw Error();
    if (
      !env.VITE_GOOGLE_CLIENT_ID?.trim() ||
      !env.GOOGLE_CLIENT_SECRET?.trim() ||
      !/^[a-fA-F0-9]{64}$/.test(env.DRIVE_SESSION_KEY || '')
    )
      throw Error();
    return {
      clientId: env.VITE_GOOGLE_CLIENT_ID,
      secret: env.GOOGLE_CLIENT_SECRET,
      key: Buffer.from(env.DRIVE_SESSION_KEY!, 'hex'),
      origin: url.origin,
      secure,
    };
  } catch {
    throw new AuthError(503, configurationError);
  }
}

function seal(value: Session | OAuthState, purpose: string, config: Config): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', config.key, iv);
  cipher.setAAD(Buffer.from(`${purpose}:${config.origin}:${config.clientId}`));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  const result = Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url');
  if (result.length > 3500)
    throw new AuthError(502, 'Google returned an invalid authorization response.');
  return result;
}

function unseal(value: string | undefined, purpose: string, config: Config): unknown {
  if (!value || value.length > 3500 || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const bytes = Buffer.from(value, 'base64url');
    const decipher = createDecipheriv('aes-256-gcm', config.key, bytes.subarray(0, 12));
    decipher.setAAD(Buffer.from(`${purpose}:${config.origin}:${config.clientId}`));
    decipher.setAuthTag(bytes.subarray(12, 28));
    return JSON.parse(
      Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8'),
    );
  } catch {
    return null;
  }
}

function cookies(request: IncomingMessage): Record<string, string> {
  return Object.fromEntries(
    (request.headers.cookie || '').split(';').map((part) => {
      const index = part.indexOf('=');
      return [part.slice(0, index).trim(), part.slice(index + 1)];
    }),
  );
}

function setCookie(
  response: ServerResponse,
  name: string,
  value: string,
  maxAge: number,
  config: Config,
) {
  const existing = response.getHeader('Set-Cookie');
  const header = `${name}=${value}; Path=${cookiePath}; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${config.secure ? '; Secure' : ''}`;
  response.setHeader('Set-Cookie', [
    ...(Array.isArray(existing) ? existing : existing ? [String(existing)] : []),
    header,
  ]);
}

function clearConnection(response: ServerResponse, config: Config) {
  for (const name of [sessionCookie, stateCookie, bindingCookie])
    setCookie(response, name, '', 0, config);
}

function matches(left: string | undefined, right: string): boolean {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function json(response: ServerResponse, status: number, body: unknown) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(body));
}

function popupResponse(response: ServerResponse, config: Config | undefined, error?: string) {
  const nonce = randomBytes(18).toString('base64url');
  // Only server-controlled messages and the validated origin enter this script.
  const message = JSON.stringify({ type: 'drive-auth', ...(error ? { error } : {}) }).replace(
    /</g,
    '\\u003c',
  );
  const origin = config
    ? JSON.stringify(config.origin).replace(/</g, '\\u003c')
    : 'window.location.origin';
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.setHeader(
    'Content-Security-Policy',
    `default-src 'none'; script-src 'nonce-${nonce}'; frame-ancestors 'none'; base-uri 'none'`,
  );
  response.end(
    `<!doctype html><html><head><title>Google Drive connection</title></head><body><p>${error || 'Google Drive connected. You can close this window.'}</p><script nonce="${nonce}">if(window.opener){window.opener.postMessage(${message},${origin});window.close();}</script></body></html>`,
  );
}

async function googleTokens(
  parameters: Record<string, string>,
  config: Config,
): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      signal: AbortSignal.timeout(15_000),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        ...parameters,
        client_id: config.clientId,
        client_secret: config.secret,
      }),
    });
  } catch {
    throw new AuthError(502, 'Could not reach Google authorization. Please retry.');
  }
  let tokens: Record<string, unknown>;
  try {
    tokens = await response.json();
  } catch {
    throw new AuthError(502, 'Google returned an invalid authorization response.');
  }
  if (!tokens || typeof tokens !== 'object')
    throw new AuthError(502, 'Google returned an invalid authorization response.');
  if (!response.ok) {
    if (tokens.error === 'invalid_grant')
      throw new AuthError(
        401,
        'Google Drive access expired or was revoked. Choose a Drive action to reconnect.',
      );
    if (tokens.error === 'invalid_client') throw new AuthError(503, configurationError);
    throw new AuthError(502, 'Google authorization failed. Please retry.');
  }
  if (
    typeof tokens.access_token !== 'string' ||
    !tokens.access_token ||
    typeof tokens.expires_in !== 'number' ||
    !Number.isFinite(tokens.expires_in) ||
    tokens.expires_in <= 60
  ) {
    throw new AuthError(502, 'Google returned an invalid authorization response.');
  }
  if (typeof tokens.scope === 'string' && !tokens.scope.split(' ').includes(scope)) {
    throw new AuthError(
      401,
      'Google Drive permission was not granted. Choose a Drive action to reconnect.',
    );
  }
  return tokens;
}

export async function handleDriveAuth(
  request: IncomingMessage,
  response: ServerResponse,
  env = process.env,
): Promise<void> {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  let config: Config | undefined;
  let action = '';
  try {
    action = (request.url || '').split('?')[0].slice(`${cookiePath}/`.length);
    config = configuration(env);
    const url = new URL(request.url || '', config.origin);
    action = url.pathname.slice(`${cookiePath}/`.length);
    if (!['start', 'callback', 'token', 'disconnect'].includes(action))
      throw new AuthError(404, 'Unknown Drive authentication endpoint.');
    const method = action === 'start' || action === 'callback' ? 'GET' : 'POST';
    if (request.method !== method) {
      response.setHeader('Allow', method);
      throw new AuthError(405, 'Method not allowed.');
    }
    if (
      method === 'POST' &&
      (request.headers.origin !== config.origin ||
        request.headers['x-requested-with'] !== 'GENEalogical3')
    ) {
      throw new AuthError(403, 'Invalid authentication request origin.');
    }
    const jar = cookies(request);
    if (action === 'disconnect') {
      clearConnection(response, config);
      json(response, 200, { disconnected: true });
      return;
    }
    if (action === 'start') {
      // Keep existing sessions usable if another tab abandons this authorization.
      // Disconnect clears this binding, so earlier callbacks cannot restore access.
      const binding = /^[A-Za-z0-9_-]{43}$/.test(jar[bindingCookie] || '')
        ? jar[bindingCookie]
        : randomBytes(32).toString('base64url');
      const state = randomBytes(32).toString('base64url');
      const sessionExpiresAt = Date.now() + sessionLifetime * 1000;
      setCookie(response, bindingCookie, binding, sessionLifetime, config);
      setCookie(
        response,
        stateCookie,
        seal(
          { state, binding, expiresAt: Date.now() + stateLifetime * 1000, sessionExpiresAt },
          stateCookie,
          config,
        ),
        stateLifetime,
        config,
      );
      const authorization = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      authorization.search = new URLSearchParams({
        client_id: config.clientId,
        redirect_uri: `${config.origin}${cookiePath}/callback`,
        response_type: 'code',
        scope,
        access_type: 'offline',
        prompt: 'consent select_account',
        state,
      }).toString();
      response.statusCode = 302;
      response.setHeader('Location', authorization.toString());
      response.end();
      return;
    }
    if (action === 'callback') {
      const state = unseal(jar[stateCookie], stateCookie, config) as OAuthState | null;
      if (
        !state ||
        !Number.isFinite(state.expiresAt) ||
        Date.now() >= state.expiresAt ||
        !matches(url.searchParams.get('state') || undefined, state.state) ||
        !matches(jar[bindingCookie], state.binding)
      ) {
        throw new AuthError(
          400,
          'Google authorization expired or could not be verified. Please reconnect.',
        );
      }
      // A stale popup must not consume a newer popup's pending authorization.
      setCookie(response, stateCookie, '', 0, config);
      if (url.searchParams.has('error'))
        throw new AuthError(400, 'Google Drive authorization was canceled or denied.');
      const code = url.searchParams.get('code');
      if (!code || code.length > 4096)
        throw new AuthError(400, 'Google did not return an authorization code.');
      const tokens = await googleTokens(
        {
          grant_type: 'authorization_code',
          code,
          redirect_uri: `${config.origin}${cookiePath}/callback`,
        },
        config,
      );
      if (typeof tokens.refresh_token !== 'string' || !tokens.refresh_token) {
        throw new AuthError(
          502,
          'Google did not return remembered access. Please reconnect and grant Drive permission.',
        );
      }
      const remaining = Math.floor((state.sessionExpiresAt - Date.now()) / 1000);
      if (remaining <= 0)
        throw new AuthError(401, 'Google authorization expired. Please reconnect.');
      setCookie(
        response,
        sessionCookie,
        seal(
          {
            refreshToken: tokens.refresh_token,
            binding: state.binding,
            expiresAt: state.sessionExpiresAt,
          },
          sessionCookie,
          config,
        ),
        remaining,
        config,
      );
      popupResponse(response, config);
      return;
    }
    const session = unseal(jar[sessionCookie], sessionCookie, config) as Session | null;
    if (
      !session ||
      typeof session.refreshToken !== 'string' ||
      !session.refreshToken ||
      !Number.isFinite(session.expiresAt) ||
      Date.now() >= session.expiresAt ||
      !matches(jar[bindingCookie], session.binding)
    ) {
      throw new AuthError(
        401,
        'Google Drive is not connected. Choose a Drive action to reconnect.',
      );
    }
    const tokens = await googleTokens(
      { grant_type: 'refresh_token', refresh_token: session.refreshToken },
      config,
    );
    // Refreshing never rewrites the cookie or extends its absolute lifetime.
    json(response, 200, {
      accessToken: tokens.access_token,
      expiresAt: Math.min(session.expiresAt, Date.now() + Number(tokens.expires_in) * 1000),
    });
  } catch (error) {
    const failure =
      error instanceof AuthError
        ? error
        : new AuthError(500, 'Google Drive authentication failed. Please retry.');
    response.statusCode = failure.status;
    // Token requests never clear shared cookies: a newer connection may already exist.
    if (action === 'start' || action === 'callback')
      popupResponse(response, config, failure.message);
    else json(response, failure.status, { error: failure.message });
  }
}
