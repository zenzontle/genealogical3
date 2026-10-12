import { validateTree, type Tree } from './model';

export const driveFormat = 'genealogical3-drive';
export type PortraitReference = {
  personId: string;
  imageFileId: string;
  mimeType: 'image/jpeg';
  digest: string;
};
export type DriveDocument = {
  format: typeof driveFormat;
  version: 1;
  backupId: string;
  photoFolderId: string;
  revision: string;
  tree: Tree;
  portraits: PortraitReference[];
};
const identifier = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-zA-Z0-9_-]+$/.test(value);

export function validateDriveDocument(input: unknown, backupId: string): DriveDocument {
  const invalid = () => Error('Invalid Google Drive tree document.');
  if (!input || typeof input !== 'object') throw invalid();
  const doc = input as DriveDocument;
  if (
    doc.format !== driveFormat ||
    doc.version !== 1 ||
    doc.backupId !== backupId ||
    !identifier(doc.backupId) ||
    !identifier(doc.photoFolderId) ||
    !identifier(doc.revision) ||
    !Array.isArray(doc.portraits)
  )
    throw invalid();
  const tree = validateTree(doc.tree);
  if (tree.people.some((person) => person.portrait !== null)) throw invalid();
  const people = new Set(tree.people.map((person) => person.id));
  const referenced = new Set<string>();
  const files = new Map<string, string>();
  for (const ref of doc.portraits) {
    if (
      !ref ||
      !people.has(ref.personId) ||
      referenced.has(ref.personId) ||
      !identifier(ref.imageFileId) ||
      ref.mimeType !== 'image/jpeg' ||
      typeof ref.digest !== 'string' ||
      !/^[a-f0-9]{64}$/.test(ref.digest) ||
      (files.has(ref.imageFileId) && files.get(ref.imageFileId) !== ref.digest)
    )
      throw invalid();
    referenced.add(ref.personId);
    files.set(ref.imageFileId, ref.digest);
  }
  return { ...doc, tree };
}

export async function photoDigest(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function portraitBytes(portrait: string): Uint8Array<ArrayBuffer> {
  const match = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/.exec(portrait);
  if (!match)
    throw Error('Drive portraits must be processed JPEG images. Choose the portrait again.');
  let binary: string;
  try {
    binary = atob(match[1]);
  } catch {
    throw Error('Invalid portrait Base64 data.');
  }
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  if (!isJpeg(bytes)) throw Error('Invalid JPEG portrait. Choose the portrait again.');
  return bytes;
}

export function isJpeg(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[bytes.length - 2] === 0xff &&
    bytes[bytes.length - 1] === 0xd9
  );
}

export function embeddedPortrait(bytes: Uint8Array): string {
  // Avoid spreading large images into a function's argument list.
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:image/jpeg;base64,${btoa(binary)}`;
}
