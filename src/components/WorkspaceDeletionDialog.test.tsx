// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceDeletionDialog } from './WorkspaceDeletionDialog';
import { mockDialogs } from '../test/dialogTestSetup';
import { makeTree } from '../lib/model';
import type { WorkspaceDeletion } from '../hooks/useWorkspaceDeletion';

beforeEach(mockDialogs);
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const tree = makeTree('Family');
const file = { id: 'backup', name: 'Family.genealogical3.json', modifiedTime: '' };
const linked: WorkspaceDeletion = {
  entry: { kind: 'local', tree, link: { treeId: tree.id, ...file }, updatedAt: 0 },
  scope: 'local',
  started: false,
};
function dialog(action = linked, driveConnected = true, submit = vi.fn(async () => {})) {
  const close = vi.fn();
  return {
    ...render(
      <WorkspaceDeletionDialog
        action={action}
        driveConnected={driveConnected}
        onSubmit={submit}
        onClose={close}
      />,
    ),
    submit,
    close,
  };
}
describe('Workspace deletion confirmation', () => {
  it('identifies an ID-named Drive-only backup by its readable metadata', () => {
    dialog({
      entry: {
        kind: 'drive',
        file: { ...file, name: 'backup.json', description: 'García family' },
        updatedAt: 0,
      },
      scope: 'drive',
      started: false,
    });
    expect(screen.getByRole('dialog').textContent).toContain('“García family” from Google Drive');
    expect(screen.getByRole('dialog').textContent).not.toContain('backup.json');
  });
  it.each(['local', 'drive', 'both'] as const)(
    'explains and explicitly confirms %s scope',
    async (scope) => {
      const user = userEvent.setup();
      const { submit } = dialog();
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
      expect(screen.getByRole('radio', { name: 'Local only' })).toHaveProperty('checked', true);
      await user.click(
        screen.getByRole('radio', {
          name: { local: 'Local only', drive: 'Drive only', both: 'Both' }[scope],
        }),
      );
      expect(submit).not.toHaveBeenCalled();
      const description = screen.getByRole('dialog').querySelector('p')!.textContent!;
      expect(description.toLowerCase().includes('permanently')).toBe(scope !== 'local');
      if (scope !== 'local') expect(description).toContain('cannot be undone');
      await user.click(screen.getByRole('button', { name: 'Delete' }));
      expect(submit).toHaveBeenCalledWith(scope);
    },
  );
  it('provides accurate single-state explanations without scope choices', () => {
    const view = dialog({ ...linked, entry: { kind: 'local', tree, updatedAt: 0 } });
    expect(screen.queryByRole('radio')).toBeNull();
    expect(screen.getByRole('dialog').textContent).toContain('from this browser');
    view.unmount();
    dialog({ entry: { kind: 'drive', file, updatedAt: 0 }, scope: 'drive', started: false });
    expect(screen.queryByRole('radio')).toBeNull();
    expect(screen.getByRole('dialog').textContent).toContain('associated portraits');
  });
  it.each(['local', 'drive', 'both'] as const)(
    'identifies the correct copies for %s deletion after a local rename',
    async (scope) => {
      const user = userEvent.setup();
      dialog({
        ...linked,
        entry: {
          kind: 'local',
          tree: { ...tree, name: 'Renamed local tree' },
          link: { treeId: tree.id, ...file, name: 'backup.json', description: 'Original backup' },
          updatedAt: 0,
        },
      });
      await user.click(
        screen.getByRole('radio', {
          name: { local: 'Local only', drive: 'Drive only', both: 'Both' }[scope],
        }),
      );
      const description = screen.getByRole('dialog').querySelector('p')!.textContent!;
      if (scope !== 'drive')
        expect(description).toContain('“Renamed local tree” from this browser');
      if (scope !== 'local') expect(description).toContain('“Original backup” from Google Drive');
      if (scope === 'drive') expect(description).not.toContain('Renamed local tree');
      if (scope === 'local') expect(description).not.toContain('Original backup');
    },
  );
  it('disables Drive choices while disconnected but still confirms local deletion', async () => {
    const user = userEvent.setup();
    const { submit } = dialog(linked, false);
    expect(screen.getByRole('radio', { name: 'Local only' })).toHaveProperty('disabled', false);
    for (const name of ['Drive only', 'Both'])
      expect(screen.getByRole('radio', { name })).toHaveProperty('disabled', true);
    expect(screen.getByText(/Connect Drive in Workspace/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(submit).toHaveBeenCalledWith('local');
  });
  it('blocks disconnected Drive-only confirmation, including programmatic form submission', () => {
    const { submit } = dialog(
      { entry: { kind: 'drive', file, updatedAt: 0 }, scope: 'drive', started: false },
      false,
    );
    fireEvent.submit(screen.getByRole('dialog').querySelector('form')!);
    expect(submit).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Delete' })).toHaveProperty('disabled', true);
  });
  it('preserves Cancel, Escape, focus containment and restoration', async () => {
    const user = userEvent.setup();
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    const { close, submit, unmount } = dialog();
    screen.getByRole('button', { name: 'Delete' }).focus();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close dialog' }));
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Delete' }));
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
    expect(close).toHaveBeenCalledOnce();
    expect(submit).not.toHaveBeenCalled();
    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
  it('locks pending controls and duplicate submissions, then reports retryable errors', async () => {
    let fail!: (error: Error) => void;
    const submit = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            fail = reject;
          }),
      )
      .mockResolvedValue(undefined);
    const { close } = dialog(linked, true, submit);
    const form = screen.getByRole('dialog').querySelector('form')!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
    expect(submit).toHaveBeenCalledOnce();
    expect(close).not.toHaveBeenCalled();
    for (const button of screen.getAllByRole('button'))
      expect(button).toHaveProperty('disabled', true);
    expect(screen.getByRole('group')).toHaveProperty('disabled', true);
    fail(Error('One portrait deleted; retry cleanup.'));
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(submit).toHaveBeenCalledTimes(2);
  });
});
