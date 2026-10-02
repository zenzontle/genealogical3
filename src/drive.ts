import type { Tree } from "./model";
import {
  assertValidLifeDates,
  normalizeHomePerson,
  validateTree,
} from "./model";
const scope = "https://www.googleapis.com/auth/drive.file";
const marker = { app: "GENEalogical3", format: "tree-v1" };
type TokenResponse = {
  access_token?: string;
  expires_in?: number;
  error?: string;
};
type TokenClient = {
  requestAccessToken: (config?: { prompt?: string }) => void;
};
declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            callback: (response: TokenResponse) => void;
          }) => TokenClient;
        };
      };
    };
  }
}
let accessToken = "",
  expiresAt = 0,
  scriptPromise: Promise<void> | null = null;
export const driveConfigured = Boolean(import.meta.env.VITE_GOOGLE_CLIENT_ID);
function loadScript(): Promise<void> {
  if (window.google) return Promise.resolve();
  if (!scriptPromise)
    scriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () =>
        reject(
          Error("Could not load Google authorization. Check your connection."),
        );
      document.head.appendChild(script);
    });
  return scriptPromise;
}
export async function authorizeDrive(): Promise<void> {
  if (!driveConfigured)
    throw Error("Google Drive is not configured for this deployment.");
  if (accessToken && Date.now() < expiresAt - 60_000) return;
  await loadScript();
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(Error("Google authorization was canceled or timed out."));
      }
    }, 90_000);
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: import.meta.env.VITE_GOOGLE_CLIENT_ID,
      scope,
      callback: (response) => {
        settled = true;
        clearTimeout(timeout);
        if (response.error || !response.access_token)
          reject(Error("Google Drive authorization was canceled or denied."));
        else {
          accessToken = response.access_token;
          expiresAt = Date.now() + (response.expires_in || 3600) * 1000;
          resolve();
        }
      },
    });
    client.requestAccessToken({ prompt: "" });
  });
}
export function disconnectDrive() {
  accessToken = "";
  expiresAt = 0;
}
async function request(url: string, options: RequestInit = {}) {
  if (!accessToken || Date.now() >= expiresAt)
    throw Error(
      "Google Drive access expired. Choose a Drive action to reconnect.",
    );
  let response: Response;
  try {
    response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(options.headers || {}),
      },
    });
  } catch {
    throw Error("Could not reach Google Drive. Your local tree is unchanged.");
  }
  if (response.status === 401) {
    disconnectDrive();
    throw Error(
      "Google Drive access expired. Choose a Drive action to reconnect.",
    );
  }
  if (!response.ok)
    throw Error(
      `Google Drive request failed (${response.status}). Your local tree is unchanged.`,
    );
  return response;
}
export type DriveFile = { id: string; name: string; modifiedTime: string };
export async function listDriveTrees(): Promise<DriveFile[]> {
  const q = encodeURIComponent(
    "trashed = false and appProperties has { key='app' and value='GENEalogical3' }",
  );
  const response = await request(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=nextPageToken,files(id,name,modifiedTime)&page_size=100&orderBy=modifiedTime%20desc`,
  );
  const data = (await response.json()) as { files?: DriveFile[] };
  return data.files || [];
}
export async function openDriveTree(id: string): Promise<Tree> {
  const response = await request(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media`,
  );
  return validateTree(await response.json());
}
export async function saveDriveTree(
  tree: Tree,
  existingId?: string,
): Promise<DriveFile> {
  assertValidLifeDates(tree);
  const normalized = normalizeHomePerson(tree);
  const metadata = {
    name: `${tree.name.trim() || "Family tree"}.genealogical3.json`,
    mimeType: "application/json",
    appProperties: marker,
  };
  const boundary = `genealogical3-${crypto.randomUUID()}`;
  const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify({ ...normalized, version: 2 })}\r\n--${boundary}--`;
  const method = existingId ? "PATCH" : "POST";
  const url = existingId
    ? `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(existingId)}?uploadType=multipart&fields=id,name,modifiedTime`
    : "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,modifiedTime";
  const response = await request(url, {
    method,
    headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
    body,
  });
  return response.json() as Promise<DriveFile>;
}
