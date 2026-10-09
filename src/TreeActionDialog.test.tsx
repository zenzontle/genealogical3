// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TreeActionDialog } from './TreeActionDialog';
import { mockDialogs } from './dialogTestSetup';

beforeEach(mockDialogs);
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('local action dialogs', () => {
  it('validates rename, retains the entered name after failure, and retries a trimmed name', async () => {
    const submit = vi
      .fn()
      .mockRejectedValueOnce(Error('Storage unavailable.'))
      .mockResolvedValue(undefined);
    const close = vi.fn();
    const user = userEvent.setup();
    render(
      <TreeActionDialog
        action={{ kind: 'rename', treeId: 'tree', name: 'Original' }}
        onSubmit={submit}
        onClose={close}
      />,
    );
    const input = screen.getByLabelText('Tree name');
    expect(document.activeElement).toBe(input);
    await user.clear(input);
    await user.type(input, '   ');
    await user.click(screen.getByRole('button', { name: 'Save name' }));
    expect(screen.getByRole('alert').textContent).toContain('Enter a tree name');
    expect(submit).not.toHaveBeenCalled();
    await user.clear(input);
    await user.type(input, '  Family history  ');
    await user.click(screen.getByRole('button', { name: 'Save name' }));
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      expect.stringContaining('Storage unavailable'),
    );
    expect(input).toHaveProperty('value', '  Family history  ');
    expect(close).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(submit).toHaveBeenNthCalledWith(2, 'Family history');
    expect(close).toHaveBeenCalledOnce();
  });

  it('prevents duplicate submissions and Escape or Cancel dismissal while saving', async () => {
    let resolve!: () => void;
    const submit = vi.fn(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    const close = vi.fn();
    render(
      <TreeActionDialog
        action={{ kind: 'rename', treeId: 'tree', name: 'Original' }}
        onSubmit={submit}
        onClose={close}
      />,
    );
    const dialog = screen.getByRole('dialog');
    fireEvent.submit(dialog.querySelector('form')!);
    fireEvent.submit(dialog.querySelector('form')!);
    fireEvent(dialog, new Event('cancel', { cancelable: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(submit).toHaveBeenCalledOnce();
    expect(close).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveProperty('disabled', true);
    resolve();
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
  });

  it('defaults deletion to Cancel, conveys home consequences, and contains keyboard focus', async () => {
    const user = userEvent.setup();
    const close = vi.fn(),
      submit = vi.fn();
    render(
      <TreeActionDialog
        action={{
          kind: 'delete-person',
          treeId: 'tree',
          personId: 'person',
          name: 'Alex',
          isHome: true,
        }}
        onSubmit={submit}
        onClose={close}
      />,
    );
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('dialog').textContent).toContain('clears the home person designation');
    screen.getByRole('button', { name: 'Delete' }).focus();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close dialog' }));
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Delete' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(close).toHaveBeenCalledOnce();
    expect(submit).not.toHaveBeenCalled();
  });

  it('restores focus to the trigger, or the library heading after trigger removal', () => {
    const opener = document.createElement('button');
    const fallback = document.createElement('h1');
    fallback.tabIndex = -1;
    fallback.setAttribute('data-dialog-fallback', '');
    document.body.append(opener, fallback);
    opener.focus();
    const first = render(
      <TreeActionDialog
        action={{ kind: 'delete-tree', treeId: 'tree', name: 'Family' }}
        onSubmit={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    first.unmount();
    expect(document.activeElement).toBe(opener);
    const second = render(
      <TreeActionDialog
        action={{ kind: 'delete-tree', treeId: 'tree', name: 'Family' }}
        onSubmit={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    opener.remove();
    second.unmount();
    expect(document.activeElement).toBe(fallback);
    fallback.remove();
  });
});
