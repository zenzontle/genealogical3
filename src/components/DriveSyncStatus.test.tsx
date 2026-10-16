// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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
