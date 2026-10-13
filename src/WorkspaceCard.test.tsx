// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceCard } from './WorkspaceCard';
import { makeTree } from './model';
import type { WorkspaceEntry } from './workspaceEntries';

afterEach(cleanup);
const file = { id: 'backup', name: 'Family.genealogical3.json', modifiedTime: '2026-10-10' };
function card(entry: WorkspaceEntry, canRestore = true) {
  const actions = {
    onOpenTree: vi.fn(),
    onRestore: vi.fn(),
    onDuplicateTree: vi.fn(),
    onRenameTree: vi.fn(),
    onRemoveTree: vi.fn(),
  };
  const view = render(
    <WorkspaceCard
      entry={entry}
      busy={false}
      duplicatingTreeId={null}
      canRestore={canRestore}
      {...actions}
    />,
  );
  return { ...view, ...actions };
}
describe('Workspace card interactions', () => {
  it('opens Drive-only cards by keyboard, without local previews, counts or management actions', async () => {
    const user = userEvent.setup();
    const { container, onRestore } = card({
      kind: 'drive',
      file,
      updatedAt: Date.parse(file.modifiedTime),
    });
    const open = screen.getByRole('button', { name: 'Open Family' });
    await user.tab();
    expect(document.activeElement).toBe(open);
    await user.keyboard('{Enter}');
    expect(onRestore).toHaveBeenCalledWith(file);
    expect(screen.getByText('Google Drive')).toBeTruthy();
    expect(screen.queryByText(/people|person/)).toBeNull();
    expect(container.querySelector('svg.tree-preview')).toBeNull();
    expect(screen.queryByRole('button', { name: /Rename|Duplicate|Delete/ })).toBeNull();
  });
  it('resumes linked local edits and offers a separate keyboard-accessible restore action', async () => {
    const user = userEvent.setup();
    const tree = makeTree('Local edits');
    const link = { treeId: tree.id, ...file };
    const { onOpenTree, onRestore } = card({
      kind: 'local',
      tree,
      link,
      updatedAt: tree.updatedAt,
    });
    await user.tab();
    await user.keyboard(' ');
    expect(onOpenTree).toHaveBeenCalledWith(tree.id);
    expect(onRestore).not.toHaveBeenCalled();
    expect(screen.getByText('This browser + Drive')).toBeTruthy();
    for (let i = 0; i < 4; i++) await user.tab();
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Restore Drive copy of Local edits' }),
    );
    await user.keyboard('{Enter}');
    expect(onRestore).toHaveBeenCalledWith(link);
  });
  it('keeps local cards available after disconnect but disables restoring a backup', () => {
    const tree = makeTree('Local');
    card(
      { kind: 'local', tree, link: { treeId: tree.id, ...file }, updatedAt: tree.updatedAt },
      false,
    );
    expect(screen.getByRole('button', { name: 'Open Local' })).toHaveProperty('disabled', false);
    expect(screen.getByRole('button', { name: 'Restore Drive copy of Local' })).toHaveProperty(
      'disabled',
      true,
    );
  });
});
