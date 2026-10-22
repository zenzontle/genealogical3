// @vitest-environment jsdom
import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FeedbackToast } from './FeedbackToast';
import { Toaster } from './Toaster';
import { useToast } from '../hooks/useToast';

function Notifications() {
  const { feedback, notify, dismiss } = useToast();
  return (
    <>
      <button onClick={() => notify('Saved.')}>Save</button>
      <button onClick={() => notify('Save failed.', 'error')}>Fail</button>
      <FeedbackToast state={feedback} onDismiss={dismiss} />
    </>
  );
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));

describe('toaster utility', () => {
  it('shares the nearest stack and keeps dialog feedback local', () => {
    render(
      <Toaster>
        <FeedbackToast state={{ status: 'error', message: 'First' }} onDismiss={vi.fn()} />
        <section>
          <FeedbackToast state={{ status: 'success', message: 'Second' }} onDismiss={vi.fn()} />
        </section>
        <dialog open>
          <FeedbackToast
            withinDialog
            state={{ status: 'error', message: 'Dialog error' }}
            onDismiss={vi.fn()}
          />
        </dialog>
      </Toaster>,
    );
    const stack = screen.getByText('First').closest('.toast-stack')!;
    expect(stack.id).toBe('operation-toasts');
    expect(stack.querySelectorAll('.toast')).toHaveLength(2);
    expect(screen.getByText('Second').closest('.toast-stack')).toBe(stack);
    expect(within(screen.getByRole('dialog')).getByRole('alert').textContent).toBe('Dialog error');
    expect(stack.contains(screen.getByText('Dialog error'))).toBe(false);
  });

  it('provides a local stack without a toaster', () => {
    render(<Notifications />);
    fireEvent.click(screen.getByText('Save'));
    expect(screen.getByRole('status').closest('.toast-stack')).toBeTruthy();
  });

  it('restarts repeated success notifications, keeps errors, and dismisses manually', () => {
    const { unmount } = render(
      <StrictMode>
        <Toaster>
          <Notifications />
        </Toaster>
      </StrictMode>,
    );
    fireEvent.click(screen.getByText('Save'));
    advance(4000);
    fireEvent.click(screen.getByText('Save'));
    advance(4999);
    expect(screen.getByRole('status').textContent).toBe('Saved.');
    advance(1);
    expect(screen.queryByRole('status')).toBeNull();

    fireEvent.click(screen.getByText('Save'));
    advance(4000);
    fireEvent.click(screen.getByText('Fail'));
    advance(10000);
    expect(screen.getByRole('alert').textContent).toBe('Save failed.');
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss feedback' }));
    expect(screen.queryByRole('alert')).toBeNull();

    fireEvent.click(screen.getByText('Save'));
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
