// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DriveSyncStatus } from './DriveSyncStatus';
import type { SyncView } from '../lib/driveSync';

afterEach(cleanup);
const attention: SyncView = {
  status: 'needs attention',
  pending: true,
  link: { treeId: 'local', id: 'backup', name: 'Family', modifiedTime: '' },
};
describe('Drive sync recovery controls', () => {
  it('offers a named keyboard switch, waits for persistence, and reports failures without showing off', async () => {
    const user = userEvent.setup();
    let fail!: (error: Error) => void;
    const change = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          fail = reject;
        }),
    );
    render(
      <DriveSyncStatus
        view={attention}
        treeName="García family"
        onSyncEnabledChange={change}
        onReview={vi.fn()}
        onRetry={vi.fn()}
      />,
    );
    const toggle = screen.getByRole('switch', { name: 'Google Drive sync for García family' });
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    await user.tab();
    expect(document.activeElement).toBe(toggle);
    await user.keyboard(' ');
    expect(change).toHaveBeenCalledWith(false);
    expect(toggle).toHaveProperty('disabled', true);
    expect(screen.getByText('Turning off…')).toBeTruthy();
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    await act(async () => fail(Error('Storage unavailable')));
    expect(screen.getByRole('alert').textContent).toBe('Storage unavailable');
    expect(toggle).toHaveProperty('disabled', false);
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(screen.queryByText('Drive sync off')).toBeNull();
  });

  it('explains disabled sync and hides retained conflict and retry actions', async () => {
    const change = vi.fn(async () => {});
    render(
      <DriveSyncStatus
        view={{
          ...attention,
          status: 'disabled',
          link: { ...attention.link, syncEnabled: false },
          conflict: { localDataUpdatedAt: 1, remoteDataUpdatedAt: 2, revision: 'remote' },
          warning: 'Safety warning',
        }}
        treeName="Family"
        onSyncEnabledChange={change}
        onReview={vi.fn()}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByText('Drive sync off')).toBeTruthy();
    expect(
      screen.getByText('Changes stay in this browser. Your existing Drive backup is kept.'),
    ).toBeTruthy();
    expect(screen.getByText('Safety warning')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Review conflict' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    const toggle = screen.getByRole('switch', { name: 'Google Drive sync for Family' });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    await userEvent.setup().click(toggle);
    expect(change).toHaveBeenCalledWith(true);
  });

  it('shows pending feedback from another control without changing the committed switch state', () => {
    render(
      <DriveSyncStatus
        view={{ ...attention, syncChange: false }}
        treeName="Family"
        onSyncEnabledChange={vi.fn()}
        onReview={vi.fn()}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByText('Turning off…')).toBeTruthy();
    expect(screen.getByRole('switch')).toHaveProperty('disabled', true);
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true');
  });

  it('leaves an unlinked tree without a switch', () => {
    render(
      <DriveSyncStatus
        treeName="Family"
        onSyncEnabledChange={vi.fn()}
        onReview={vi.fn()}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.getByText('Drive not linked')).toBeTruthy();
  });
  it('retains recovery guidance without offering Retry for missing portraits', () => {
    const error = 'Duplicate it in Workspace for safekeeping and download the backup again.';
    render(
      <DriveSyncStatus
        view={{
          ...attention,
          error,
          link: { ...attention.link, restoreWarnings: [{ personId: 'person', name: 'Alex' }] },
        }}
        onReview={vi.fn()}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByText(error)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });
  it.each([undefined, []])(
    'offers Retry for actionable errors with warnings %s',
    (restoreWarnings) => {
      const onRetry = vi.fn();
      render(
        <DriveSyncStatus
          view={{ ...attention, link: { ...attention.link, restoreWarnings } }}
          onReview={vi.fn()}
          onRetry={onRetry}
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
      expect(onRetry).toHaveBeenCalledOnce();
    },
  );
  it('keeps conflict review available and separate from Retry', () => {
    const onReview = vi.fn(),
      onRetry = vi.fn();
    render(
      <DriveSyncStatus
        view={{
          ...attention,
          conflict: { localDataUpdatedAt: 1, remoteDataUpdatedAt: 2, revision: 'remote' },
        }}
        onReview={onReview}
        onRetry={onRetry}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Review conflict' }));
    expect(onReview).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(onRetry).not.toHaveBeenCalled();
  });
});
