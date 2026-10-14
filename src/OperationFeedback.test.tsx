// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OperationFeedback } from './OperationFeedback';
import type { FeedbackState } from './feedback';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const success: FeedbackState = { status: 'success', message: 'JSON export completed.' };
const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));

describe('operation feedback presentation and timing', () => {
  it('keeps the default inline presentation and manual dismissal', () => {
    const dismiss = vi.fn();
    render(<OperationFeedback state={success} onDismiss={dismiss} autoDismissMs={5000} />);
    expect(screen.getByRole('status').parentElement?.className).toBe('operation-feedback success');
    advance(10000);
    expect(dismiss).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss feedback' }));
    expect(dismiss).toHaveBeenCalledOnce();
  });

  it('dismisses toast success after five seconds without restarting on callback changes', () => {
    const dismiss = vi.fn();
    const latestDismiss = vi.fn();
    const { rerender } = render(
      <OperationFeedback
        presentation="toast"
        state={success}
        onDismiss={dismiss}
        autoDismissMs={5000}
      />,
    );
    advance(3000);
    rerender(
      <OperationFeedback
        presentation="toast"
        state={success}
        onDismiss={latestDismiss}
        autoDismissMs={5000}
      />,
    );
    advance(1999);
    expect(latestDismiss).not.toHaveBeenCalled();
    advance(1);
    expect(latestDismiss).toHaveBeenCalledOnce();
    expect(dismiss).not.toHaveBeenCalled();
  });

  it('pauses for hover and keyboard focus, then resumes the remaining time', () => {
    const dismiss = vi.fn();
    render(
      <OperationFeedback
        presentation="toast"
        state={success}
        onDismiss={dismiss}
        autoDismissMs={5000}
      />,
    );
    expect(document.activeElement).toBe(document.body);
    const toast = screen.getByRole('status').parentElement!;
    advance(2000);
    fireEvent.mouseEnter(toast);
    advance(10000);
    const button = screen.getByRole('button', { name: 'Dismiss feedback' });
    act(() => button.focus());
    expect(document.activeElement).toBe(button);
    fireEvent.mouseLeave(toast);
    advance(10000);
    expect(dismiss).not.toHaveBeenCalled();
    act(() => button.blur());
    advance(2999);
    expect(dismiss).not.toHaveBeenCalled();
    advance(1);
    expect(dismiss).toHaveBeenCalledOnce();
  });

  it.each(['pending', 'error', 'actionable success'] as const)(
    'keeps %s visible and preserves announcements and actions',
    async (kind) => {
      const user = userEvent.setup();
      const dismiss = vi.fn();
      const recover = vi.fn();
      const pending = kind === 'pending';
      const error = kind === 'error';
      render(
        <OperationFeedback
          presentation="toast"
          state={{ status: pending ? 'pending' : error ? 'error' : 'success', message: kind }}
          onDismiss={dismiss}
          autoDismissMs={5000}
          action={pending ? undefined : { label: error ? 'Retry' : 'Open tree', onClick: recover }}
        />,
      );
      const message = screen.getByRole(error ? 'alert' : 'status');
      expect(message.parentElement?.getAttribute('aria-busy')).toBe(String(pending));
      expect(message.parentElement?.className).toBe('toast');
      advance(10000);
      expect(dismiss).not.toHaveBeenCalled();
      expect(screen.queryByRole('button', { name: 'Dismiss feedback' }) !== null).toBe(!pending);
      if (!pending) {
        vi.useRealTimers();
        await user.tab();
        await user.keyboard('{Enter}');
        expect(recover).toHaveBeenCalledOnce();
        await user.tab();
        await user.keyboard('{Enter}');
        expect(dismiss).toHaveBeenCalledOnce();
      }
    },
  );

  it('cleans up timers when feedback changes, repeats, is dismissed or unmounts', () => {
    const dismiss = vi.fn();
    const props = { presentation: 'toast' as const, onDismiss: dismiss, autoDismissMs: 5000 };
    const { rerender, unmount } = render(<OperationFeedback {...props} state={success} />);
    advance(4000);
    rerender(
      <OperationFeedback {...props} state={{ status: 'pending', message: 'Preparing PNG…' }} />,
    );
    expect(vi.getTimerCount()).toBe(0);
    advance(10000);
    rerender(<OperationFeedback {...props} state={success} />);
    advance(4000);
    rerender(<OperationFeedback {...props} state={{ ...success }} />);
    advance(1000);
    expect(dismiss).not.toHaveBeenCalled();
    fireEvent.mouseEnter(screen.getByRole('status').parentElement!);
    rerender(<OperationFeedback {...props} state={{ status: 'idle' }} />);
    expect(vi.getTimerCount()).toBe(0);
    rerender(<OperationFeedback {...props} state={success} />);
    advance(5000);
    expect(dismiss).toHaveBeenCalledOnce();
    rerender(<OperationFeedback {...props} state={{ ...success }} />);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    advance(10000);
    expect(dismiss).toHaveBeenCalledOnce();
  });
});
