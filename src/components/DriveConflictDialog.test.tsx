// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DriveConflictDialog } from './DriveConflictDialog';
import { mockDialogs } from '../test/dialogTestSetup';
beforeEach(() => mockDialogs());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const conflict = {
  localDataUpdatedAt: Date.UTC(2026, 9, 13, 18, 30),
  remoteDataUpdatedAt: Date.UTC(2026, 9, 12, 12, 15),
  revision: 'reviewed',
};
describe('Drive conflict controls', () => {
  it('keeps recovery controls available for timestamps beyond the browser date range', () => {
    render(
      <DriveConflictDialog
        name="Family"
        conflict={{ ...conflict, localDataUpdatedAt: Number.MAX_SAFE_INTEGER }}
        onResolve={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText('Date outside the browser’s supported range')).toBeTruthy();
    expect(screen.getAllByRole('button')).toHaveLength(3);
  });
  it('shows data dates with time and timezone, exactly three actions and Workspace duplication guidance', () => {
    render(
      <DriveConflictDialog
        name="Family"
        conflict={conflict}
        onResolve={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const format = new Intl.DateTimeFormat(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      timeZoneName: 'long',
    });
    expect(screen.getByText(format.format(conflict.localDataUpdatedAt))).toBeTruthy();
    expect(screen.getByText(format.format(conflict.remoteDataUpdatedAt))).toBeTruthy();
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Replace Drive with local',
      'Use Drive version',
      'Leave paused',
    ]);
    expect(screen.getByText(/duplicate your local tree in Workspace/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /copy|duplicate/i })).toBeNull();
  });
  it.each([
    ['Replace Drive with local', 'local'],
    ['Use Drive version', 'drive'],
  ] as const)(
    'confirms %s and submits the reviewed versions only after approval',
    async (label, action) => {
      const confirm = vi
          .spyOn(window, 'confirm')
          .mockReturnValueOnce(false)
          .mockReturnValueOnce(true),
        onResolve = vi.fn(async () => true),
        onClose = vi.fn();
      render(
        <DriveConflictDialog
          name="Family"
          conflict={conflict}
          onResolve={onResolve}
          onClose={onClose}
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: label }));
      expect(onResolve).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: label }));
      await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
      expect(confirm).toHaveBeenCalledTimes(2);
      expect(onResolve).toHaveBeenCalledWith(action, conflict);
    },
  );
  it('leaves paused without changing either version', () => {
    const onResolve = vi.fn(),
      onClose = vi.fn();
    render(
      <DriveConflictDialog
        name="Family"
        conflict={conflict}
        onResolve={onResolve}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Leave paused' }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(onResolve).not.toHaveBeenCalled();
  });
  it('retains the dialog after failed downloads or changed reviewed versions', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const onResolve = vi
        .fn()
        .mockRejectedValueOnce(Error('Incomplete download'))
        .mockResolvedValueOnce(false),
      onClose = vi.fn();
    render(
      <DriveConflictDialog
        name="Family"
        conflict={conflict}
        onResolve={onResolve}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Use Drive version' }));
    await screen.findByText('Incomplete download');
    fireEvent.click(screen.getByRole('button', { name: 'Use Drive version' }));
    await screen.findByText(/version changed during review/);
    expect(onClose).not.toHaveBeenCalled();
  });
});
