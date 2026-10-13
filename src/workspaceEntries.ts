import type { DriveFile } from './drive';
import type { Tree } from './model';
import type { DriveLink } from './storage';

export type WorkspaceEntry =
  | { kind: 'local'; tree: Tree; link?: DriveLink; updatedAt: number }
  | { kind: 'drive'; file: DriveFile; updatedAt: number };

export type DeletionScope = 'local' | 'drive' | 'both';

export const driveTreeName = (name: string, description?: string) =>
  (typeof description === 'string' && description.trim()) ||
  name.replace(/\.genealogical3\.json$/i, '');

export function workspaceEntries(
  trees: Tree[],
  links: DriveLink[],
  files: DriveFile[],
): WorkspaceEntry[] {
  const byTree = new Map(links.map((link) => [link.treeId, link]));
  const linkedFiles = new Set<string>();
  const entries: WorkspaceEntry[] = trees.map((tree) => {
    const link = byTree.get(tree.id);
    if (link) linkedFiles.add(link.id);
    return { kind: 'local', tree, link, updatedAt: tree.updatedAt };
  });
  for (const file of new Map(files.map((file) => [file.id, file])).values()) {
    if (!linkedFiles.has(file.id))
      entries.push({ kind: 'drive', file, updatedAt: Date.parse(file.modifiedTime) || 0 });
  }
  return entries.sort((a, b) => b.updatedAt - a.updatedAt);
}
