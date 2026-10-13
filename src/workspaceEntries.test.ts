import { describe, expect, it } from 'vitest';
import { makeTree } from './model';
import { driveTreeName, workspaceEntries } from './workspaceEntries';

describe('combined Workspace entries', () => {
  const file = { id: 'backup', name: 'Family.genealogical3.json', modifiedTime: '2026-10-10' };
  it('sorts both sources using their own modification dates', () => {
    const older = { ...makeTree('Old'), updatedAt: Date.parse('2026-10-09') };
    const newer = { ...makeTree('New'), updatedAt: Date.parse('2026-10-11') };
    expect(workspaceEntries([older, newer], [], [file]).map((entry) => entry.kind)).toEqual([
      'local',
      'drive',
      'local',
    ]);
  });
  it('matches file IDs, retaining same-name files and every distinct local copy', () => {
    const first = makeTree('Family'),
      second = makeTree('Family');
    const links = [first, second].map((tree) => ({ treeId: tree.id, ...file }));
    const other = { ...file, id: 'other-file' };
    const entries = workspaceEntries([first, second], links, [file, other, other]);
    expect(entries.filter((entry) => entry.kind === 'local')).toHaveLength(2);
    expect(entries.filter((entry) => entry.kind === 'drive')).toEqual([
      { kind: 'drive', file: other, updatedAt: Date.parse(other.modifiedTime) },
    ]);
  });
  it('reveals a remote backup after the last local copy is deleted, even with an orphan association', () => {
    const tree = makeTree('Family');
    const links = [{ treeId: tree.id, ...file }];
    expect(workspaceEntries([tree], links, [file])[0].kind).toBe('local');
    expect(workspaceEntries([], links, [file])[0].kind).toBe('drive');
  });
  it('keeps stored associations without remote results or a connection', () => {
    const tree = makeTree('Family');
    const link = { treeId: tree.id, ...file };
    expect(workspaceEntries([tree], [link], [])).toEqual([
      { kind: 'local', tree, link, updatedAt: tree.updatedAt },
    ]);
  });
  it('strips only the generated filename suffix', () => {
    expect(driveTreeName(file.name)).toBe('Family');
    expect(driveTreeName('Other.json')).toBe('Other.json');
  });
});
