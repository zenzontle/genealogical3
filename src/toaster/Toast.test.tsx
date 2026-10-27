// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Toast } from './Toast';
import { Toaster } from './Toaster';
import { useToast } from './useToast';
import {
  AUTO_DISMISS_MS,
  getToasts,
  removeToast,
  showToast,
  type ToastAction,
  type ToastState,
} from './store';
import type { Toast as ToastData } from './store';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  getToasts().forEach((toast) => removeToast(toast.id));
  vi.useRealTimers();
});

const success: ToastData = {
  id: 'export',
  region: 'app',
  status: 'success',
  message: 'JSON export completed.',
  autoDismissMs: AUTO_DISMISS_MS,
};
const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));

describe('toast presentation and timing', () => {
  it('dismisses success after five seconds without restarting on callback changes', () => {
    const dismiss = vi.fn();
    const latestDismiss = vi.fn();
    const { rerender } = render(<Toast toast={success} onDismiss={dismiss} />);
    advance(3000);
    rerender(<Toast toast={success} onDismiss={latestDismiss} />);
    advance(1999);
    expect(latestDismiss).not.toHaveBeenCalled();
    advance(1);
    expect(latestDismiss).toHaveBeenCalledOnce();
    expect(dismiss).not.toHaveBeenCalled();
  });

  it('pauses for hover and keyboard focus, then resumes the remaining time', () => {
    const dismiss = vi.fn();
    render(<Toast toast={success} onDismiss={dismiss} />);
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

  it.each(['info', 'pending', 'error', 'actionable success'] as const)(
    'keeps %s visible and preserves announcements and actions',
    async (kind) => {
      const user = userEvent.setup();
      const dismiss = vi.fn();
      const recover = vi.fn();
      const pending = kind === 'pending';
      const error = kind === 'error';
      const actionable = kind === 'actionable success';
      render(
        <Toast
          toast={{
            ...success,
            status: actionable ? 'success' : kind,
            message: kind,
            action: actionable || error ? { label: 'Recover', onClick: recover } : undefined,
          }}
          onDismiss={dismiss}
        />,
      );
      const message = screen.getByRole(error ? 'alert' : 'status');
      expect(message.parentElement?.getAttribute('aria-busy')).toBe(String(pending));
      expect(message.parentElement?.classList.contains('toast')).toBe(true);
      advance(10000);
      expect(dismiss).not.toHaveBeenCalled();
      expect(screen.queryByRole('button', { name: 'Dismiss feedback' }) !== null).toBe(!pending);
      if (actionable || error) {
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

  it('cleans up timers when the toast changes, repeats or unmounts', () => {
    const dismiss = vi.fn();
    const { rerender, unmount } = render(<Toast toast={success} onDismiss={dismiss} />);
    advance(4000);
    rerender(
      <Toast
        toast={{ ...success, status: 'pending', message: 'Preparing PNG…' }}
        onDismiss={dismiss}
      />,
    );
    expect(vi.getTimerCount()).toBe(0);
    advance(10000);
    rerender(<Toast toast={success} onDismiss={dismiss} />);
    advance(4000);
    rerender(<Toast toast={{ ...success }} onDismiss={dismiss} />);
    advance(4999);
    expect(dismiss).not.toHaveBeenCalled();
    advance(1);
    expect(dismiss).toHaveBeenCalledOnce();
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});

function Owner({
  state,
  region,
  action,
  onDismiss,
}: {
  state: ToastState;
  region?: string;
  action?: ToastAction;
  onDismiss?: () => void;
}) {
  useToast(state, { region, action, onDismiss });
  return null;
}

describe('toaster', () => {
  it('stacks toasts per region in order and replaces them in place', () => {
    render(
      <>
        <Toaster id="app-stack" />
        <Toaster region="dialog" id="dialog-stack" />
        <Owner state={{ status: 'info', message: 'First' }} />
        <Owner state={{ status: 'error', message: 'In dialog' }} region="dialog" />
      </>,
    );
    act(() => void showToast({ id: 'manual', status: 'pending', message: 'Second' }));
    const app = document.getElementById('app-stack')!;
    expect([...app.querySelectorAll('.toast')].map((toast) => toast.textContent)).toEqual([
      'First',
      'Second',
    ]);
    act(() => void showToast({ id: 'manual', status: 'success', message: 'Done' }));
    expect([...app.querySelectorAll('.toast')].map((toast) => toast.textContent)).toEqual([
      'First',
      'Done',
    ]);
    expect(document.getElementById('dialog-stack')!.textContent).toBe('In dialog');
  });

  it('removes owned toasts when idle or unmounted and reports user dismissal to the owner', () => {
    const dismiss = vi.fn();
    const recover = vi.fn();
    const { rerender, unmount } = render(
      <>
        <Toaster />
        <Owner
          state={{ status: 'error', message: 'Failed' }}
          action={{ label: 'Retry', onClick: recover }}
          onDismiss={dismiss}
        />
      </>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(recover).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss feedback' }));
    expect(dismiss).toHaveBeenCalledOnce();
    expect(screen.queryByRole('alert')).toBeNull();
    rerender(
      <>
        <Toaster />
        <Owner state={{ status: 'info', message: 'Again' }} onDismiss={dismiss} />
      </>,
    );
    expect(screen.getByRole('status').textContent).toBe('Again');
    rerender(
      <>
        <Toaster />
        <Owner state={{ status: 'idle' }} />
      </>,
    );
    expect(screen.queryByRole('status')).toBeNull();
    rerender(
      <>
        <Toaster />
        <Owner state={{ status: 'info', message: 'Owned' }} />
      </>,
    );
    unmount();
    expect(getToasts()).toHaveLength(0);
    expect(dismiss).toHaveBeenCalledOnce();
  });
});
