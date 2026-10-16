// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceCard } from './WorkspaceCard';
import { makeTree } from '../lib/model';
import type { WorkspaceEntry } from '../lib/workspaceEntries';

afterEach(cleanup);
const file = { id: 'backup', name: 'Family.genealogical3.json', modifiedTime: '2026-10-10' };
function card(entry: WorkspaceEntry, driveConnected = true, busy = false) {
  const actions = {
    onOpenTree: vi.fn(),
    onRestore: vi.fn(),
    onDuplicateTree: vi.fn(),
    onRenameTree: vi.fn(),
    onRemoveTree: vi.fn(),
  };
  return {
    ...render(
      <WorkspaceCard
        entry={entry}
        busy={busy}
        duplicatingTreeId={null}
        driveConnected={driveConnected}
        {...actions}
      />,
    ),
    ...actions,
  };
}
describe('Workspace card storage and actions', () => {
  it('uses readable metadata for a Drive-only card and its action labels', () => {
    card({
      kind: 'drive',
      file: { ...file, name: 'backup.json', description: 'García family' },
      updatedAt: 0,
    });
    expect(screen.getByText('García family')).toHaveProperty('title', 'García family');
    expect(screen.getByRole('button', { name: 'Open García family' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Delete García family from Drive' })).toBeTruthy();
    expect(screen.queryByText('backup.json')).toBeNull();
  });
  it.each(['local', 'linked', 'drive'] as const)(
    'shows accessible icons and the action matrix for %s',
    async (kind) => {
      const tree = makeTree('Family');
      const entry: WorkspaceEntry =
        kind === 'drive'
          ? { kind, file, updatedAt: 0 }
          : {
              kind: 'local',
              tree,
              link: kind === 'linked' ? { treeId: tree.id, ...file } : undefined,
              updatedAt: 0,
            };
      const { onRemoveTree, onOpenTree, onRestore } = card(entry);
      expect(screen.queryByRole('img', { name: 'Stored in this browser' }) !== null).toBe(
        kind !== 'drive',
      );
      expect(screen.queryByRole('img', { name: 'Backed up in Google Drive' }) !== null).toBe(
        kind !== 'local',
      );
      for (const icon of screen.getAllByRole('img'))
        expect(icon.title).toBe(icon.getAttribute('aria-label'));
      expect(screen.getAllByRole('button')).toHaveLength(kind === 'drive' ? 2 : 4);
      expect(screen.queryByRole('button', { name: /restore/i })).toBeNull();
      expect(screen.queryByRole('button', { name: /Rename/ }) !== null).toBe(kind !== 'drive');
      expect(screen.queryByRole('button', { name: /Duplicate/ }) !== null).toBe(kind !== 'drive');
      const user = userEvent.setup();
      await user.tab();
      await user.keyboard('{Enter}');
      if (kind === 'drive') expect(onRestore).toHaveBeenCalledWith(file);
      else {
        expect(onOpenTree).toHaveBeenCalledWith(tree.id);
        expect(onRestore).not.toHaveBeenCalled();
      }
      await user.click(
        screen.getByRole('button', {
          name: kind === 'drive' ? 'Delete Family from Drive' : 'Delete Family',
        }),
      );
      expect(onRemoveTree).toHaveBeenCalledWith(entry);
    },
  );
  it('keeps all local actions available while disconnected', () => {
    const tree = makeTree('Local');
    card({ kind: 'local', tree, link: { treeId: tree.id, ...file }, updatedAt: 0 }, false);
    for (const button of screen.getAllByRole('button'))
      expect(button).toHaveProperty('disabled', false);
  });
  it('disables opening disconnected remote cards but allows the deletion dialog to explain connection requirements', () => {
    card({ kind: 'drive', file, updatedAt: 0 }, false);
    expect(screen.getByRole('button', { name: 'Open Family' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'Delete Family from Drive' })).toHaveProperty(
      'disabled',
      false,
    );
  });
  it('disables card controls while pending', () => {
    card({ kind: 'drive', file, updatedAt: 0 }, true, true);
    for (const button of screen.getAllByRole('button'))
      expect(button).toHaveProperty('disabled', true);
  });
});
